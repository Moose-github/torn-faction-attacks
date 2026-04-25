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
  started_at: number;
  ended_at: number | null;
  finalized_at: number | null;
};

export type WarSummaryRow = {
  war_id: number;
  war_name: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  total_attacks: number;
  total_respect_gain: number;
  total_respect_lost: number;
  unique_attackers: number;
  unique_members_lost_defends: number;
  first_attack_at: number | null;
  last_attack_at: number | null;
  updated_at: number;
  finalized_at: number | null;
};
