import { handleWatchInteraction, watchDiscordRequest } from "./chainWatchScheduleDiscord";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { ExternalApiError } from "./external/http";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export type WatchSelectionContext = {
  id: string;
  userId: string;
  guildId: string;
  sheetId: string;
  action: "claim" | "leave";
  selectionId?: string;
};

type PrivateSession = WatchSelectionContext & {
  openInteractionId: string;
  messageId?: string;
  applicationId: string;
  token: string;
  expiresAt: number;
  closed: boolean;
  publishing?: boolean;
  response?: DiscordInteractionResponse;
};
type SessionState = { lastInteractionId: string; session?: PrivateSession };
type SessionStorage = Pick<DurableObjectStorage, "get" | "put" | "setAlarm">;
const expiredResponse = (): DiscordInteractionResponse => ({ type: 7, data: {
  content: "This message expired or was replaced. Open Sign up or Leave slots again.",
  components: [], allowed_mentions: { parse: [] },
} });

// One instance lives in a Durable Object named by Discord user ID. The queue
// covers external HTTP requests too: DO storage gates alone do not serialize
// work across awaits of Discord or D1. Persisted state survives object eviction.
export class WatchPrivateSession {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: SessionStorage, private readonly env: Env) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  handle(interaction: DiscordInteraction): Promise<DiscordInteractionResponse | undefined> {
    return this.serialize(() => this.process(interaction));
  }

  expire(): Promise<void> {
    return this.serialize(async () => {
      const state = await this.storage.get<SessionState>("state");
      const session = state?.session;
      if (!state || !session) return;
      if (session.expiresAt > nowSeconds()) {
        await this.storage.setAlarm(session.expiresAt * 1000);
        return;
      }
      // Keep the interaction high-water mark, but discard webhook credentials.
      await this.storage.put("state", { lastInteractionId: state.lastInteractionId });
      await this.invalidateSelections(session.userId);
      await this.removeMessage(session.applicationId, session.token);
    });
  }

  private async invalidateSelections(userId: string): Promise<void> {
    await this.env.DB.prepare("DELETE FROM chain_watch_pending_selections WHERE discord_user_id = ?").bind(userId).run();
  }

  private async save(state: SessionState): Promise<void> {
    await this.storage.put("state", state);
    if (state.session) await this.storage.setAlarm(state.session.expiresAt * 1000);
  }

  private async removeMessage(applicationId: string, token: string): Promise<void> {
    try {
      await watchDiscordRequest(this.env, `/webhooks/${applicationId}/${token}/messages/@original`, "DELETE", undefined, true);
    } catch (error) {
      // Expired webhook tokens / already dismissed messages are harmless. The
      // persisted session is invalidated before attempting Discord deletion.
      if (!(error instanceof ExternalApiError && [401, 404].includes(error.status ?? 0))) {
        console.error("Unable to remove old chain watch message", error instanceof ExternalApiError ? error.status : "transport error");
      }
    }
  }

  private async publish(state: SessionState, interaction: DiscordInteraction, response: DiscordInteractionResponse): Promise<void> {
    const session = state.session!;
    try {
      // A restart during HTTP delivery must not treat that uncertain reply as a
      // confirmed, active UI. Recovery invalidates and removes it before reuse.
      session.publishing = true;
      await this.save(state);
      const { flags: _flags, ...data } = response.data ?? {};
      const message = await watchDiscordRequest<{ id?: string }>(this.env,
        `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, "PATCH", data, true);
      if (!session.messageId) {
        if (!message.id) throw new Error("Discord did not return a private message ID");
        session.messageId = message.id;
      }
      session.publishing = false;
      await this.save(state);
    } catch (error) {
      // A timed-out PATCH may have reached Discord. Never leave its confirmation
      // usable; close the session and try to remove that uncertain message.
      session.closed = true;
      session.publishing = false;
      session.selectionId = undefined;
      session.response = expiredResponse();
      await this.save(state);
      await this.invalidateSelections(session.userId);
      await this.removeMessage(interaction.application_id!, interaction.token!);
      console.error("Unable to update chain watch message", error instanceof ExternalApiError ? error.status : "transport error");
    }
  }

  private async process(interaction: DiscordInteraction): Promise<DiscordInteractionResponse | undefined> {
    const userId = interaction.member?.user?.id;
    const guildId = interaction.guild_id;
    if (interaction.type !== 3 || !userId || !guildId || guildId !== this.env.DISCORD_GUILD_ID ||
        !interaction.application_id || !interaction.token || !/^\d+$/.test(interaction.id ?? "") || !interaction.message?.id) return;
    const id = interaction.id!;
    const parts = (interaction.data?.custom_id ?? "").split(":");
    if (parts[0] !== "cws") return;
    const open = parts[1] === "open" && ["claim", "leave"].includes(parts[2]);
    const state = await this.storage.get<SessionState>("state") ?? { lastInteractionId: "0" };

    if (state.session?.publishing) {
      state.session.closed = true;
      state.session.selectionId = undefined;
      state.session.response = expiredResponse();
      await this.save(state);
      await this.invalidateSelections(state.session.userId);
      await this.removeMessage(state.session.applicationId, state.session.token);
      state.session.publishing = false;
      await this.save(state);
    }

    // Snowflakes establish the user's event order even if Worker delivery is
    // reversed. A duplicate must not replay a write or overwrite a newer reply.
    if (BigInt(id) <= BigInt(state.lastInteractionId)) {
      if (open && id !== state.lastInteractionId && id !== state.session?.openInteractionId) await this.removeMessage(interaction.application_id, interaction.token);
      return;
    }
    let session = state.session;
    if (!open && (!session || parts[2] !== session.id || interaction.message.id !== session.messageId ||
        session.userId !== userId || session.guildId !== guildId)) {
      // Legacy controls and other private messages cannot affect the current one.
      // Use this interaction's fresh token to clear even a very old message.
      if (interaction.message.id !== session?.messageId) await this.removeMessage(interaction.application_id, interaction.token);
      return expiredResponse();
    }
    state.lastInteractionId = id;
    if (open) {
      // Close persistently before deleting the old message or opening its replacement.
      if (session) session.closed = true;
      await this.save(state);
      await this.invalidateSelections(userId);
      if (session) await this.removeMessage(session.applicationId, session.token);
      session = {
        id: crypto.randomUUID(), openInteractionId: id, userId, guildId, action: parts[2] as "claim" | "leave", sheetId: parts.slice(3).join(":"),
        applicationId: interaction.application_id, token: interaction.token, expiresAt: nowSeconds() + 600, closed: true,
      };
      state.session = session;
    } else {
      session = session!;
      session.applicationId = interaction.application_id;
      session.token = interaction.token;
      if (session.closed || session.expiresAt <= nowSeconds()) {
        session.closed = true;
        session.selectionId = undefined;
        const response = session.response?.data?.components?.length ? expiredResponse() : session.response ?? expiredResponse();
        session.response = response;
        await this.save(state);
        await this.invalidateSelections(userId);
        await this.publish(state, interaction, response);
        return response;
      }
      if (parts[1] === "confirm" && (!session.selectionId || parts[3] !== session.selectionId)) {
        // A stale button in this same message leaves its latest selection intact.
        await this.save(state);
        await this.publish(state, interaction, session.response!);
        return session.response;
      }
      if (parts[1] !== "pick" && parts[1] !== "confirm") return;
    }

    // Fail closed across crashes between D1 and durable storage. Confirmations
    // also consume their D1 token atomically with the slot assignments.
    session.closed = true;
    if (parts[1] !== "confirm") session.selectionId = undefined;
    session.response = expiredResponse();
    session.expiresAt = nowSeconds() + 600;
    await this.save(state);
    if (parts[1] !== "confirm") await this.invalidateSelections(userId);
    const response = await handleWatchInteraction(interaction, this.env, session);
    session.response = response;
    session.closed = !response.data?.components?.some((row) => row.components.some((component) => component.type === 3));
    if (session.closed) {
      session.selectionId = undefined;
      await this.invalidateSelections(userId);
    }
    await this.save(state);
    await this.publish(state, interaction, response);
    return response;
  }
}
