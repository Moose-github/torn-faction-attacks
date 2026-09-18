import { DurableObject } from "cloudflare:workers";
import { WatchPrivateSession } from "./chainWatchPrivateSession";
import type { DiscordInteraction } from "./discordInteractions";
import type { Env } from "./types";

export class ChainWatchSessions extends DurableObject<Env> {
  private readonly session = new WatchPrivateSession(this.ctx.storage, this.env);

  async fetch(request: Request): Promise<Response> {
    await this.session.handle(await request.json<DiscordInteraction>());
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    await this.session.expire();
  }
}
