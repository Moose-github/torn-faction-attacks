import type { EnemyHospitalMonitor } from "./EnemyHospitalMonitor";

export type MonitorEnv = {
  ENEMY_HOSPITAL_MONITOR: DurableObjectNamespace<EnemyHospitalMonitor>;
  DB: D1Database;
  TORN_KEY_STORAGE_SECRET?: string | SecretsStoreSecret;
  TORN_API_KEY_POOL_1?: string | SecretsStoreSecret;
  TORN_API_KEY_POOL_2?: string | SecretsStoreSecret;
  MONITOR_TORN_API_KEY_1?: string;
  MONITOR_TORN_API_KEY_2?: string;
  MONITOR_TICKET_SECRET?: string | SecretsStoreSecret;
};

export type ActiveWarConfig = {
  warId: number;
  warName: string;
  enemyFactionId: number;
  tornWarId?: number | null;
};

export type TornFactionMembersResponse = {
  members?: TornFactionMember[];
  error?: {
    code?: number;
    error?: string;
  };
};

export type TornFactionMember = {
  id: number;
  name: string;
  level?: number;
  last_action?: {
    status?: string;
    timestamp?: number;
    relative?: string;
  };
  status?: {
    description?: string | null;
    details?: string | null;
    state?: string | null;
    color?: string | null;
    until?: number | null;
  } | null;
  has_early_discharge?: boolean;
};

export type MemberMonitorSnapshot = {
  id: number;
  name: string;
  level: number | null;
  state: string | null;
  description: string | null;
  details: string | null;
  until: number | null;
  observedAt: number;
  lastActionStatus: string | null;
  lastActionTimestamp: number | null;
  lastActionRelative: string | null;
  hasEarlyDischarge: boolean;
};

export type MonitorEventType =
  | "hospital_exit_early"
  | "hospital_exit_expected_online"
  | "hospital_timer_decreased"
  | "hospital_exit_expected_offline"
  | "travel_return_expected_online"
  | "travel_return_expected_offline";

export type MonitorEvent = {
  type: MonitorEventType;
  priority: 1 | 2 | 3 | 4;
  memberId: number;
  name: string;
  observedAt: number;
  previousUntil: number | null;
  currentUntil: number | null;
  secondsEarly?: number;
  decreaseSeconds?: number;
  previousDetails: string | null;
  currentDescription: string | null;
  lastActionStatus: string | null;
  lastActionTimestamp: number | null;
  lastActionRelative: string | null;
};

export type MonitorKeyState = {
  alias: string;
  lastUsedAt: number | null;
  lastSuccessAt: number | null;
  backoffUntil: number | null;
  consecutiveErrors: number;
  lastError: string | null;
};

export type MonitorStatus = {
  activeWar: ActiveWarConfig | null;
  connectedClients: number;
  hasBaseline: boolean;
  lastPollStartedAt: number | null;
  lastPollFinishedAt: number | null;
  lastSuccessAt: number | null;
  lastSuccessAtMs: number | null;
  lastTornResponseMs: number | null;
  serverNowMs: number;
  lastError: string | null;
  nextPollAt: number | null;
  keyStates: MonitorKeyState[];
  keepAliveUntil: number | null;
};
