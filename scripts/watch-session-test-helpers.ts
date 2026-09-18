import { WatchPrivateSession } from "../src/chainWatchPrivateSession";
import type { DiscordInteraction, DiscordInteractionResponse } from "../src/discordInteractions";
import type { Env } from "../src/types";

export function watchSessions(env: Env) {
  const stores = new Map<string, Map<string, unknown>>();
  const controllers = new Map<string, WatchPrivateSession>();
  let serial = 100000000000000000n;
  const controller = (user = "111") => {
    let current = controllers.get(user);
    if (!current) {
      const values = stores.get(user) ?? new Map<string, unknown>();
      stores.set(user, values);
      const storage = {
        async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
        async put(key: string, value: unknown) { values.set(key, structuredClone(value)); },
        async setAlarm(at: number) { values.set("alarm", at); },
      } as Pick<DurableObjectStorage, "get" | "put" | "setAlarm">;
      current = new WatchPrivateSession(storage, env);
      controllers.set(user, current);
    }
    return current;
  };
  const interaction = (custom_id: string, user = "111", values?: string[], messageId = `private-${user}`): DiscordInteraction => ({
    id: String(++serial), type: 3, application_id: "application", token: `token-${serial}`,
    message: { id: messageId }, guild_id: "guild", channel_id: "channel",
    member: { user: { id: user }, permissions: "8" }, data: { custom_id, values },
  });
  env.CHAIN_WATCH_SESSIONS = {
    idFromName: (name: string) => name,
    get: (name: string) => ({ async fetch(_url: string, init: RequestInit) {
      await controller(name).handle(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    } }),
  } as unknown as DurableObjectNamespace;
  return {
    interaction, controller, stores,
    restart(user = "111") { controllers.delete(user); },
    async handle(request: DiscordInteraction) { return (await controller(request.member!.user!.id!).handle(request))!; },
  };
}

export const selectId = (response: DiscordInteractionResponse) => (response.data!.components![0].components[0] as { custom_id: string }).custom_id;
export const confirmId = (response: DiscordInteractionResponse) => (response.data!.components![1].components[0] as { custom_id: string }).custom_id;
