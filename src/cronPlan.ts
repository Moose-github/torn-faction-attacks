import {
  refreshCurrentEnemyMemberTracking,
  refreshMissingFfscouterEstimates,
  refreshMissingBspBattlestatPredictions,
  refreshMissingScoutingNetworth,
  sendPendingEnemyStatsComparisonImage,
} from "./enemyScouting";
import { runIngestion } from "./ingestion";
import { refreshDailyMemberLifestyleStats } from "./lifestyleStats";
import { runScheduledMaintenance } from "./maintenance";
import { refreshTornShoplifting } from "./miscellaneous";
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
  run: (env: Env) => Promise<unknown>;
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
    cadence: "5m",
    category: "attacks",
    purpose: "Import recent attacks and keep active war attack data current.",
    shouldRun: (minute) => minute % 5 === 0,
    run: (env) => runIngestion(env),
  },
  {
    label: "Cron enemy tracking and maintenance",
    cadence: "15m",
    category: "maintenance",
    purpose: "Refresh enemy member tracking, reuse the sample for heatmaps, and run maintenance tasks.",
    shouldRun: (minute) => minute % 15 === 0,
    run: (env) => runEnemyTrackingAndMaintenance(env),
  },
  {
    label: "Cron enemy member tracking",
    cadence: "5m excluding 15m",
    category: "enemy-tracking",
    purpose: "Refresh enemy member tracking outside the heavier maintenance pass.",
    shouldRun: (minute) => minute % 5 === 0 && minute % 15 !== 0,
    run: (env) => refreshCurrentEnemyMemberTracking(env),
  },
  {
    label: "Cron live enemy member tracking",
    cadence: "1m excluding 5m",
    category: "enemy-tracking",
    purpose: "Refresh live-only enemy member status for active war tracking.",
    shouldRun: (minute) => minute % 5 !== 0,
    run: (env) => refreshCurrentEnemyMemberTracking(env, { liveOnly: true }),
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
    label: "Cron FFScouter estimates",
    cadence: "1m excluding 5m",
    category: "scouting",
    purpose: "Fill missing FFScouter battlestat estimates after partial or failed immediate fills.",
    shouldRun: (minute) => minute % 5 !== 0,
    run: (env) => refreshMissingFfscouterEstimates(env),
  },
  {
    label: "Cron scouting networth",
    cadence: "1m excluding 5m",
    category: "scouting",
    purpose: "Fill missing scouting networth estimates in small batches.",
    shouldRun: (minute) => minute % 5 !== 0,
    run: (env) => refreshMissingScoutingNetworth(env, { limit: 40 }),
  },
  {
    label: "Cron BSP battlestats",
    cadence: "1m excluding 5m",
    category: "scouting",
    purpose: "Fill missing BSP battlestat predictions in small batches.",
    shouldRun: (minute) => minute % 5 !== 0,
    run: (env) => refreshMissingBspBattlestatPredictions(env, { limit: 40 }),
  },
  {
    label: "Cron enemy stats image",
    cadence: "1m excluding 5m",
    category: "discord",
    purpose: "Send the enemy stats comparison image once all scouting stat fills are complete.",
    shouldRun: (minute) => minute % 5 !== 0,
    run: (env) => sendPendingEnemyStatsComparisonImage(env),
  },
];

export function buildCronPlan(env: Env, scheduledTime: number): CronJob[] {
  const minute = new Date(scheduledTime).getUTCMinutes();

  return CRON_JOB_DEFINITIONS.filter((job) => job.shouldRun(minute)).map((job) => ({
    label: job.label,
    cadence: job.cadence,
    category: job.category,
    purpose: job.purpose,
    run: () => job.run(env),
  }));
}

async function runEnemyTrackingAndMaintenance(env: Env): Promise<void> {
  const heatmapMembersByFaction = new Map<number, TornFactionMember[]>();

  try {
    const tracking = await refreshCurrentEnemyMemberTracking(env, { includeMembers: true });
    if (tracking.factionId && tracking.members) {
      heatmapMembersByFaction.set(tracking.factionId, tracking.members);
    }
  } catch (err: any) {
    console.error("Cron enemy member tracking failed:", err?.message || err);
    console.error(err);
  }

  await runScheduledMaintenance(env, { heatmapMembersByFaction });
}
