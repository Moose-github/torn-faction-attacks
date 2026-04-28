export interface Env {
  DB: D1Database;
  TORN_API_KEY: string;
}

export type D1Database = any;
export type D1PreparedStatement = any;
export type ScheduledController = any;
export type ExecutionContext = any;

export type TornAttackResponse = {
  attacks?: TornAttack[] | Record<string, TornAttack>;
};

export type TornRankedWarResponse = {
  rankedwars?: TornRankedWar[];
};

export type TornRankedWarReportResponse = {
  rankedwarreport?: TornRankedWarReport;
};

export type TornRankedWar = {
  id: number;
  start: number;
  end: number;
  target: number;
  winner: number | null;
  factions?: TornRankedWarFaction[];
};

export type TornRankedWarFaction = {
  id: number;
  name: string;
  score: number;
  chain: number;
};

export type TornRankedWarReport = {
  id: number;
  start: number;
  end: number;
  winner: number | null;
  factions?: TornRankedWarReportFaction[];
};

export type TornRankedWarReportFaction = {
  id: number;
  name: string;
  score: number;
  attacks: number;
  members?: TornRankedWarReportMember[];
};

export type TornRankedWarReportMember = {
  id: number;
  name: string;
  level: number;
  attacks: number;
  score: number;
};

export type TornAttack = {
  id: number;
  code?: string;
  started?: number;
  ended?: number;

  attacker?: TornAttackUser | null;
  defender?: TornAttackUser | null;

  result?: string;
  respect_gain?: number;
  respect_loss?: number;

  chain?: number;
  is_interrupted?: boolean;
  is_stealthed?: boolean;
  is_raid?: boolean;
  is_ranked_war?: boolean;

  modifiers?: {
    fair_fight?: number;
    war?: number;
    retaliation?: number;
    group?: number;
    overseas?: number;
    chain?: number;
    warlord?: number;
  };
};

export type TornAttackUser = {
  id?: number;
  name?: string;
  level?: number;
  faction?: {
    id?: number;
    name?: string;
  } | null;
};

export type WarRow = {
  id: number;
  name: string;
  status: string;
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
  official_end_time: number | null;
  enemy_faction_id: number | null;
  war_type: string | null;
  torn_war_id: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
  member_respect_limit: number | null;
  winner_faction_id: number | null;
  torn_report_fetched_at: number | null;
  official_home_score: number | null;
  official_home_attacks: number | null;
  official_enemy_score: number | null;
  official_enemy_attacks: number | null;
  finalized_at: number | null;
};

export type WarSummaryRow = {
  war_id: number;
  faction_attacks: number;
  enemy_attacks: number;
  outside_hits_outgoing: number;
  total_respect_gain: number;
  total_respect_lost: number;
  unique_attackers: number;
  first_attack_at: number | null;
  last_attack_at: number | null;
  updated_at: number;
};
