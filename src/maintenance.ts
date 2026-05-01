import { refreshMissingFfscouterEstimates } from "./enemyScouting";
import { sampleFactionActivityHeatmaps } from "./heatmap";
import { syncMissingRankedWarReports } from "./ingestion";
import { Env } from "./types";

type MaintenanceTask = {
  name: string;
  run: () => Promise<void>;
};

export async function runScheduledMaintenance(env: Env): Promise<void> {
  const tasks: MaintenanceTask[] = [
    {
      name: "heatmap sampling",
      run: () => sampleFactionActivityHeatmaps(env),
    },
    {
      name: "missing ranked war reports",
      run: () => syncMissingRankedWarReports(env),
    },
    {
      name: "missing FFScouter estimates",
      run: () => refreshMissingFfscouterEstimates(env),
    },
  ];

  const results = await Promise.allSettled(tasks.map((task) => task.run()));

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const err = result.reason;
      console.error(`Scheduled maintenance ${tasks[index].name} failed:`, err?.message || err);
      console.error(err);
    }
  });
}
