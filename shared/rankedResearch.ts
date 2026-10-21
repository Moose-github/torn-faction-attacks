export type ResearchRun = {
  id: string; name: string; start_date: string; end_date: string;
  from_ts: number; to_ts: number; request_limit: number; requests: number;
  status: string; cursor: string | null; discovery_done: number;
  lease_until: number; lease_token: string | null; snapshot_token: string | null;
  message: string; created_at: number; reports?: number; eligible?: number; pending?: number;
};
export type ResearchAnalysis = {
  generated_at: string; scope: string; eligible_wars: number; observations: number;
  distinct_factions: number; model_observations: number;
  range: { start: string; end: string }; prices: Record<string, number | null>;
  warnings: string[]; counts: Record<string, number>;
  summaries: { division: number; won: number; n: number; median_value: number; mean_value: number }[];
  model: ResearchModel;
  whole_war?: {
    eligible_wars: number; valued_wars: number; model_observations: number;
    mean_value: number | null; median_value: number | null;
    summaries: { winner_division: number; loser_division: number; n: number; median_value: number; mean_value: number }[];
    model: ResearchModel;
  };
};
export type ResearchModel = { available: boolean; reason?: string; method?: string; effects?: {
    field: string; label: string; available: boolean; reason?: string; status?: string;
    range?: number[]; effect_m?: number; interval_m?: number[] | null; cautions?: string[];
  }[] };
export const RESEARCH_CACHES = ['Melee Cache', 'Small Arms Cache', 'Medium Arms Cache', 'Heavy Arms Cache', 'Armor Cache'];
