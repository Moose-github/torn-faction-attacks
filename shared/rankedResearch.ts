export type ResearchRun = {
  id: string; name: string; start_date: string; end_date: string;
  from_ts: number; to_ts: number; request_limit: number; requests: number;
  status: string; cursor: string | null; discovery_done: number;
  lease_until: number; lease_token: string | null; snapshot_token: string | null;
  message: string; created_at: number; reports?: number; eligible?: number; pending?: number;
  collection_json?: string | null;
  retry_at: number; consecutive_failures: number;
  last_success_at: number | null; last_saved_at: number | null; last_tick_at: number | null; last_error: string | null;
  reused?: number; deferred?: number; exhausted?: number;
};
export type ResearchHealth = {
  requests_last_minute: number; requests_last_five_minutes: number; failures_last_five_minutes: number;
  remaining_budget: number; budget_minutes: number | null;
  opted_in_owners: number; cooling_keys: number;
  issues: { war_id: number; failures: number; next_attempt_at: number; last_error: string }[];
  issue_count: number;
  next_issue: number | null;
};
export type ResearchAnalysis = {
  generated_at: string; scope: string; eligible_wars: number; observations: number;
  distinct_factions: number; model_observations: number;
  range: { start: string; end: string }; prices: Record<string, number | null>;
  warnings: string[]; counts: Record<string, number>;
  summaries: { division: number; won: number; n: number; median_value: number; mean_value: number }[];
  model: ResearchModel;
  coverage?: ResearchCoverage;
  comparisons?: ResearchComparison[];
  graphs?: ResearchGraphs;
  whole_war?: {
    eligible_wars: number; valued_wars: number; model_observations: number;
    mean_value: number | null; median_value: number | null;
    summaries: { winner_division: number; loser_division: number; n: number; median_value: number; mean_value: number }[];
    model: ResearchModel;
    comparisons?: ResearchComparison[];
    graphs?: ResearchGraphs;
  };
};
export type ResearchModel = { available: boolean; reason?: string; method?: string; effects?: {
    field: string; label: string; available: boolean; reason?: string; status?: string;
    range?: number[]; effect_m?: number; interval_m?: number[] | null; cautions?: string[];
  }[] };
export const RESEARCH_CACHES = ['Melee Cache', 'Small Arms Cache', 'Medium Arms Cache', 'Heavy Arms Cache', 'Armor Cache'];

export type ResearchCoverage = {
  saved_reports: number; eligible_wars: number; valued_wars: number; model_wars: number;
  distinct_factions: number; first_saved: string | null; last_saved: string | null;
  collection: { discovery_done: boolean; discovered_wars: number; saved_reports: number; pending_reports: number; deferred_reports?: number; failed_reports?: number } | null;
  weeks: { start: string; end: string; saved: number; eligible: number; valued: number; factions: number }[];
  division_pairs: { winner_division: number; loser_division: number; wars: number }[];
  rosters: { label: string; observations: number; wars: number; factions: number }[];
  top_factions: { id: number; name: string; wars: number }[];
  warnings: string[];
};
export type ResearchComparison = {
  field: string; question: string; unit: string; status: string; explanation: string;
  observations: number; wars: number; factions: number;
  groups: { label: string; n: number; wars: number; factions: number; mean_value: number; median_value: number }[];
  observed_difference: number | null; observed_percent: number | null;
  observed?: { status: string; explanation: string };
  score_bands?: { low: number; high: number | null; n: number; wars: number;
    mean_value: number | null; median_value: number | null; middle_half: number[] | null }[];
  adjusted: { range: number[]; difference: number; percent_of_mean: number | null;
    interval: number[] | null; stable_halves: boolean | null; sensitive_to_top_faction: boolean | null; overlap_vif?: number } | null;
  cautions: string[];
};

export type ResearchGraphs = {
  observations: number; wars: number; value_range: number[];
  factors: { field: string; label: string; unit: string; range: number[];
    medians: { x: number; y: number; n: number }[] }[];
  points: { war_id: number; faction_id: number; value: number; values: number[] }[];
  distributions: { label: string; n: number; wars: number; five_number: number[] }[];
};
// Zero represents the API's unsuffixed base rank, not Platinum I.
export const researchPlatinumLabel = (division: number) => division === 0 ? 'Platinum' : `Platinum ${division}`;

export type ResearchFactorGraphs = Omit<ResearchGraphs, 'distributions'>;
export type ResearchTopFaction = {
  id: number; name: string; rank_before: string; gross_value: number;
  attacks: number; score: number; listed_members: number;
  participation_rate: number; top20_attack_share: number;
  warnings: string[];
};
export type ResearchTopWar = {
  war_id: number; gross_value: number; duration_hours: number;
  combined_score: number; attack_balance: number;
  winner: ResearchTopFaction; loser: ResearchTopFaction;
};
export type ResearchTopWars = { valued_wars: number; wars: ResearchTopWar[] };
export type WarResearchResults = {
  name: string; generated_at: string; range: { start: string; end: string };
  prices: Record<string, number | null>; coverage?: ResearchCoverage;
  combined?: ResearchFactorGraphs; faction?: ResearchFactorGraphs;
  top_wars?: ResearchTopWars;
};
export type WarResearchResultsResponse = { ok: true; result: WarResearchResults | null };
