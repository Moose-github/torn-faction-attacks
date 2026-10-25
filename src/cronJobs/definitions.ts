import { runChainWatchCron } from "../chainWatch";
import { runRankedResearchTick } from "../rankedResearch";
import { runArmoryCron, runMedicalStockAlertsCron } from "../armory";
import { runWatchScheduleCron } from "../chainWatchScheduleDiscord";
import { runEventCompetitionCron } from "../eventCompetition";
import { runEnemyScoutingCronTick } from "../enemyScoutingCron";
import { runIngestion } from "../ingestion";
import {
  processMemberLifestyleRepairJobs,
} from "../lifestyleStats/repairJobs";
import {
  processXantakenRechecks,
} from "../lifestyleStats/xantakenRechecks";
import {
  refreshDailyGymStats,
} from "../lifestyleStats/dailyGym";
import {
  refreshDailyMemberLifestyleStats,
} from "../lifestyleStats/dailyPersonal";
import {
  markOpenWarMemberStatsRebuildComplete,
  runHeatmapSamplingRetry,
  runScheduledMaintenance,
} from "../maintenance";
import { refreshTornShoplifting } from "../miscellaneous";
import { syncRetaliationDiscordBoard } from "../retaliations";
import {
  rebuildWarStatsFromRaw,
  refreshOpenWarChainBonusAdjustmentsFromRaw,
} from "../warStats";
import { runMonthlyXanaxCompetitionDiscordReminder } from "../xanaxCompetition";
import type { CronJobDefinition } from "./model";
import { claimCronSlot, cronSlot, runOncePerSlot } from "./slots";

// Jobs pinned to a slot run in its first few minutes so a skipped cron minute
// is caught up by the next run, and each slot is claimed so it runs only once.
const QUARTER_HOUR_SLOT = cronSlot(15);
const HOURLY_SLOT = cronSlot(60);
const LIFESTYLE_SLOT = cronSlot(6 * 60, 10);

export const CRON_JOB_DEFINITIONS: CronJobDefinition[] = [
  {
    label: "Finite ranked war research batch",
    cadence: "1m (only while a manually started run is active)",
    category: "maintenance",
    purpose: "Advance a bounded admin research collection; idle runs make no Torn requests.",
    shouldRun: () => true,
    run: runRankedResearchTick,
  },
  {
    label: "Cron faction armory inventory",
    cadence: "15m, catching up within 5m",
    category: "maintenance",
    purpose: "Refresh medical, weapons and armor inventory even with the page closed, and fill missing equipment details.",
    shouldRun: QUARTER_HOUR_SLOT.isDue,
    run: (env, scheduledTime) =>
      runOncePerSlot(env, "armory_inventory", QUARTER_HOUR_SLOT, scheduledTime, () => runArmoryCron(env)),
  },
  {
    label: "Cron medical armory stock alerts",
    cadence: "1m rule checks; 5m delivery retries",
    category: "maintenance",
    purpose: "Evaluate saved medical stock rules and retry Discord alerts without fetching inventory.",
    shouldRun: () => true,
    run: (env) => runMedicalStockAlertsCron(env),
  },
  {
    label: "Cron chain watch sign-up sheets",
    cadence: "1m; publish the next sheet 12h before expiry",
    category: "discord",
    purpose: "Roll forward the chain watch schedule, reconcile Discord rosters and warn about unfilled slots one hour before start.",
    shouldRun: () => true,
    run: (env, scheduledTime) => runWatchScheduleCron(env, Math.floor(scheduledTime / 1000)),
  },
  {
    label: "Cron event competition collection",
    cadence: "Start/finish; Halloween every 6h or 12h",
    category: "maintenance",
    purpose: "Collect one-time Elimination participation and scheduled Halloween treat snapshots in resumable batches.",
    shouldRun: () => true,
    run: (env) => runEventCompetitionCron(env),
  },
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
    cadence: "1m",
    category: "attacks",
    purpose: "Import recent attacks every minute, refresh the shared faction Chain Watch, then run the hourly exact rebuild when due.",
    shouldRun: () => true,
    fullWarStatsRebuild: HOURLY_SLOT.isDue,
    run: async (env, scheduledTime) => {
      try {
        await runIngestion(env, "cron", { scheduledTime });
      } finally {
        // Keep monitoring independent of war-stat rebuilds and feed failures.
        // It can use stored hits and the existing live-confirmation fallback.
        await runChainWatchCron(env, scheduledTime);
      }
      // Claimed after ingestion so a failed feed leaves the slot for the next run.
      if (
        HOURLY_SLOT.isDue(new Date(scheduledTime)) &&
        await claimCronSlot(env, "hourly_war_summaries", HOURLY_SLOT.slotStart(scheduledTime))
      ) {
        const result = await rebuildWarStatsFromRaw(env, { scope: "open-wars", reason: "cron" });
        if (!result.wars_skipped) {
          await markOpenWarMemberStatsRebuildComplete(env, Math.floor(scheduledTime / 1000));
        }
      }
      await syncRetaliationDiscordBoard(env, Math.floor(scheduledTime / 1000));
    },
  },
  {
    label: "Cron targeted chain bonus correction",
    cadence: "15m active, excluding hourly rebuild, catching up within 5m",
    category: "attacks",
    purpose: "Refresh chain-bonus adjusted respect for only members with chain bonuses between hourly exact summary rebuilds.",
    shouldRun: (date) => QUARTER_HOUR_SLOT.isDue(date) && !HOURLY_SLOT.isDue(date),
    run: (env, scheduledTime) =>
      runOncePerSlot(env, "chain_bonus_correction", QUARTER_HOUR_SLOT, scheduledTime, () =>
        refreshOpenWarChainBonusAdjustmentsFromRaw(env)),
  },
  {
    label: "Cron scheduled maintenance",
    cadence: "15m, catching up within 5m",
    category: "maintenance",
    purpose: "Run membership sync, heatmap sampling, ranked war reports, achievements, API usage rollups and retention cleanup.",
    shouldRun: QUARTER_HOUR_SLOT.isDue,
    run: (env, scheduledTime) =>
      runOncePerSlot(env, "scheduled_maintenance", QUARTER_HOUR_SLOT, scheduledTime, () => runScheduledMaintenance(env)),
  },
  {
    label: "Cron heatmap sampling retry",
    cadence: "Once at +5m after each 15m slot",
    category: "maintenance",
    purpose: "Retry missing home and enemy heatmap samples once after the maintenance catch-up window, preserving samples already saved.",
    shouldRun: (date) => date.getUTCMinutes() % 15 === 5,
    run: (env, scheduledTime) => runHeatmapSamplingRetry(env, scheduledTime),
  },
  {
    label: "Cron enemy scouting tick",
    cadence: "1m live / 5m pre-live",
    category: "enemy-tracking",
    purpose: "Refresh enemy tracking on the war-room cadence and fill scouting stats using shared current-war and latch reads.",
    shouldRun: () => true,
    run: (env, scheduledTime) =>
      runEnemyScoutingCronTick(env, {
        trackingSchedule: "war-room",
        scheduledTime,
      }),
  },
  {
    label: "Cron personal lifestyle stats",
    cadence: "4x daily at 00:10/06:10/12:10/18:10 UTC, catching up within 5m",
    category: "daily",
    purpose: "Fill recent personal stats queue and project daily lifestyle snapshots through the daily batch gate.",
    shouldRun: LIFESTYLE_SLOT.isDue,
    run: (env, scheduledTime) =>
      runOncePerSlot(env, "personal_lifestyle_stats", LIFESTYLE_SLOT, scheduledTime, () =>
        refreshDailyMemberLifestyleStats(env, { limit: 40, useLock: true })),
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
  {
    label: "Cron xantaken rechecks",
    cadence: "1m",
    category: "daily",
    purpose: "Recheck suspicious xantaken zero deltas and auto-fix stale same-bucket values.",
    shouldRun: () => true,
    run: (env) => processXantakenRechecks(env),
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
