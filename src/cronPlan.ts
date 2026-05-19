import { runEnemyScoutingCronTick } from "./enemyScoutingCron";
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
    run: (env, scheduledTime) => runEnemyTrackingAndMaintenance(env, scheduledTime),
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
  const heatmapMembersByFaction = new Map<number, TornFactionMember[]>();

  try {
    const tick = await runEnemyScoutingCronTick(env, {
      trackingSchedule: "war-room",
      scheduledTime,
      includeMembers: true,
    });
    if (tick.tracking.factionId && tick.tracking.members) {
      heatmapMembersByFaction.set(tick.tracking.factionId, tick.tracking.members);
    }
  } catch (err: any) {
    console.error("Cron enemy scouting maintenance tick failed:", err?.message || err);
    console.error(err);
  }

  await runScheduledMaintenance(env, { heatmapMembersByFaction });
}
