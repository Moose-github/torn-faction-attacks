export type ScoutingComparisonMetric = "ff_battlestats" | "bsp_battlestats" | "networth";

export type ScoutingBucket = {
  label: string;
  min: number;
  max: number;
};

export const SCOUTING_BATTLE_STATS_BUCKETS: ScoutingBucket[] = [
  { label: "<1m", min: 0, max: 1_000_000 },
  { label: "1m-10m", min: 1_000_000, max: 10_000_000 },
  { label: "10m-100m", min: 10_000_000, max: 100_000_000 },
  { label: "100m-250m", min: 100_000_000, max: 250_000_000 },
  { label: "250m-500m", min: 250_000_000, max: 500_000_000 },
  { label: "500m-1b", min: 500_000_000, max: 1_000_000_000 },
  { label: "1b-2.5b", min: 1_000_000_000, max: 2_500_000_000 },
  { label: "2.5b-5b", min: 2_500_000_000, max: 5_000_000_000 },
  { label: "5b-10b", min: 5_000_000_000, max: 10_000_000_000 },
  { label: "10b+", min: 10_000_000_000, max: Number.POSITIVE_INFINITY },
];

export const SCOUTING_NETWORTH_BUCKETS: ScoutingBucket[] = [
  { label: "<500m", min: 0, max: 500_000_000 },
  { label: "0.5b-1b", min: 500_000_000, max: 1_000_000_000 },
  { label: "1b-2.5b", min: 1_000_000_000, max: 2_500_000_000 },
  { label: "2.5b-5b", min: 2_500_000_000, max: 5_000_000_000 },
  { label: "5b-10b", min: 5_000_000_000, max: 10_000_000_000 },
  { label: "10b-20b", min: 10_000_000_000, max: 20_000_000_000 },
  { label: "20b-30b", min: 20_000_000_000, max: 30_000_000_000 },
  { label: "30b-40b", min: 30_000_000_000, max: 40_000_000_000 },
  { label: "40b-50b", min: 40_000_000_000, max: 50_000_000_000 },
  { label: "50b+", min: 50_000_000_000, max: Number.POSITIVE_INFINITY },
];
