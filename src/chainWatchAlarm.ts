import { DurableObject } from "cloudflare:workers";
import { handleChainWatchAlarm } from "./chainWatch";
import { Env } from "./types";

export class ChainWatchAlarm extends DurableObject<Env> {
  async schedule(warId: number, alarmAtSeconds: number): Promise<void> {
    await this.ctx.storage.put("warId", warId);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, alarmAtSeconds * 1000));
  }

  async cancel(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete("warId");
  }

  async alarm(): Promise<void> {
    const storedWarId = await this.ctx.storage.get<number>("warId");
    const warId = Number(storedWarId);
    if (!Number.isInteger(warId) || warId <= 0) {
      await this.cancel();
      return;
    }

    await handleChainWatchAlarm(this.env, warId);
  }
}
