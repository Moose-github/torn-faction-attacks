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
  report_added?: number;
};

export type StatsResponse = {
  ok: boolean;
  war_type: Exclude<WarType, "all"> | null;
  overall: OverallStats;
  members: MemberStats[];
  top_members?: MemberStats[];
};

export type WarSummary = {
  id: number;
  name: string;
  status: string;
  start_time: number;
  finish_time: number | null;
  official_start_time: number | null;
  official_end_time: number | null;
  faction_id: number | null;
  war_type: Exclude<WarType, "all"> | null;
  torn_war_id: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
  member_respect_limit: number | null;
  last_respect_check_at: number | null;
  last_observed_respect: number | null;
  winner_faction_id: number | null;
  torn_report_fetched_at: number | null;
  home_report_score: number | null;
  home_report_attacks: number | null;
  enemy_report_score: number | null;
  enemy_report_attacks: number | null;
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
    official_start_time: number | null;
    official_end_time: number | null;
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
  chain_bonuses: ChainBonusAttack[];
};

export type MemberAttackClassification =
  | "enemy_success"
  | "enemy_assist"
  | "enemy_attempt"
  | "outside"
  | "defend_lost"
  | "defend_won"
  | "other";

export type MemberAttack = {
  id: number;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  attacker_faction_id: number | null;
  attacker_faction_name: string | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number;
  respect_loss: number;
  classification: MemberAttackClassification;
};

export type ChainBonusAttack = Pick<
  MemberAttack,
  | "id"
  | "started"
  | "attacker_id"
  | "attacker_name"
  | "attacker_faction_id"
  | "attacker_faction_name"
  | "defender_id"
  | "defender_name"
  | "defender_faction_id"
  | "defender_faction_name"
  | "result"
  | "respect_gain"
  | "respect_loss"
> & {
  chain: number | null;
  adjusted_respect_gain: number;
  respect_removed: number;
};

export type MemberAttacksResponse = {
  ok: boolean;
  member_id: number;
  paging: {
    limit: number;
    returned: number;
  };
  attacks: MemberAttack[];
};

export type WarActivityBucket = {
  bucket_start: number;
  enemy_success: number;
  enemy_assist: number;
  outside: number;
  defend_lost: number;
  defend_won: number;
};

export type WarActivityResponse = {
  ok: boolean;
  bucket_minutes: number;
  buckets: WarActivityBucket[];
};

export type ReportDiscrepancyGroup = {
  count: number;
  respect_gain: number;
  attacks: Array<Pick<
    MemberAttack,
    | "id"
    | "started"
    | "attacker_id"
    | "attacker_name"
    | "attacker_faction_id"
    | "attacker_faction_name"
    | "defender_id"
    | "defender_name"
    | "defender_faction_id"
    | "defender_faction_name"
    | "result"
    | "respect_gain"
    | "respect_loss"
  > & Partial<Pick<ChainBonusAttack, "chain" | "adjusted_respect_gain" | "respect_removed">>>;
};

export type ReportDiscrepanciesResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    start_time: number;
    finish_time: number | null;
    official_start_time: number | null;
    official_end_time: number | null;
    faction_id: number | null;
    war_type: Exclude<WarType, "all">;
  };
  groups: Record<string, ReportDiscrepancyGroup>;
};

export type AdminWarPayload = {
  name?: string;
  start_time?: number;
  finish_time?: number;
  official_start_time?: number;
  official_finish_time?: number;
  faction_id?: number;
  war_type: Exclude<WarType, "all">;
  torn_war_id?: number;
  auto_end_enabled?: boolean;
  faction_respect_limit?: number;
  member_respect_limit?: number;
};

export type AttackWindowPayload = {
  start_time: number;
  finish_time: number;
  limit?: number;
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

export async function getWarMemberAttacks(
  warName: string,
  memberId: number,
): Promise<MemberAttacksResponse> {
  return getJson<MemberAttacksResponse>(
    `/api/wars/${encodeURIComponent(warName)}/members/${memberId}/attacks`,
  );
}

export async function getWarActivity(warName: string): Promise<WarActivityResponse> {
  return getJson<WarActivityResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity?bucket_minutes=15`,
  );
}

export async function getWarReportDiscrepancies(
  warName: string,
): Promise<ReportDiscrepanciesResponse> {
  return getJson<ReportDiscrepanciesResponse>(
    `/api/wars/${encodeURIComponent(warName)}/report-discrepancies`,
  );
}

export async function checkHealth(): Promise<unknown> {
  return getJson("/api/health");
}

export async function runIngestion(): Promise<unknown> {
  return postJson("/api/run");
}

export async function rebuildStats(): Promise<unknown> {
  return postJson("/api/rebuild");
}

export async function createWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars", payload);
}

export async function importWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import", payload);
}

export async function previewImportWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import/preview", {
    start_time: payload.start_time,
    finish_time: payload.finish_time,
    official_start_time: payload.official_start_time,
    official_finish_time: payload.official_finish_time,
    war_type: payload.war_type,
    torn_war_id: payload.torn_war_id,
  });
}

export async function pullAttackWindow(payload: AttackWindowPayload): Promise<unknown> {
  return postJson("/api/attacks/window", payload);
}

export async function deleteWar(payload: {
  torn_war_id?: number;
  name?: string;
}): Promise<unknown> {
  return postJson("/api/wars/delete", payload);
}

export async function endActiveWar(): Promise<unknown> {
  return postJson("/api/wars/end");
}

export async function fetchTornWarReport(tornWarId: number): Promise<unknown> {
  return postJson(`/api/torn-wars/${encodeURIComponent(tornWarId)}/report/fetch`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

async function postJson<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

function queryForWarType(warType: WarType): string {
  return warType === "all" ? "" : `?war_type=${encodeURIComponent(warType)}`;
}
