import { runChainWatchCron } from "../chainWatch";
import { runEnemyScoutingCronTick } from "../enemyScoutingCron";
import { runIngestion } from "../ingestion";
import {
  processMemberLifestyleRepairJobs,
  refreshDailyGymStats,
  refreshDailyMemberLifestyleStats,
} from "../lifestyleStats";
import { runScheduledMaintenance } from "../maintenance";
import { refreshTornShoplifting } from "../miscellaneous";
import {
  rebuildOpenWarMemberStatsFromRaw,
  refreshOpenWarChainBonusAdjustmentsFromRaw,
} from "../summaries";
import type { Env, TornFactionMember } from "../types";
import { runMonthlyXanaxCompetitionDiscordReminder } from "../xanaxCompetition";
import type { CronJobDefinition } from "./model";

export const CRON_JOB_DEFINITIONS: CronJobDefinition[] = [
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
    purpose: "Import recent attacks every minute during active wars, then refresh Chain Watch state and alarms.",
    shouldRun: () => true,
    run: async (env, scheduledTime) => {
      await runIngestion(env, "cron", { scheduledTime });
      await runChainWatchCron(env, scheduledTime);
    },
  },
  {
    label: "Cron hourly exact war summaries",
    cadence: "1h active",
    category: "attacks",
    purpose: "Rebuild active war summaries from raw attacks hourly so chain-bonus adjustments catch up outside the minute path.",
    shouldRun: (date) => date.getUTCMinutes() === 0,
    run: (env) => rebuildOpenWarMemberStatsFromRaw(env),
  },
  {
    label: "Cron targeted chain bonus correction",
    cadence: "15m active, excluding hourly rebuild",
    category: "attacks",
    purpose: "Refresh chain-bonus adjusted respect for only members with chain bonuses between hourly exact summary rebuilds.",
    shouldRun: (date) => date.getUTCMinutes() % 15 === 0 && date.getUTCMinutes() !== 0,
    run: (env) => refreshOpenWarChainBonusAdjustmentsFromRaw(env),
  },
  {
    label: "Cron enemy tracking maintenance window",
    cadence: "15m",
    category: "maintenance",
    purpose: "Refresh enemy tracking, pass any fetched enemy members to heatmap sampling, and run independent maintenance tasks.",
    shouldRun: (date) => date.getUTCMinutes() % 15 === 0,
    run: (env, scheduledTime) => runEnemyTrackingAndMaintenance(env, scheduledTime),
  },
  {
    label: "Cron enemy scouting tick",
    cadence: "1m live / 5m pre-live, excluding 15m",
    category: "enemy-tracking",
    purpose: "Refresh enemy tracking on the war-room cadence and fill scouting stats using shared current-war and latch reads.",
    shouldRun: (date) => date.getUTCMinutes() % 15 !== 0,
    run: (env, scheduledTime) =>
      runEnemyScoutingCronTick(env, {
        trackingSchedule: "war-room",
        scheduledTime,
      }),
  },
  {
    label: "Cron personal lifestyle stats",
    cadence: "4x daily at 00:10/06:10/12:10/18:10 UTC",
    category: "daily",
    purpose: "Fill recent personal stats queue and project daily lifestyle snapshots through the daily batch gate.",
    shouldRun: (date) =>
      date.getUTCMinutes() === 10 &&
      [0, 6, 12, 18].includes(date.getUTCHours()),
    run: (env) => refreshDailyMemberLifestyleStats(env, { limit: 40, useLock: true }),
  },
  {
    label: "Cron gym lifestyle stats",
    cadence: "daily at 00:10 UTC, then 1m for 5 retries and 15m thereafter for up to 6h after contributor failures",
    category: "daily",
    purpose: "Fetch daily faction gym contributor totals, retry failed contributor imports, and publish the snapshot without gym stats if the retry window expires.",
    shouldRun: () => true,
    run: (env, scheduledTime) =>
      refreshDailyGymStats(env, {
        homeMembersSynced: false,
        now: Math.floor(scheduledTime / 1000),
      }),
  },
  {
    label: "Cron monthly Xanax competition Discord reminder",
    cadence: "monthly at 00:10 UTC on the 1st",
    category: "discord",
    purpose: "Reconcile the Xanax competition rollover and send the monthly prize reminder image to Discord.",
    shouldRun: shouldRunMonthlyXanaxCompetitionDiscordReminder,
    run: (env, scheduledTime) => runMonthlyXanaxCompetitionDiscordReminder(env, scheduledTime),
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

export function shouldRunMonthlyXanaxCompetitionDiscordReminder(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() >= 10 &&
    date.getUTCMinutes() < 20
  );
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
