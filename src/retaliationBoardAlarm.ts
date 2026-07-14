import { DurableObject } from "cloudflare:workers";
import { handleRetaliationBoardAlarm } from "./retaliations";
import { Env } from "./types";

export class RetaliationBoardAlarm extends DurableObject<Env> {
  async schedule(alarmAtSeconds: number): Promise<void> {
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, alarmAtSeconds * 1000));
  }

  async cancel(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    await handleRetaliationBoardAlarm(this.env);
  }
}
