import { refreshTornStockHistoryBatch, refreshTornStockMarketMinute } from "../../../src/stockMarket";
import { runLiveStockPaperBotTick } from "../../../src/stockPaperTrading";
import { Env } from "../../../src/types";
import { json } from "../../../src/utils";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, worker: "stock-market" });
    }
    return json({ ok: false, error: "Not found" }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runStockCron(env, event.scheduledTime));
  },
};

async function runStockCron(env: Env, scheduledTime: number): Promise<void> {
  const run = await refreshTornStockMarketMinute(env, scheduledTime);
  if (run.status !== "error" && shouldRunPaperBot(scheduledTime)) {
    await runLiveStockPaperBotTick(env, scheduledTime);
  }

  if (shouldRunStockRecovery(scheduledTime)) {
    await refreshTornStockHistoryBatch(env, scheduledTime);
  }
}

function shouldRunPaperBot(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % 5 === 0;
}

function shouldRunStockRecovery(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % 30 === 0;
}
