import { runEnemyScoutingCronTick } from "./enemyScoutingCron";
import { runIngestion } from "./ingestion";
import { processMemberLifestyleRepairJobs, refreshDailyMemberLifestyleStats } from "./lifestyleStats";
import { runScheduledMaintenance } from "./maintenance";
import { refreshTornShoplifting } from "./miscellaneous";
import { refreshTornStockHistoryBatch, refreshTornStockMarketMinute } from "./stockMarket";
import { runLiveStockPaperBotTick } from "./stockPaperTrading";
import { rebuildOpenWarMemberStatsFromRaw } from "./summaries";
import { Env, TornFactionMember } from "./types";

export type CronJob = {
  label: string;
  cadence: string;
  category: string;
  purpose: string;
  run: () => Promise<unknown>;
};

type CronJobDefinition = Omit<CronJob, "run"> & {
  shouldRun: (minute: number) => boolean;
  run: (env: Env, scheduledTime: number) => Promise<unknown>;
};

const CRON_JOB_DEFINITIONS: CronJobDefinition[] = [
  {
    label: "Cron Torn shoplifting",
    cadence: "1m",
    category: "miscellaneous",
    purpose: "Refresh Torn shoplifting obstacles and send security-down alerts.",
    shouldRun: () => true,
    run: (env) => refreshTornShoplifting(env),
  },
  {
    label: "Cron ingestion",
    cadence: "1m active / 5m otherwise",
    category: "attacks",
    purpose: "Import recent attacks every minute during active wars, otherwise keep the 5-minute schedule.",
    shouldRun: () => true,
    run: (env, scheduledTime) => runIngestion(env, "cron", { scheduledTime }),
  },
  {
    label: "Cron hourly exact war summaries",
    cadence: "1h active",
    category: "attacks",
    purpose: "Rebuild active war summaries from raw attacks hourly so chain-bonus adjustments catch up outside the minute path.",
    shouldRun: (minute) => minute === 0,
    run: (env) => rebuildOpenWarMemberStatsFromRaw(env),
  },
  {
    label: "Cron enemy tracking maintenance window",
    cadence: "15m",
    category: "maintenance",
    purpose: "Refresh enemy tracking, pass any fetched enemy members to heatmap sampling, and run independent maintenance tasks.",
    shouldRun: (minute) => minute % 15 === 0,
    run: (env, scheduledTime) => runEnemyTrackingAndMaintenance(env, scheduledTime),
  },
  {
    label: "Cron Torn stock market",
    cadence: "1m all-stocks",
    category: "stocks",
    purpose: "Refresh all Torn stock prices, market caps, shares, and investors every minute.",
    shouldRun: () => true,
    run: (env, scheduledTime) => runStockMarketAndPaperBot(env, scheduledTime),
  },
  {
    label: "Cron Torn stock recovery",
    cadence: "30m stale-stock history fallback",
    category: "stocks",
    purpose: "Use per-stock history only to recover stale or missing Torn stock snapshots.",
    shouldRun: (minute) => minute % 30 === 0,
    run: (env, scheduledTime) => refreshTornStockHistoryBatch(env, scheduledTime),
  },
  {
    label: "Cron enemy scouting tick",
    cadence: "1m live / 5m pre-live, excluding 15m",
    category: "enemy-tracking",
    purpose: "Refresh enemy tracking on the war-room cadence and fill scouting stats using shared current-war and latch reads.",
    shouldRun: (minute) => minute % 15 !== 0,
    run: (env, scheduledTime) =>
      runEnemyScoutingCronTick(env, {
        trackingSchedule: "war-room",
        scheduledTime,
      }),
  },
  {
    label: "Cron lifestyle stats",
    cadence: "1m excluding 5m",
    category: "daily",
    purpose: "Fill daily lifestyle stat snapshots through the daily batch gate.",
    shouldRun: (minute) => minute % 5 !== 0,
    run: (env) => refreshDailyMemberLifestyleStats(env, { limit: 40, useLock: true }),
  },
  {
    label: "Cron lifestyle repair",
    cadence: "1m",
    category: "daily",
    purpose: "Process queued member lifestyle snapshot backfill and repair jobs using the API key pool.",
    shouldRun: () => true,
    run: (env) => processMemberLifestyleRepairJobs(env),
  },
];

export function buildCronPlan(env: Env, scheduledTime: number): CronJob[] {
  const minute = new Date(scheduledTime).getUTCMinutes();

  return CRON_JOB_DEFINITIONS.filter((job) => job.shouldRun(minute)).map((job) => ({
    label: job.label,
    cadence: job.cadence,
    category: job.category,
    purpose: job.purpose,
    run: () => job.run(env, scheduledTime),
  }));
}

async function runEnemyTrackingAndMaintenance(env: Env, scheduledTime: number): Promise<void> {
  const prefetchedHeatmapMembersByFaction = new Map<number, TornFactionMember[]>();

  try {
    const tick = await runEnemyScoutingCronTick(env, {
      trackingSchedule: "war-room",
      scheduledTime,
      includeMembers: true,
    });
    if (tick.tracking.factionId && tick.tracking.members) {
      prefetchedHeatmapMembersByFaction.set(tick.tracking.factionId, tick.tracking.members);
    }
  } catch (err: any) {
    console.error("Cron enemy scouting maintenance tick failed:", err?.message || err);
    console.error(err);
  }

  await runScheduledMaintenance(env, { prefetchedHeatmapMembersByFaction });
}

async function runStockMarketAndPaperBot(env: Env, scheduledTime: number): Promise<void> {
  const run = await refreshTornStockMarketMinute(env, scheduledTime);
  if (run.status !== "error" && shouldRunStockPaperBot(scheduledTime)) {
    await runLiveStockPaperBotTick(env, scheduledTime);
  }
}

function shouldRunStockPaperBot(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % 5 === 0;
}
