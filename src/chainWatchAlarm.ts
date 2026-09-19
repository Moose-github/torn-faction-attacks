import { DurableObject } from "cloudflare:workers";
import { handleChainWatchAlarm } from "./chainWatch";
import { Env } from "./types";
import { HOME_FACTION_ID } from "./constants";

export class ChainWatchAlarm extends DurableObject<Env> {
  async scheduleFaction(factionId: number, alarmAtSeconds: number): Promise<void> {
    if (factionId !== HOME_FACTION_ID) return;
    await this.ctx.storage.put("factionId", factionId);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, alarmAtSeconds * 1000));
  }

  // Retire late RPCs from the old worker as well as already-stored war alarms.
  async schedule(): Promise<void> {
    await this.cancel();
  }

  async cancel(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete("warId");
    await this.ctx.storage.delete("factionId");
  }

  async alarm(): Promise<void> {
    // Old per-war objects retire themselves after deployment. Only the new
    // faction-named object may deliver alerts, avoiding duplicate monitors.
    const factionId = await this.ctx.storage.get<number>("factionId");
    if (factionId !== HOME_FACTION_ID) {
      await this.cancel();
      return;
    }

    await handleChainWatchAlarm(this.env, factionId);
  }
}
