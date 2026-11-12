export const RECRUITMENT_MIN_STATS = 100_000;
export const RECRUITMENT_CALLS_PER_KEY = 10;
export const CITY_JOBS = ['Army', 'Casino', 'Education', 'Grocer', 'Medical', 'Law'] as const;
export type RecruitmentScan = {
  id: number;
  run_id: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  next_offset: number;
  pages_saved: number;
  players_saved: number;
  calls_used: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
  last_error: string | null;
  retry_at: number;
  failures: number;
  lease_token: string | null;
  lease_until: number;
  last_value: number | null;
};
export type RecruitmentSnapshot = {
  id: string;
  snapshot_date: string;
  imported_at: number;
  total_players: number;
  unemployed: number;
  city_jobs: number;
  excluded_fed: number;
};
export type RecruitmentCandidate = {
  player_id: number;
  username: string;
  city_job: string | null;
  level: number;
  faction_id: number | null;
  total_work_stats: number | null;
  hof_position: number | null;
  work_stats_checked_at: number | null;
};
export type RecruitmentStatus = {
  scan: Omit<RecruitmentScan, 'lease_token'>;
  snapshot: RecruitmentSnapshot | null;
  keys: { available: number; total: number; calls_per_minute: number };
  min_work_stats: number;
};
export type RecruitmentResults = {
  candidates: RecruitmentCandidate[];
  total: number;
  matched: number;
  unknown: number;
  page: number;
  snapshot_id: string | null;
};
