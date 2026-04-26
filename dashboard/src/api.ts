const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "https://torn-faction-attacks.moose-3065754.workers.dev";

export type WarType = "all" | "real" | "termed" | "other";

export type OverallStats = {
  total_wars: number;
  faction_attacks: number;
  enemy_attacks: number;
  outside_hits_outgoing: number;
  total_respect_gain: number;
  total_respect_lost: number;
  latest_attack_started: number | null;
};

export type MemberStats = {
  member_id: number;
  member_name: string | null;
  wars_participated: number;
  enemy_attacks_total: number;
  enemy_attacks_successful: number;
  enemy_respect_gained: number;
  enemy_assists: number;
  enemy_hospitalizations: number;
  enemy_mugs: number;
  outside_attacks: number;
  friendly_hospitals: number;
  defends_total: number;
  defends_won: number;
  respect_lost: number;
  first_seen_at: number | null;
  last_seen_at: number | null;
};

export type StatsResponse = {
  ok: boolean;
  war_type: Exclude<WarType, "all"> | null;
  overall: OverallStats;
  top_members: MemberStats[];
};

export type WarSummary = {
  id: number;
  name: string;
  status: string;
  start_time: number;
  finish_time: number | null;
  faction_id: number | null;
  war_type: Exclude<WarType, "all"> | null;
  torn_war_id: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
  member_respect_limit: number | null;
  last_respect_check_at: number | null;
  last_observed_respect: number | null;
  finalized_at: number | null;
  faction_attacks: number;
  enemy_attacks: number;
  outside_hits_outgoing: number;
  total_respect_gain: number;
  total_respect_lost: number;
  unique_attackers: number;
  first_attack_at: number | null;
  last_attack_at: number | null;
  summary_updated_at: number | null;
};

export type WarsResponse = {
  ok: boolean;
  wars: WarSummary[];
};

export type WarDetailResponse = {
  ok: boolean;
  war: WarSummary;
  summary: {
    war_id: number;
    war_name: string;
    status: string;
    start_time: number;
    finish_time: number | null;
    faction_attacks: number;
    enemy_attacks: number;
    outside_hits_outgoing: number;
    total_respect_gain: number;
    total_respect_lost: number;
    unique_attackers: number;
    first_attack_at: number | null;
    last_attack_at: number | null;
    updated_at: number;
    finalized_at: number | null;
  } | null;
  members: MemberStats[];
};

export async function getStats(warType: WarType): Promise<StatsResponse> {
  return getJson<StatsResponse>(`/api/stats${queryForWarType(warType)}`);
}

export async function getWars(warType: WarType): Promise<WarsResponse> {
  return getJson<WarsResponse>(`/api/wars${queryForWarType(warType)}`);
}

export async function getWar(name: string): Promise<WarDetailResponse> {
  return getJson<WarDetailResponse>(`/api/wars/${encodeURIComponent(name)}`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

function queryForWarType(warType: WarType): string {
  return warType === "all" ? "" : `?war_type=${encodeURIComponent(warType)}`;
}
