import React from "react";
import { Activity, KeyRound, Settings, ShieldAlert, TestTube2, UsersRound, Volume2, VolumeX } from "lucide-react";
import { createMonitorTicket, EnemyFactionMember, getEnemyScouting, MONITOR_WORKER_URL, WarSummary } from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatNumber } from "../utils/format";

type MonitorConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

type MonitorStatus = {
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

type MonitorKeyState = {
  alias: "monitor-1" | "monitor-2";
  lastUsedAt: number | null;
  lastSuccessAt: number | null;
  backoffUntil: number | null;
  consecutiveErrors: number;
  lastError: string | null;
};

type MemberMonitorSnapshot = {
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

type MonitorEventType =
  | "hospital_exit_early"
  | "hospital_exit_expected_online"
  | "hospital_timer_decreased"
  | "hospital_exit_expected_offline";

type MonitorEvent = {
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

type MonitorMessage =
  | { type: "snapshot"; status: MonitorStatus; members: MemberMonitorSnapshot[] }
  | { type: "status"; status: MonitorStatus }
  | { type: "monitor_event"; event: MonitorEvent }
  | { type: "error"; error: string }
  | { type: "pong"; now: number; nowMs?: number; clientSentAtMs?: number | null };

type ClockSyncState = {
  offsetMs: number;
  rttMs: number;
};

const MAX_VISIBLE_EVENTS = 40;
const TEST_WAR_ID = 999_999_001;
const ALERT_VOLUME_STORAGE_KEY = "enemyHospitalMonitorAlertVolume";
const ALERT_MUTED_STORAGE_KEY = "enemyHospitalMonitorAlertMuted";

type MonitorTarget = {
  id: number;
  name: string;
  enemyFactionId: number;
  tornWarId: number | null;
  testMode: boolean;
};

export function EnemyHospitalMonitor({
  activeWar,
}: {
  activeWar: WarSummary | null;
}) {
  const [connectionState, setConnectionState] = React.useState<MonitorConnectionState>("idle");
  const [status, setStatus] = React.useState<MonitorStatus | null>(null);
  const [members, setMembers] = React.useState<MemberMonitorSnapshot[]>([]);
  const [events, setEvents] = React.useState<MonitorEvent[]>([]);
  const [socketError, setSocketError] = React.useState<string | null>(null);
  const [testFactionIdInput, setTestFactionIdInput] = React.useState("");
  const [testTarget, setTestTarget] = React.useState<MonitorTarget | null>(null);
  const [alertVolume, setAlertVolume] = React.useState(() => initialAlertVolume());
  const [alertsMuted, setAlertsMuted] = React.useState(() => initialAlertsMuted());
  const [cachedEnemyStats, setCachedEnemyStats] = React.useState<Map<number, EnemyFactionMember>>(new Map());
  const [clockSync, setClockSync] = React.useState<ClockSyncState | null>(null);
  const [lastMessageReceivedAtMs, setLastMessageReceivedAtMs] = React.useState<number | null>(null);
  const nowMs = useNowMs(250);

  const isLocalTestAvailable = isLocalhost();
  const canMonitor = Boolean(
    activeWar &&
      activeWar.status === "active" &&
      activeWar.enemy_faction_id !== null &&
      activeWar.official_end_time === null &&
      activeWar.practical_finish_time === null,
  );
  const monitorTarget = React.useMemo(
    () => (canMonitor && activeWar ? monitorTargetFromWar(activeWar) : testTarget),
    [
      activeWar?.enemy_faction_id,
      activeWar?.id,
      activeWar?.name,
      activeWar?.torn_war_id,
      canMonitor,
      testTarget,
    ],
  );

  React.useEffect(() => {
    setEvents([]);
    setMembers([]);
    setStatus(null);
    setSocketError(null);
    setCachedEnemyStats(new Map());
    setClockSync(null);
    setLastMessageReceivedAtMs(null);
  }, [monitorTarget?.id, monitorTarget?.enemyFactionId]);

  React.useEffect(() => {
    if (!monitorTarget || monitorTarget.testMode) return;

    let cancelled = false;
    getEnemyScouting(monitorTarget.name)
      .then((response) => {
        if (cancelled) return;
        setCachedEnemyStats(new Map(response.members.map((member) => [member.member_id, member])));
      })
      .catch(() => {
        if (!cancelled) setCachedEnemyStats(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [monitorTarget]);

  React.useEffect(() => {
    if (!monitorTarget) {
      setConnectionState("idle");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let clockSyncTimer: number | null = null;
    setConnectionState("connecting");
    setSocketError(null);

    function sendClockSyncPing() {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "ping", clientSentAtMs: Date.now() }));
    }

    async function connect() {
      const target = monitorTarget;
      if (!target) return;

      const ticket = target.testMode ? null : (await createMonitorTicket(target.id)).ticket;
      if (cancelled) return;

      socket = new WebSocket(monitorSocketUrl(target, ticket));

      socket.addEventListener("open", () => {
        setConnectionState("open");
        sendClockSyncPing();
        clockSyncTimer = window.setInterval(sendClockSyncPing, 5_000);
      });

      socket.addEventListener("message", (event) => {
        const receivedAtMs = Date.now();
        const message = parseMonitorMessage(event.data);
        if (!message) return;

        if (message.type === "snapshot") {
          setLastMessageReceivedAtMs(receivedAtMs);
          setStatus(message.status);
          setMembers(message.members);
        } else if (message.type === "status") {
          setLastMessageReceivedAtMs(receivedAtMs);
          setStatus(message.status);
        } else if (message.type === "monitor_event") {
          setEvents((current) => [message.event, ...current].slice(0, MAX_VISIBLE_EVENTS));
        } else if (message.type === "error") {
          setSocketError(message.error);
        } else if (message.type === "pong" && typeof message.nowMs === "number" && typeof message.clientSentAtMs === "number") {
          const rttMs = Math.max(0, receivedAtMs - message.clientSentAtMs);
          const midpointMs = message.clientSentAtMs + rttMs / 2;
          const offsetMs = midpointMs - message.nowMs;
          setClockSync((current) => (!current || rttMs <= current.rttMs ? { offsetMs, rttMs } : current));
        }
      });

      socket.addEventListener("close", () => {
        setConnectionState("closed");
      });

      socket.addEventListener("error", () => {
        setConnectionState("error");
        setSocketError("WebSocket connection failed");
      });
    }

    connect().catch((err) => {
      if (cancelled) return;
      setConnectionState("error");
      setSocketError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      if (clockSyncTimer !== null) window.clearInterval(clockSyncTimer);
      socket?.close(1000, "Monitor page closed");
    };
  }, [monitorTarget]);

  function startTestMonitor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const enemyFactionId = Number(testFactionIdInput);
    if (!Number.isInteger(enemyFactionId) || enemyFactionId <= 0) {
      setSocketError("Enter a valid enemy faction ID");
      return;
    }

    setTestTarget({
      id: TEST_WAR_ID,
      name: `Test faction ${enemyFactionId}`,
      enemyFactionId,
      tornWarId: null,
      testMode: true,
    });
  }

  function stopTestMonitor() {
    setTestTarget(null);
  }

  if (!monitorTarget) {
    return (
      <>
        <section className="panel">
          <PanelHeader title="Enemy hospital monitor" />
          <EmptyState text="No active war to monitor" />
        </section>
        {isLocalTestAvailable ? (
          <LocalMonitorTestPanel
            factionId={testFactionIdInput}
            onFactionIdChange={setTestFactionIdInput}
            onSubmit={startTestMonitor}
            error={socketError}
          />
        ) : null}
      </>
    );
  }

  const hospitalizedMembers = members.filter((member) => member.state === "Hospital").length;
  const sortedMembers = [...members].sort(compareMonitorMembers);
  const tornTiming = monitorTiming(status, nowMs, clockSync, lastMessageReceivedAtMs);

  return (
    <>
      <section className="hero-panel compact-hero-panel enemy-monitor-hero">
        <div>
          <p className="eyebrow">Enemy hospital monitor</p>
          <div className="war-title-row">
            <h2>{monitorTarget.name}</h2>
            {monitorTarget.testMode ? <span>Local test</span> : null}
          </div>
        </div>
        <div className="enemy-monitor-health-chips" aria-label="Monitor health">
          <span
            className={`enemy-monitor-health-chip ${socketHealthTone(connectionState)}`}
            title={socketHealthTooltip(connectionState)}
          >
            <b>Socket</b>
            {connectionLabel(connectionState)}
          </span>
          <span
            className={`enemy-monitor-health-chip enemy-monitor-torn-chip ${tornHealthTone(status, tornTiming)}`}
            title={tornHealthTooltip(status, tornTiming, clockSync)}
          >
            <b>Torn</b>
            <span className="enemy-monitor-timing-values">
              <span title="Estimated current age of the latest successful Torn response after translating the Worker timestamp onto this browser's clock.">
                <small>Age</small>
                {tornAgeLabel(status, tornTiming)}
              </span>
              <span title="How long ago this browser received the latest monitor status or snapshot over the WebSocket.">
                <small>Received</small>
                {formatTimingMs(tornTiming.receivedAgeMs)}
              </span>
              <span title="How long the last Torn API request took from Worker request start to response finish.">
                <small>Response</small>
                {formatTimingMs(status?.lastTornResponseMs ?? null)}
              </span>
            </span>
          </span>
        </div>
      </section>

      {monitorTarget.testMode && isLocalTestAvailable ? (
        <section className="panel enemy-monitor-test-active-panel">
          <PanelHeader title="Local test monitor" icon={<TestTube2 size={18} />} />
          <div className="enemy-monitor-test-active-row">
            <span>Polling faction {monitorTarget.enemyFactionId} with test war metadata.</span>
            <button type="button" className="panel-action-button" onClick={stopTestMonitor}>
              Stop test
            </button>
          </div>
        </section>
      ) : null}

      <section className="status-grid enemy-monitor-status-grid">
        <MetricCard
          label="Hospitalized"
          value={String(hospitalizedMembers)}
          icon={<ShieldAlert size={17} />}
          detail={`${members.length} members observed`}
        />
        <MetricCard
          label="Key health"
          value={keyHealthValue(status)}
          icon={<KeyRound size={17} />}
          detail={keyHealthDetail(status, socketError)}
        />
        <MetricCard
          label="Viewers"
          value={String(status?.connectedClients ?? 0)}
          icon={<UsersRound size={17} />}
          detail={status?.hasBaseline ? "Baseline active" : "Baseline pending"}
        />
        <MonitorSettingsCard
          volume={alertVolume}
          muted={alertsMuted}
          onVolumeChange={setAlertVolume}
          onMutedChange={setAlertsMuted}
        />
      </section>

      <section className="content-grid enemy-monitor-grid">
        <section className="panel enemy-monitor-events-panel">
          <PanelHeader title="Live alerts" aside={`${events.length}`} icon={<Activity size={18} />} />
          {events.length === 0 ? (
            <EmptyState text="No hospital events detected this session" />
          ) : (
            <div className="enemy-monitor-event-list">
              {events.map((event) => (
                <MonitorEventRow key={eventKey(event)} event={event} />
              ))}
            </div>
          )}
        </section>

        <section className="panel enemy-monitor-members-panel">
          <PanelHeader title="Enemy status" aside={`${members.length}`} />
          {sortedMembers.length === 0 ? (
            <EmptyState text="Waiting for baseline poll" />
          ) : (
            <div className="enemy-monitor-member-list">
              {sortedMembers.map((member) => (
                <MemberStatusRow
                  key={member.id}
                  member={member}
                  cachedStats={cachedEnemyStats.get(member.id) ?? null}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function MonitorSettingsCard({
  volume,
  muted,
  onVolumeChange,
  onMutedChange,
}: {
  volume: number;
  muted: boolean;
  onVolumeChange: (value: number) => void;
  onMutedChange: (value: boolean) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  function updateValue(nextValue: number) {
    onVolumeChange(nextValue);
    window.localStorage.setItem(ALERT_VOLUME_STORAGE_KEY, String(nextValue));
  }

  function toggleMuted() {
    const nextMuted = !muted;
    onMutedChange(nextMuted);
    window.localStorage.setItem(ALERT_MUTED_STORAGE_KEY, nextMuted ? "1" : "0");
  }

  return (
    <article className="metric-card enemy-monitor-settings-card">
      <div className="panel-kicker">
        <Settings size={17} />
        <span>Settings</span>
      </div>
      <div className="enemy-monitor-settings-actions">
        <button
          type="button"
          className={muted ? "icon-button active" : "icon-button"}
          aria-label={muted ? "Unmute alert sounds" : "Mute alert sounds"}
          title={muted ? "Unmute alert sounds" : "Mute alert sounds"}
          onClick={toggleMuted}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          type="button"
          className={isOpen ? "icon-button active" : "icon-button"}
          aria-label="Open monitor settings"
          title="Open monitor settings"
          onClick={() => setIsOpen((current) => !current)}
        >
          <Settings size={18} />
        </button>
      </div>
      {isOpen ? (
        <div className="enemy-monitor-settings-menu">
          <label className="enemy-monitor-settings-field">
            <span>
              Alert volume
              <strong>{muted ? "Muted" : `${volume}%`}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={volume}
              aria-label="Alert volume"
              disabled={muted}
              onChange={(event) => updateValue(Number(event.target.value))}
            />
          </label>
          <label className="enemy-monitor-settings-option disabled">
            <input type="checkbox" disabled />
            Flash urgent alerts
          </label>
          <label className="enemy-monitor-settings-option disabled">
            <input type="checkbox" disabled />
            Browser notifications
          </label>
          <label className="enemy-monitor-settings-option disabled">
            <input type="checkbox" disabled />
            Auto-open attack links
          </label>
        </div>
      ) : null}
    </article>
  );
}

function LocalMonitorTestPanel({
  factionId,
  onFactionIdChange,
  onSubmit,
  error,
}: {
  factionId: string;
  onFactionIdChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  error: string | null;
}) {
  return (
    <section className="panel enemy-monitor-test-panel">
      <PanelHeader title="Local test monitor" icon={<TestTube2 size={18} />} />
      <form className="enemy-monitor-test-form" onSubmit={onSubmit}>
        <label>
          Enemy faction ID
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={factionId}
            onChange={(event) => onFactionIdChange(event.target.value)}
            placeholder="51794"
          />
        </label>
        <button type="submit" className="panel-action-button">
          Start test
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function MonitorEventRow({ event }: { event: MonitorEvent }) {
  return (
    <a
      className={`enemy-monitor-event priority-${event.priority}`}
      href={attackUrl(event.memberId)}
      target="_blank"
      rel="noreferrer"
    >
      <div>
        <strong>{event.name}</strong>
        <span>{eventTitle(event.type)}</span>
      </div>
      <p>{eventDetail(event)}</p>
      <small>{formatLongDateTime(event.observedAt)}</small>
    </a>
  );
}

function MemberStatusRow({
  member,
  cachedStats,
  nowMs,
}: {
  member: MemberMonitorSnapshot;
  cachedStats: EnemyFactionMember | null;
  nowMs: number;
}) {
  return (
    <a
      className="enemy-monitor-member"
      href={attackUrl(member.id)}
      target="_blank"
      rel="noreferrer"
    >
      <div>
        <strong>{member.name}</strong>
      </div>
      <span className={`enemy-monitor-state ${stateClass(member.state)}`}>
        {memberStatusLabel(member, nowMs)}
      </span>
      <span className="enemy-monitor-bsp-stat" title={bspBattlestatsTitle(cachedStats)}>
        <small>BSP</small>
        {cachedStats?.bsp_battlestats == null ? "-" : formatNumber(cachedStats.bsp_battlestats)}
      </span>
      <span className={lastActionClass(member, nowMs)}>{lastActionLabel(member)}</span>
    </a>
  );
}

function monitorSocketUrl(target: MonitorTarget, ticket: string | null): string {
  const url = new URL("/ws", MONITOR_WORKER_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("warId", String(target.id));
  url.searchParams.set("warName", target.name);
  url.searchParams.set("enemyFactionId", String(target.enemyFactionId));
  if (target.tornWarId) {
    url.searchParams.set("tornWarId", String(target.tornWarId));
  }
  if (ticket) {
    url.searchParams.set("ticket", ticket);
  }
  return url.toString();
}

function monitorTargetFromWar(activeWar: WarSummary): MonitorTarget {
  return {
    id: activeWar.id,
    name: activeWar.name,
    enemyFactionId: activeWar.enemy_faction_id ?? 0,
    tornWarId: activeWar.torn_war_id,
    testMode: false,
  };
}

function parseMonitorMessage(data: unknown): MonitorMessage | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as MonitorMessage;
  } catch {
    return null;
  }
}

function compareMonitorMembers(left: MemberMonitorSnapshot, right: MemberMonitorSnapshot): number {
  const leftRank = memberStatusSortRank(left);
  const rightRank = memberStatusSortRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftUntil = left.until ?? Number.MAX_SAFE_INTEGER;
  const rightUntil = right.until ?? Number.MAX_SAFE_INTEGER;
  if (leftUntil !== rightUntil) return leftUntil - rightUntil;

  return left.name.localeCompare(right.name);
}

function connectionLabel(state: MonitorConnectionState): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "open":
      return "Live";
    case "closed":
      return "Closed";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function socketHealthTone(state: MonitorConnectionState): "ok" | "warn" | "error" {
  if (state === "open") return "ok";
  if (state === "error" || state === "closed") return "error";
  return "warn";
}

function socketHealthTooltip(state: MonitorConnectionState): string {
  switch (state) {
    case "open":
      return "WebSocket connected to the monitor Worker.";
    case "connecting":
      return "WebSocket is connecting to the monitor Worker.";
    case "closed":
      return "WebSocket is closed. Monitoring stops when no clients remain.";
    case "error":
      return "WebSocket connection failed.";
    default:
      return "WebSocket is idle.";
  }
}

function tornHealthTone(status: MonitorStatus | null, timing: MonitorTiming): "ok" | "warn" | "error" {
  if (status?.lastError) return "error";
  if (!status?.hasBaseline || timing.dataAgeMs === null) return "warn";

  if (timing.dataAgeMs > 5_000) return "error";
  if (timing.dataAgeMs > 2_000) return "warn";
  return "ok";
}

function tornHealthTooltip(status: MonitorStatus | null, timing: MonitorTiming, clockSync: ClockSyncState | null): string {
  if (status?.lastError) return `Latest Torn poll failed: ${status.lastError}`;
  if (!status?.hasBaseline) return "Waiting for the first successful Torn response to establish baseline.";
  if (timing.dataAgeMs === null) return "No successful Torn response recorded yet.";

  const response = formatTimingMs(status.lastTornResponseMs ?? null);
  const received = formatTimingMs(timing.receivedAgeMs);
  const clock = clockSync ? ` Clock sync RTT ${Math.round(clockSync.rttMs)}ms.` : " Clock sync pending.";
  return `Age since the last Torn response reached the Worker: ${formatTimingMs(timing.dataAgeMs)}. Page received the latest monitor message ${received} ago. Last Torn request took ${response}.${clock}`;
}

type MonitorTiming = {
  dataAgeMs: number | null;
  receivedAgeMs: number | null;
};

function monitorTiming(
  status: MonitorStatus | null,
  nowMs: number,
  clockSync: ClockSyncState | null,
  lastMessageReceivedAtMs: number | null,
): MonitorTiming {
  const receivedAgeMs = lastMessageReceivedAtMs === null ? null : millisecondsSinceMs(lastMessageReceivedAtMs, nowMs);
  const lastSuccessMs = status?.lastSuccessAtMs ?? (status?.lastSuccessAt ? status.lastSuccessAt * 1000 : null);
  if (!lastSuccessMs) return { dataAgeMs: null, receivedAgeMs };

  if (clockSync) {
    return {
      dataAgeMs: millisecondsSinceMs(lastSuccessMs + clockSync.offsetMs, nowMs),
      receivedAgeMs,
    };
  }

  if (typeof status?.serverNowMs === "number") {
    const workerAgeAtSendMs = Math.max(0, status.serverNowMs - lastSuccessMs);
    return {
      dataAgeMs: workerAgeAtSendMs + (receivedAgeMs ?? 0),
      receivedAgeMs,
    };
  }

  return { dataAgeMs: null, receivedAgeMs };
}

function tornAgeLabel(status: MonitorStatus | null, timing: MonitorTiming): string {
  if (status?.lastError) return "Error";
  if (!status?.hasBaseline) return "Baseline";
  return formatTimingMs(timing.dataAgeMs);
}

function formatTimingMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const rounded = Math.max(1, Math.round(value));
  return `${rounded}ms`;
}

function memberStatusSortRank(member: MemberMonitorSnapshot): number {
  if (member.state === "Okay") return 0;
  if (member.state === "Hospital") return 1;
  return 2;
}

function keyHealthValue(status: MonitorStatus | null): string {
  if (!status) return "Waiting";
  if (status.keyStates.length === 0) return "Unknown";

  const availableKeys = status.keyStates.filter((key) => !key.backoffUntil || key.backoffUntil <= nowSeconds()).length;
  return `${availableKeys}/${status.keyStates.length}`;
}

function keyHealthDetail(status: MonitorStatus | null, socketError: string | null): string {
  if (status?.lastError) return status.lastError;
  if (socketError) return socketError;

  const keyError = status?.keyStates.find((key) => key.lastError)?.lastError;
  return keyError ?? "Monitor keys available";
}

function bspBattlestatsTitle(member: EnemyFactionMember | null): string {
  if (!member) return "No cached enemy scouting row for this player.";
  if (member.bsp_battlestats == null) return "No cached BSP battle stats for this player.";
  const updated = member.bsp_battlestats_updated_at ? formatLongDateTime(member.bsp_battlestats_updated_at) : "unknown time";
  return `Cached BSP battle stats. Updated ${updated}.`;
}

function lastActionLabel(member: MemberMonitorSnapshot): string {
  return member.lastActionStatus === "Online" ? "Online" : (member.lastActionRelative ?? "No activity");
}

function lastActionClass(member: MemberMonitorSnapshot, nowMs: number): string {
  return isUrgentLastAction(member, nowMs) ? "enemy-monitor-last-action urgent" : "enemy-monitor-last-action";
}

function isUrgentLastAction(member: MemberMonitorSnapshot, nowMs: number): boolean {
  if (member.lastActionStatus === "Online") return true;
  if (!member.lastActionTimestamp) return false;

  return nowMs / 1000 - member.lastActionTimestamp < 150;
}

function attackUrl(memberId: number): string {
  return `https://www.torn.com/page.php?sid=attack&user2ID=${encodeURIComponent(String(memberId))}`;
}

function millisecondsSinceMs(timestampMs: number, nowMs: number): number {
  return Math.max(0, nowMs - timestampMs);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function initialAlertVolume(): number {
  const stored = Number(window.localStorage.getItem(ALERT_VOLUME_STORAGE_KEY));
  if (Number.isFinite(stored) && stored >= 0 && stored <= 100) {
    return stored;
  }

  return 70;
}

function initialAlertsMuted(): boolean {
  return window.localStorage.getItem(ALERT_MUTED_STORAGE_KEY) === "1";
}

function useNowMs(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function eventTitle(type: MonitorEventType): string {
  switch (type) {
    case "hospital_exit_early":
      return "Early hospital exit";
    case "hospital_exit_expected_online":
      return "Expected exit, active";
    case "hospital_timer_decreased":
      return "Timer moved earlier";
    case "hospital_exit_expected_offline":
      return "Expected exit, offline";
  }
}

function eventDetail(event: MonitorEvent): string {
  if (event.type === "hospital_exit_early") {
    return `${event.secondsEarly ?? 0}s before expected release`;
  }
  if (event.type === "hospital_timer_decreased") {
    return `Timer decreased by ${event.decreaseSeconds ?? 0}s`;
  }
  return event.lastActionRelative
    ? `${event.lastActionStatus ?? "Last action"} ${event.lastActionRelative}`
    : event.currentDescription ?? "Released from hospital";
}

function eventKey(event: MonitorEvent): string {
  return `${event.type}:${event.memberId}:${event.previousUntil ?? "none"}:${event.currentUntil ?? "none"}:${event.observedAt}`;
}

function memberStatusLabel(member: MemberMonitorSnapshot, nowMs: number): string {
  if (member.state === "Traveling") return "Traveling";
  if (member.state === "Hospital") {
    if (member.until) return hospitalTimeRemainingLabel(member.until, nowMs);
    return cleanHospitalDescription(member.description);
  }
  return member.description ?? member.state ?? "Unknown";
}

function hospitalTimeRemainingLabel(until: number, nowMs: number): string {
  const remainingSeconds = Math.ceil((until * 1000 - nowMs) / 1000);
  if (remainingSeconds <= 0) return "Due now";

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.ceil((remainingSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours} hrs ${minutes} mins`;
  if (hours > 0) return `${hours} hrs`;
  return `${Math.max(1, minutes)} mins`;
}

function cleanHospitalDescription(description: string | null): string {
  const cleaned = description?.replace(/^In hospital for\s*/i, "").trim();
  return cleaned || "Hospital";
}

function stateClass(state: string | null): string {
  if (state === "Hospital") return "hospital";
  if (state === "Okay") return "okay";
  if (state === "Traveling" || state === "Abroad") return "travel";
  return "other";
}

function isLocalhost(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}
