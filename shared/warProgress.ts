export const WAR_SCORE_INTERVAL_SECONDS = 15 * 60;
export const RANKED_WAR_MAX_HOURS = 124;

export type WarScorePoint = {
  bucket_start: number;
  observed_at: number;
  home_score: number;
  enemy_score: number;
  target: number;
};

export type WarScoreState = {
  observed_at: number;
  official_start_time: number;
  ended_at: number | null;
  home_name: string;
  enemy_name: string;
  home_score: number;
  enemy_score: number;
  target: number;
  original_target: number | null;
};

export type WarProgressResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    war_type: string | null;
    torn_war_id: number | null;
    official_start_time: number | null;
    official_end_time: number | null;
    official_home_score: number | null;
    official_enemy_score: number | null;
    winner_faction_id: number | null;
    enemy_faction_id: number | null;
    faction_respect_limit: number | null;
    enemy_target_respect: number | null;
  };
  latest: WarScoreState | null;
  history: WarScorePoint[];
  interval_seconds: number;
};

// The first 24 hours retain the full target; subsequent hourly decrements
// remove 1% of the original, reaching zero at war hour 124.
export function rankedTargetFraction(start: number, at: number): number {
  const hours = Math.floor(Math.max(0, at - start) / 3600);
  return Math.max(0, 100 - Math.max(0, hours - 24)) / 100;
}

export function originalRankedTarget(target: number, start: number, observedAt: number): number | null {
  const fraction = rankedTargetFraction(start, observedAt);
  return Number.isFinite(target) && target > 0 && fraction > 0 ? target / fraction : null;
}

export function rankedTargetAt(original: number, start: number, at: number): number {
  return original * rankedTargetFraction(start, at);
}

// A fixed-score scenario, never an extrapolation of attack pace.
// Null means there is no winning side or not enough target information.
export function rankedFinishAt(original: number | null, start: number, lead: number, now: number): number | null {
  if (original === null || !Number.isFinite(original) || original <= 0 || !Number.isFinite(lead) || lead === 0) return null;
  const at = Math.max(start, now);
  const required = Math.abs(lead);
  const tolerance = original * 1e-12;
  if (required + tolerance >= rankedTargetAt(original, start, at)) return at;
  const firstHour = Math.max(25, Math.floor((at - start) / 3600) + 1);
  for (let hour = firstHour; hour <= RANKED_WAR_MAX_HOURS; hour++) {
    const finish = start + hour * 3600;
    if (required + tolerance >= rankedTargetAt(original, start, finish)) return finish;
  }
  return null;
}

export function previewFinalScore(current: number, input: string): number | null {
  const entered = input.trim() === "" ? current : Number(input);
  return Number.isFinite(entered) && entered >= 0 && entered <= Number.MAX_SAFE_INTEGER ? Math.max(current, entered) : null;
}
