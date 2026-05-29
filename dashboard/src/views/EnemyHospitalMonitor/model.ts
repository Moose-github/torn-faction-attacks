export type MonitorConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

export type MonitorStatus = {
  activeWar: {
    warId: number;
    warName: string;
    enemyFactionId: number;
    tornWarId?: number | null;
  } | null;
  connectedClients: number;
  hasBaseline: boolean;
  lastPollStartedAt: number | null;
  lastPollFinishedAt: number | null;
  lastSuccessAt: number | null;
  lastSuccessAtMs?: number | null;
  lastTornResponseMs?: number | null;
  serverNowMs?: number | null;
  lastError: string | null;
  nextPollAt: number | null;
  keyStates: MonitorKeyState[];
  keepAliveUntil: number | null;
};

export type MonitorKeyState = {
  alias: "monitor-1" | "monitor-2";
  lastUsedAt: number | null;
  lastSuccessAt: number | null;
  backoffUntil: number | null;
  consecutiveErrors: number;
  lastError: string | null;
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

export type MonitorMessage =
  | { type: "snapshot"; status: MonitorStatus; members: MemberMonitorSnapshot[] }
  | { type: "status"; status: MonitorStatus }
  | { type: "monitor_event"; event: MonitorEvent }
  | { type: "error"; error: string }
  | { type: "pong"; now: number; nowMs?: number; clientSentAtMs?: number | null };

export type ClockSyncState = {
  offsetMs: number;
  rttMs: number;
};

export const MAX_VISIBLE_EVENTS = 40;
export const TIMER_ALERT_COOLDOWN_SECONDS = 15 * 60;
export const TEST_WAR_ID = 999_999_001;
export const ALERT_VOLUME_STORAGE_KEY = "enemyHospitalMonitorAlertVolume";
export const ALERT_MUTED_STORAGE_KEY = "enemyHospitalMonitorAlertMuted";
export const ALERT_PREFERENCES_STORAGE_KEY = "enemyHospitalMonitorAlertPreferences";
export const HIDE_ABROAD_HOSPITALS_STORAGE_KEY = "enemyHospitalMonitorHideAbroadHospitals";
export const SORT_ACTIVE_ENEMIES_TOP_STORAGE_KEY = "enemyHospitalMonitorSortActiveEnemiesTop";
export const TRAVEL_ALERTS_ENABLED_STORAGE_KEY = "enemyHospitalMonitorTravelAlertsEnabled";
export const ENEMY_STATUS_COLUMNS_STORAGE_KEY = "enemyHospitalMonitorStatusColumns";
export const COMPACT_BATTLE_STATS_STORAGE_KEY = "enemyHospitalMonitorCompactBattleStats";
export const ACTIVE_MEMBERS_SECTION_PLACEMENT_STORAGE_KEY = "enemyHospitalMonitorActiveMembersSectionPlacement";
export const ALERT_PRIORITIES = [1, 2, 3, 4] as const;

export type AlertPriority = MonitorEvent["priority"];
export type AlertChannel = "sound" | "flash";
export type AlertPreferences = Record<AlertPriority, Record<AlertChannel, boolean>>;
export type ActiveMembersSectionPlacement = "enemyStatus" | "liveAlerts";
export type EnemyStatusColumnId = (typeof ENEMY_STATUS_COLUMNS)[number]["id"];
export type EnemyStatusColumnPreferences = {
  order: EnemyStatusColumnId[];
  visible: Record<EnemyStatusColumnId, boolean>;
};

export type TimerReductionSummary = {
  count: number;
  totalDecreaseSeconds: number;
  latestDecreaseSeconds: number;
  firstObservedAt: number;
  latestObservedAt: number;
};

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  1: { sound: true, flash: true },
  2: { sound: true, flash: false },
  3: { sound: false, flash: false },
  4: { sound: false, flash: false },
};

export const ENEMY_STATUS_COLUMNS = [
  { id: "name", label: "Name", track: "minmax(120px, 1fr)", defaultVisible: true },
  { id: "status", label: "Hosp / travel", track: "minmax(130px, 1fr)", defaultVisible: true },
  { id: "battleStats", label: "Battlestats", track: "minmax(72px, auto)", defaultVisible: true },
  { id: "lastAction", label: "Last action", track: "minmax(118px, auto)", defaultVisible: true },
  { id: "level", label: "Level", track: "minmax(52px, auto)", defaultVisible: false },
  { id: "revivable", label: "Revivable", track: "minmax(78px, auto)", defaultVisible: false },
  { id: "networth", label: "Networth", track: "minmax(82px, auto)", defaultVisible: false },
  { id: "position", label: "Position", track: "minmax(104px, 1fr)", defaultVisible: false },
] as const;

export const DEFAULT_ENEMY_STATUS_COLUMN_PREFERENCES: EnemyStatusColumnPreferences = {
  order: ENEMY_STATUS_COLUMNS.map((column) => column.id),
  visible: ENEMY_STATUS_COLUMNS.reduce(
    (visible, column) => ({ ...visible, [column.id]: column.defaultVisible }),
    {} as Record<EnemyStatusColumnId, boolean>,
  ),
};

export type MonitorTarget = {
  id: number;
  name: string;
  enemyFactionId: number;
  tornWarId: number | null;
  testMode: boolean;
};

