import React from "react";
import { Activity, KeyRound, Settings, ShieldAlert, TestTube2, UsersRound, Volume2, VolumeX } from "lucide-react";
import { createMonitorTicket, EnemyFactionMember, getEnemyScouting, MONITOR_WORKER_URL, WarSummary } from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatNumber, formatTime } from "../utils/format";

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
  | "hospital_exit_expected_offline"
  | "travel_return_expected_online"
  | "travel_return_expected_offline";

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
const TIMER_ALERT_COOLDOWN_SECONDS = 15 * 60;
const TEST_WAR_ID = 999_999_001;
const ALERT_VOLUME_STORAGE_KEY = "enemyHospitalMonitorAlertVolume";
const ALERT_MUTED_STORAGE_KEY = "enemyHospitalMonitorAlertMuted";
const ALERT_PREFERENCES_STORAGE_KEY = "enemyHospitalMonitorAlertPreferences";
const HIDE_ABROAD_HOSPITALS_STORAGE_KEY = "enemyHospitalMonitorHideAbroadHospitals";
const SORT_ACTIVE_ENEMIES_TOP_STORAGE_KEY = "enemyHospitalMonitorSortActiveEnemiesTop";
const TRAVEL_ALERTS_ENABLED_STORAGE_KEY = "enemyHospitalMonitorTravelAlertsEnabled";
const ALERT_PRIORITIES = [1, 2, 3, 4] as const;

type AlertPriority = MonitorEvent["priority"];
type AlertChannel = "sound" | "flash";
type AlertPreferences = Record<AlertPriority, Record<AlertChannel, boolean>>;

type TimerReductionSummary = {
  count: number;
  totalDecreaseSeconds: number;
  latestDecreaseSeconds: number;
  firstObservedAt: number;
  latestObservedAt: number;
};

const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  1: { sound: true, flash: true },
  2: { sound: true, flash: false },
  3: { sound: false, flash: false },
  4: { sound: false, flash: false },
};

let monitorAlertAudioContext: AudioContext | null = null;

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
  const [alertPreferences, setAlertPreferences] = React.useState(() => initialAlertPreferences());
  const [hideAbroadHospitals, setHideAbroadHospitals] = React.useState(() => initialHideAbroadHospitals());
  const [sortActiveEnemiesTop, setSortActiveEnemiesTop] = React.useState(() => initialSortActiveEnemiesTop());
  const [travelAlertsEnabled, setTravelAlertsEnabled] = React.useState(() => initialTravelAlertsEnabled());
  const [alertFlash, setAlertFlash] = React.useState<{ id: number; priority: AlertPriority } | null>(null);
  const [cachedEnemyStats, setCachedEnemyStats] = React.useState<Map<number, EnemyFactionMember>>(new Map());
  const [clockSync, setClockSync] = React.useState<ClockSyncState | null>(null);
  const [lastMessageReceivedAtMs, setLastMessageReceivedAtMs] = React.useState<number | null>(null);
  const hasSeenInitialAlertsRef = React.useRef(false);
  const seenAlertKeysRef = React.useRef<Set<string>>(new Set());
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
    setAlertFlash(null);
    hasSeenInitialAlertsRef.current = false;
    seenAlertKeysRef.current = new Set();
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
          setEvents((current) =>
            activeMonitorEvents(current, message.members, Math.floor(receivedAtMs / 1000), true),
          );
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

  React.useEffect(() => {
    if (!monitorTarget) return;

    const primeOnce = () => {
      primeMonitorAlertAudio();
      window.removeEventListener("pointerdown", primeOnce);
      window.removeEventListener("keydown", primeOnce);
    };

    window.addEventListener("pointerdown", primeOnce);
    window.addEventListener("keydown", primeOnce);

    return () => {
      window.removeEventListener("pointerdown", primeOnce);
      window.removeEventListener("keydown", primeOnce);
    };
  }, [monitorTarget]);

  const activeEvents = activeMonitorEvents(events, members, Math.floor(nowMs / 1000), travelAlertsEnabled);
  const visibleEvents = sortLiveMonitorEvents(bestLiveMonitorEventsByMember(activeEvents));
  const timerReductionSummaries = timerReductionSummariesByMember(activeEvents);

  React.useEffect(() => {
    const visibleKeys = visibleEvents.map(eventKey);

    if (!hasSeenInitialAlertsRef.current) {
      hasSeenInitialAlertsRef.current = true;
      seenAlertKeysRef.current = new Set(visibleKeys);
      return;
    }

    const newEvents = visibleEvents.filter((event) => !seenAlertKeysRef.current.has(eventKey(event)));
    if (newEvents.length > 0) {
      if (!alertsMuted && shouldNotifyForChannel(newEvents, alertPreferences, "sound")) {
        playMonitorAlertChime(alertVolume);
      }
      const flashPriority = highestPriorityForChannel(newEvents, alertPreferences, "flash");
      if (flashPriority !== null) {
        setAlertFlash((current) => ({ id: (current?.id ?? 0) + 1, priority: flashPriority }));
      }
    }

    seenAlertKeysRef.current = new Set([...seenAlertKeysRef.current, ...visibleKeys]);
  }, [alertPreferences, alertVolume, alertsMuted, visibleEvents]);

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
  const alertPriorityByMemberId = memberAlertPriorities(visibleEvents);
  const displayedMembers = hideAbroadHospitals
    ? members.filter((member) => !isAbroadHospitalized(member))
    : members;
  const sortedMembers = [...displayedMembers].sort((left, right) =>
    compareMonitorMembers(left, right, nowMs, cachedEnemyStats, sortActiveEnemiesTop),
  );
  const forcedTopMembers = sortActiveEnemiesTop
    ? sortedMembers.filter((member) => memberAlertSortRank(member, nowMs) === 0)
    : [];
  const standardMembers = sortActiveEnemiesTop
    ? sortedMembers.filter((member) => memberAlertSortRank(member, nowMs) !== 0)
    : sortedMembers;
  const shouldShowMemberSeparator = forcedTopMembers.length > 0 && standardMembers.length > 0;
  const tornTiming = monitorTiming(status, nowMs, clockSync, lastMessageReceivedAtMs);

  return (
    <>
      {alertFlash ? (
        <div key={alertFlash.id} className={`enemy-monitor-alert-flash priority-${alertFlash.priority}`} />
      ) : null}
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
        <AlertKeyCard />
        <MonitorSettingsCard
          volume={alertVolume}
          muted={alertsMuted}
          alertPreferences={alertPreferences}
          hideAbroadHospitals={hideAbroadHospitals}
          sortActiveEnemiesTop={sortActiveEnemiesTop}
          travelAlertsEnabled={travelAlertsEnabled}
          onVolumeChange={setAlertVolume}
          onMutedChange={setAlertsMuted}
          onAlertPreferencesChange={setAlertPreferences}
          onHideAbroadHospitalsChange={setHideAbroadHospitals}
          onSortActiveEnemiesTopChange={setSortActiveEnemiesTop}
          onTravelAlertsEnabledChange={setTravelAlertsEnabled}
        />
      </section>

      <section className="content-grid enemy-monitor-grid">
        <section className="panel enemy-monitor-events-panel">
          <PanelHeader title="Live alerts" aside={`${visibleEvents.length}`} icon={<Activity size={18} />} />
          {visibleEvents.length === 0 ? (
            <EmptyState text="No active live alerts" />
          ) : (
            <div className="enemy-monitor-event-list">
              {visibleEvents.map((event) => (
                <MonitorEventRow
                  key={eventKey(event)}
                  event={event}
                  nowMs={nowMs}
                  timerReductionSummary={timerReductionSummaries.get(event.memberId) ?? null}
                />
              ))}
            </div>
          )}
        </section>

        <section className="panel enemy-monitor-members-panel">
          <PanelHeader
            title="Enemy status"
            aside={displayedMembers.length === members.length ? `${members.length}` : `${displayedMembers.length}/${members.length}`}
          />
          {sortedMembers.length === 0 ? (
            <EmptyState text={members.length === 0 ? "Waiting for baseline poll" : "All observed enemies are hidden by settings"} />
          ) : (
            <div className="enemy-monitor-member-list">
              {forcedTopMembers.length > 0 ? (
                <div className="enemy-monitor-member-separator">
                  <span>Online or recently active</span>
                </div>
              ) : null}
              {forcedTopMembers.map((member) => (
                <React.Fragment key={member.id}>
                  <MemberStatusRow
                    member={member}
                    cachedStats={cachedEnemyStats.get(member.id) ?? null}
                    nowMs={nowMs}
                    alertPriority={alertPriorityByMemberId.get(member.id) ?? null}
                  />
                </React.Fragment>
              ))}
              {shouldShowMemberSeparator ? (
                <div className="enemy-monitor-member-separator">
                  <span>Other enemies</span>
                </div>
              ) : null}
              {standardMembers.map((member) => (
                <MemberStatusRow
                  key={member.id}
                  member={member}
                  cachedStats={cachedEnemyStats.get(member.id) ?? null}
                  nowMs={nowMs}
                  alertPriority={alertPriorityByMemberId.get(member.id) ?? null}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function AlertKeyCard() {
  return (
    <article className="metric-card enemy-monitor-alert-key-card">
      <div className="panel-kicker">
        <Activity size={17} />
        <span>Alert key</span>
      </div>
      <div className="enemy-monitor-alert-key">
        <span title="Priority 1: early hospital exit while online or recently active">
          <i className="priority-1" />
          Early
        </span>
        <span title="Priority 2: expected active exit, early inactive exit, or active travel return">
          <i className="priority-2" />
          Watch
        </span>
        <span title="Priority 3: hospital timer moved earlier">
          <i className="priority-3" />
          Timer
        </span>
        <span title="Priority 4: expected exit or travel return while offline">
          <i className="priority-4" />
          Offline
        </span>
      </div>
    </article>
  );
}

function MonitorSettingsCard({
  volume,
  muted,
  alertPreferences,
  hideAbroadHospitals,
  sortActiveEnemiesTop,
  travelAlertsEnabled,
  onVolumeChange,
  onMutedChange,
  onAlertPreferencesChange,
  onHideAbroadHospitalsChange,
  onSortActiveEnemiesTopChange,
  onTravelAlertsEnabledChange,
}: {
  volume: number;
  muted: boolean;
  alertPreferences: AlertPreferences;
  hideAbroadHospitals: boolean;
  sortActiveEnemiesTop: boolean;
  travelAlertsEnabled: boolean;
  onVolumeChange: (value: number) => void;
  onMutedChange: (value: boolean) => void;
  onAlertPreferencesChange: (value: AlertPreferences) => void;
  onHideAbroadHospitalsChange: (value: boolean) => void;
  onSortActiveEnemiesTopChange: (value: boolean) => void;
  onTravelAlertsEnabledChange: (value: boolean) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  function updateVolume(nextValue: number) {
    primeMonitorAlertAudio();
    onVolumeChange(nextValue);
    window.localStorage.setItem(ALERT_VOLUME_STORAGE_KEY, String(nextValue));
  }

  function testChime() {
    playMonitorAlertChime(volume);
  }

  function toggleMuted() {
    primeMonitorAlertAudio();
    toggleStoredBoolean(muted, onMutedChange, ALERT_MUTED_STORAGE_KEY);
  }

  function toggleAlertPreference(priority: AlertPriority, channel: AlertChannel) {
    primeMonitorAlertAudio();
    const nextPreferences = {
      ...alertPreferences,
      [priority]: {
        ...alertPreferences[priority],
        [channel]: !alertPreferences[priority][channel],
      },
    };
    onAlertPreferencesChange(nextPreferences);
    window.localStorage.setItem(ALERT_PREFERENCES_STORAGE_KEY, JSON.stringify(nextPreferences));
  }

  function toggleHideAbroadHospitals() {
    toggleStoredBoolean(hideAbroadHospitals, onHideAbroadHospitalsChange, HIDE_ABROAD_HOSPITALS_STORAGE_KEY);
  }

  function toggleSortActiveEnemiesTop() {
    toggleStoredBoolean(sortActiveEnemiesTop, onSortActiveEnemiesTopChange, SORT_ACTIVE_ENEMIES_TOP_STORAGE_KEY);
  }

  function toggleTravelAlertsEnabled() {
    toggleStoredBoolean(travelAlertsEnabled, onTravelAlertsEnabledChange, TRAVEL_ALERTS_ENABLED_STORAGE_KEY);
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
          onClick={() => {
            primeMonitorAlertAudio();
            setIsOpen((current) => !current);
          }}
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
              onChange={(event) => updateVolume(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="enemy-monitor-test-chime-button"
            disabled={muted || volume <= 0}
            onClick={testChime}
          >
            <Volume2 size={15} />
            Test chime
          </button>
          <div className="enemy-monitor-alert-rules" aria-label="Alert notification rules">
            <div className="enemy-monitor-alert-rules-header">
              <span>Notify by</span>
              {ALERT_PRIORITIES.map((priority) => (
                <span key={priority} title={priorityTitle(priority)}>
                  P{priority}
                </span>
              ))}
            </div>
            <AlertPreferenceRow
              label="Chime"
              channel="sound"
              preferences={alertPreferences}
              onToggle={toggleAlertPreference}
            />
            <AlertPreferenceRow
              label="Flash"
              channel="flash"
              preferences={alertPreferences}
              onToggle={toggleAlertPreference}
            />
          </div>
          <label className="enemy-monitor-settings-option disabled">
            <input type="checkbox" disabled />
            Browser notifications
          </label>
          <label className="enemy-monitor-settings-option">
            <input
              type="checkbox"
              checked={hideAbroadHospitals}
              onChange={toggleHideAbroadHospitals}
            />
            Hide enemies hospitalized abroad
          </label>
          <label className="enemy-monitor-settings-option">
            <input
              type="checkbox"
              checked={sortActiveEnemiesTop}
              onChange={toggleSortActiveEnemiesTop}
            />
            Move online or recently active enemies to top
          </label>
          <label className="enemy-monitor-settings-option">
            <input
              type="checkbox"
              checked={travelAlertsEnabled}
              onChange={toggleTravelAlertsEnabled}
            />
            Travel return alerts
          </label>
        </div>
      ) : null}
    </article>
  );
}

function AlertPreferenceRow({
  label,
  channel,
  preferences,
  onToggle,
}: {
  label: string;
  channel: AlertChannel;
  preferences: AlertPreferences;
  onToggle: (priority: AlertPriority, channel: AlertChannel) => void;
}) {
  return (
    <div className="enemy-monitor-alert-rules-row">
      <span>{label}</span>
      {ALERT_PRIORITIES.map((priority) => (
        <label key={priority} title={`${label} for ${priorityTitle(priority)}`}>
          <input
            type="checkbox"
            checked={preferences[priority][channel]}
            onChange={() => onToggle(priority, channel)}
            aria-label={`${label} for ${priorityTitle(priority)}`}
          />
        </label>
      ))}
    </div>
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

function MonitorEventRow({
  event,
  nowMs,
  timerReductionSummary,
}: {
  event: MonitorEvent;
  nowMs: number;
  timerReductionSummary: TimerReductionSummary | null;
}) {
  const timerCooldownLabel = timerAlertCooldownLabel(event, nowMs);
  const timerSummaryLabel = timerReductionSummaryLabel(event, timerReductionSummary);

  return (
    <a
      className={`enemy-monitor-event priority-${event.priority}`}
      href={attackUrl(event.memberId)}
      target="_blank"
      rel="noreferrer"
    >
      <div>
        <strong>{event.name}</strong>
        <span>{eventTitle(event)}</span>
      </div>
      <p>{eventDetail(event)}</p>
      {timerSummaryLabel ? <p className="enemy-monitor-event-timer-summary">{timerSummaryLabel}</p> : null}
      <small>{formatLongDateTime(event.observedAt)}</small>
      {timerCooldownLabel ? <small className="enemy-monitor-event-cooldown">{timerCooldownLabel}</small> : null}
    </a>
  );
}

function MemberStatusRow({
  member,
  cachedStats,
  nowMs,
  alertPriority,
}: {
  member: MemberMonitorSnapshot;
  cachedStats: EnemyFactionMember | null;
  nowMs: number;
  alertPriority: MonitorEvent["priority"] | null;
}) {
  const tornReturn = travelReturnToTorn(member, cachedStats, nowMs);
  const abroadHospital = hospitalAbroadInfo(member);
  return (
    <a
      className={memberTileClass(member, nowMs, alertPriority)}
      href={attackUrl(member.id)}
      target="_blank"
      rel="noreferrer"
    >
      <div>
        <strong>{member.name}</strong>
      </div>
      <span className={memberStateClass(member, tornReturn, abroadHospital)}>
        <span>{memberStatusLabel(member, nowMs)}</span>
        {abroadHospital ? (
          <small className="enemy-monitor-abroad-hospital" title={abroadHospital.title}>
            {abroadHospital.label}
          </small>
        ) : null}
        {tornReturn ? (
          <small title={tornReturn.title}>
            Torn in {tornReturn.countdown}
          </small>
        ) : null}
      </span>
      <span className="enemy-monitor-bsp-stat" title={bspBattlestatsTitle(cachedStats)}>
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

function compareMonitorMembers(
  left: MemberMonitorSnapshot,
  right: MemberMonitorSnapshot,
  nowMs: number,
  cachedStats: Map<number, EnemyFactionMember>,
  sortActiveEnemiesTop: boolean,
): number {
  if (sortActiveEnemiesTop) {
    const leftAlertRank = memberAlertSortRank(left, nowMs);
    const rightAlertRank = memberAlertSortRank(right, nowMs);
    if (leftAlertRank !== rightAlertRank) return leftAlertRank - rightAlertRank;
  }

  const leftCachedStats = cachedStats.get(left.id) ?? null;
  const rightCachedStats = cachedStats.get(right.id) ?? null;
  const leftRank = memberStatusSortRank(left, leftCachedStats);
  const rightRank = memberStatusSortRank(right, rightCachedStats);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftUntil = memberSortTimestamp(left, leftCachedStats);
  const rightUntil = memberSortTimestamp(right, rightCachedStats);
  if (leftUntil !== rightUntil) return leftUntil - rightUntil;

  return left.name.localeCompare(right.name);
}

function memberAlertSortRank(member: MemberMonitorSnapshot, nowMs: number): number {
  if (member.state === "Hospital" && isUrgentLastAction(member, nowMs)) {
    return 0;
  }
  return 1;
}

function activeMonitorEvents(
  events: MonitorEvent[],
  members: MemberMonitorSnapshot[],
  nowSecondsValue: number,
  travelAlertsEnabled: boolean,
): MonitorEvent[] {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const activeEvents = events.filter((event) => {
    if (!travelAlertsEnabled && isTravelReturnEvent(event)) {
      return false;
    }
    if (members.length === 0) {
      return event.type === "hospital_timer_decreased"
        ? timerAlertCooldownRemainingSeconds(event, nowSecondsValue) > 0
        : true;
    }
    const member = membersById.get(event.memberId);
    if (!member) {
      return false;
    }
    if (isTravelState(member.state)) {
      return false;
    }
    if (event.type === "hospital_timer_decreased") {
      return timerAlertCooldownRemainingSeconds(event, nowSecondsValue) > 0;
    }
    if (isTravelReturnEvent(event)) {
      return member.state === "Okay";
    }
    return member.state !== "Hospital";
  });
  return activeEvents.length === events.length ? events : activeEvents;
}

function isTravelReturnEvent(event: MonitorEvent): boolean {
  return event.type === "travel_return_expected_online" || event.type === "travel_return_expected_offline";
}

function isTravelState(state: string | null): boolean {
  return state === "Traveling" || state === "Abroad";
}

function sortLiveMonitorEvents(events: MonitorEvent[]): MonitorEvent[] {
  return [...events].sort((left, right) => {
    return compareLiveMonitorEvents(left, right);
  });
}

function bestLiveMonitorEventsByMember(events: MonitorEvent[]): MonitorEvent[] {
  const bestEvents = new Map<number, MonitorEvent>();
  for (const event of events) {
    const current = bestEvents.get(event.memberId);
    if (!current || compareLiveMonitorEvents(event, current) < 0) {
      bestEvents.set(event.memberId, event);
    }
  }
  return [...bestEvents.values()];
}

function timerReductionSummariesByMember(events: MonitorEvent[]): Map<number, TimerReductionSummary> {
  const summaries = new Map<number, TimerReductionSummary>();
  for (const event of events) {
    if (event.type !== "hospital_timer_decreased") continue;

    const decreaseSeconds = event.decreaseSeconds ?? 0;
    const current = summaries.get(event.memberId);
    if (!current) {
      summaries.set(event.memberId, {
        count: 1,
        totalDecreaseSeconds: decreaseSeconds,
        latestDecreaseSeconds: decreaseSeconds,
        firstObservedAt: event.observedAt,
        latestObservedAt: event.observedAt,
      });
      continue;
    }

    current.count += 1;
    current.totalDecreaseSeconds += decreaseSeconds;
    current.firstObservedAt = Math.min(current.firstObservedAt, event.observedAt);
    if (event.observedAt >= current.latestObservedAt) {
      current.latestObservedAt = event.observedAt;
      current.latestDecreaseSeconds = decreaseSeconds;
    }
  }
  return summaries;
}

function compareLiveMonitorEvents(left: MonitorEvent, right: MonitorEvent): number {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  return right.observedAt - left.observedAt;
}

function memberAlertPriorities(events: MonitorEvent[]): Map<number, MonitorEvent["priority"]> {
  const priorities = new Map<number, MonitorEvent["priority"]>();
  for (const event of events) {
    const current = priorities.get(event.memberId);
    if (!current || event.priority < current) {
      priorities.set(event.memberId, event.priority);
    }
  }
  return priorities;
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

function memberStatusSortRank(
  member: MemberMonitorSnapshot,
  cachedMember: EnemyFactionMember | null,
): number {
  if (member.state === "Okay") return 0;
  if (member.state === "Hospital") return 1;
  if (exactTravelReturnToTornAt(member, cachedMember)) return 1;
  return 2;
}

function memberSortTimestamp(
  member: MemberMonitorSnapshot,
  cachedMember: EnemyFactionMember | null,
): number {
  return member.until ?? exactTravelReturnToTornAt(member, cachedMember) ?? Number.MAX_SAFE_INTEGER;
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

function travelReturnToTorn(
  liveMember: MemberMonitorSnapshot,
  cachedMember: EnemyFactionMember | null,
  nowMs: number,
): { countdown: string; title: string } | null {
  const arrivalAt = exactTravelReturnToTornAt(liveMember, cachedMember);
  if (!arrivalAt) {
    return null;
  }

  return {
    countdown: travelReturnCountdownLabel(arrivalAt, nowMs),
    title: `Expected return to Torn at ${formatTime(arrivalAt)}. Uses the travel tracker's exact arrival estimate.`,
  };
}

function exactTravelReturnToTornAt(
  liveMember: MemberMonitorSnapshot,
  cachedMember: EnemyFactionMember | null,
): number | null {
  if (
    liveMember.state !== "Traveling" ||
    !cachedMember ||
    cachedMember.status_state !== "Traveling" ||
    !isTornDestination(cachedMember.travel_destination)
  ) {
    return null;
  }

  return exactTravelArrivalAt(cachedMember);
}

function exactTravelArrivalAt(member: EnemyFactionMember): number | null {
  const earliest = member.estimated_arrival_earliest ?? null;
  const latest = member.estimated_arrival_latest ?? null;
  if (earliest && latest && earliest === latest) {
    return earliest;
  }

  return member.estimated_arrival_at ?? null;
}

function isTornDestination(destination: string | null | undefined): boolean {
  return typeof destination === "string" && destination.trim().toLowerCase() === "torn";
}

function travelReturnCountdownLabel(arrivalAt: number, nowMs: number): string {
  const remainingSeconds = Math.ceil((arrivalAt * 1000 - nowMs) / 1000);
  if (remainingSeconds <= 0) return "due";

  if (remainingSeconds < 10 * 60) {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.ceil((remainingSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function memberTileClass(
  member: MemberMonitorSnapshot,
  nowMs: number,
  alertPriority: MonitorEvent["priority"] | null,
): string {
  const classes = ["enemy-monitor-member"];
  if (isUrgentLastAction(member, nowMs)) {
    classes.push("recently-active");
  }
  if (alertPriority === 3) {
    classes.push("priority-3");
  }
  return classes.join(" ");
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
  return storedBooleanSetting(ALERT_MUTED_STORAGE_KEY, false);
}

function initialHideAbroadHospitals(): boolean {
  return storedBooleanSetting(HIDE_ABROAD_HOSPITALS_STORAGE_KEY, false);
}

function initialSortActiveEnemiesTop(): boolean {
  return storedBooleanSetting(SORT_ACTIVE_ENEMIES_TOP_STORAGE_KEY, true);
}

function initialTravelAlertsEnabled(): boolean {
  return storedBooleanSetting(TRAVEL_ALERTS_ENABLED_STORAGE_KEY, true);
}

function toggleStoredBoolean(
  currentValue: boolean,
  onChange: (value: boolean) => void,
  storageKey: string,
): void {
  const nextValue = !currentValue;
  onChange(nextValue);
  window.localStorage.setItem(storageKey, nextValue ? "1" : "0");
}

function storedBooleanSetting(storageKey: string, defaultValue: boolean): boolean {
  const stored = window.localStorage.getItem(storageKey);
  if (stored === null) {
    return defaultValue;
  }
  return stored === "1";
}

function initialAlertPreferences(): AlertPreferences {
  const stored = window.localStorage.getItem(ALERT_PREFERENCES_STORAGE_KEY);
  if (!stored) return DEFAULT_ALERT_PREFERENCES;

  try {
    return normalizeAlertPreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_ALERT_PREFERENCES;
  }
}

function normalizeAlertPreferences(value: unknown): AlertPreferences {
  if (!value || typeof value !== "object") return DEFAULT_ALERT_PREFERENCES;
  const source = value as Partial<Record<AlertPriority, Partial<Record<AlertChannel, unknown>>>>;

  return ALERT_PRIORITIES.reduce((preferences, priority) => {
    preferences[priority] = {
      sound:
        typeof source[priority]?.sound === "boolean"
          ? source[priority].sound
          : DEFAULT_ALERT_PREFERENCES[priority].sound,
      flash:
        typeof source[priority]?.flash === "boolean"
          ? source[priority].flash
          : DEFAULT_ALERT_PREFERENCES[priority].flash,
    };
    return preferences;
  }, {} as AlertPreferences);
}

function shouldNotifyForChannel(
  events: MonitorEvent[],
  preferences: AlertPreferences,
  channel: AlertChannel,
): boolean {
  return events.some((event) => preferences[event.priority][channel]);
}

function highestPriorityForChannel(
  events: MonitorEvent[],
  preferences: AlertPreferences,
  channel: AlertChannel,
): AlertPriority | null {
  const priorities = events
    .filter((event) => preferences[event.priority][channel])
    .map((event) => event.priority);
  if (priorities.length === 0) return null;
  return Math.min(...priorities) as AlertPriority;
}

function priorityTitle(priority: AlertPriority): string {
  switch (priority) {
    case 1:
      return "Priority 1: early hospital exit";
    case 2:
      return "Priority 2: expected active exit, early inactive exit, or active travel return";
    case 3:
      return "Priority 3: hospital timer moved earlier";
    case 4:
      return "Priority 4: expected exit or travel return while offline";
  }
}

function playMonitorAlertChime(volume: number): void {
  if (volume <= 0) return;

  const audioContext = getMonitorAlertAudioContext();
  if (!audioContext) return;

  if (audioContext.state === "suspended") {
    void audioContext.resume().then(() => {
      startMonitorAlertChime(audioContext, volume);
    });
    return;
  }

  startMonitorAlertChime(audioContext, volume);
}

function startMonitorAlertChime(audioContext: AudioContext, volume: number): void {
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const peakVolume = Math.max(0.001, Math.min(0.18, (volume / 100) * 0.18));

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(1175, now + 0.08);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakVolume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  } catch {
    // Browsers may still block audio if the page has not received a usable gesture.
  }
}

function primeMonitorAlertAudio(): void {
  const audioContext = getMonitorAlertAudioContext();
  if (!audioContext || audioContext.state !== "suspended") return;
  void audioContext.resume();
}

function getMonitorAlertAudioContext(): AudioContext | null {
  if (monitorAlertAudioContext && monitorAlertAudioContext.state !== "closed") {
    return monitorAlertAudioContext;
  }

  const AudioContextConstructor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  try {
    monitorAlertAudioContext = new AudioContextConstructor();
    return monitorAlertAudioContext;
  } catch {
    return null;
  }
}

function useNowMs(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function eventTitle(event: MonitorEvent): string {
  switch (event.type) {
    case "hospital_exit_early":
      return event.priority === 2 ? "Early exit, inactive" : "Early hospital exit";
    case "hospital_exit_expected_online":
      return "Expected exit, active";
    case "hospital_timer_decreased":
      return "Timer moved earlier";
    case "hospital_exit_expected_offline":
      return "Expected exit, offline";
    case "travel_return_expected_online":
      return "Travel return, active";
    case "travel_return_expected_offline":
      return "Travel return, offline";
  }
}

function eventDetail(event: MonitorEvent): string {
  if (event.type === "hospital_exit_early") {
    const timing = `${event.secondsEarly ?? 0}s before expected release`;
    const activity = eventActivityLabel(event);
    return activity ? `${timing} | ${activity}` : timing;
  }
  if (event.type === "hospital_timer_decreased") {
    return `Timer decreased by ${event.decreaseSeconds ?? 0}s`;
  }
  if (isTravelReturnEvent(event)) {
    const activity = eventActivityLabel(event);
    return activity ? `Returned from travel | ${activity}` : "Returned from travel";
  }
  return eventActivityLabel(event) ?? event.currentDescription ?? "Released from hospital";
}

function eventActivityLabel(event: MonitorEvent): string | null {
  if (event.lastActionRelative) {
    return `${event.lastActionStatus ?? "Last action"} ${event.lastActionRelative}`;
  }
  return event.lastActionStatus ?? null;
}

function timerReductionSummaryLabel(
  event: MonitorEvent,
  summary: TimerReductionSummary | null,
): string | null {
  if (!summary || summary.count < 2) return null;

  const spanSeconds = Math.max(0, summary.latestObservedAt - summary.firstObservedAt);
  const prefix = event.type === "hospital_timer_decreased" ? "" : "Also: ";
  return `${prefix}${summary.count} timer reductions in ${formatShortDuration(spanSeconds)} · total ${formatShortDuration(summary.totalDecreaseSeconds)} earlier · latest ${formatShortDuration(summary.latestDecreaseSeconds)}`;
}

function timerAlertCooldownLabel(event: MonitorEvent, nowMs: number): string | null {
  if (event.type !== "hospital_timer_decreased") {
    return null;
  }

  const remainingSeconds = timerAlertCooldownRemainingSeconds(event, Math.floor(nowMs / 1000));
  return `Cooldown ${formatShortDuration(remainingSeconds)}`;
}

function timerAlertCooldownRemainingSeconds(event: MonitorEvent, nowSecondsValue: number): number {
  return Math.max(0, event.observedAt + TIMER_ALERT_COOLDOWN_SECONDS - nowSecondsValue);
}

function formatShortDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }
  return `${remainder}s`;
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

function memberStateClass(
  member: MemberMonitorSnapshot,
  tornReturn: ReturnType<typeof travelReturnToTorn>,
  abroadHospital: ReturnType<typeof hospitalAbroadInfo>,
): string {
  const classes = ["enemy-monitor-state", stateClass(member.state)];
  if (tornReturn) {
    classes.push("has-return-countdown");
  }
  if (abroadHospital) {
    classes.push("has-status-detail", "has-abroad-hospital");
  }
  return classes.join(" ");
}

function hospitalAbroadInfo(member: MemberMonitorSnapshot): { label: string; title: string } | null {
  if (member.state !== "Hospital") {
    return null;
  }

  const location = hospitalAbroadLocation(member.description) ?? hospitalAbroadLocation(member.details);
  if (!location) {
    return null;
  }

  return {
    label: `Abroad: ${location}`,
    title: `Torn reports this enemy as hospitalized abroad: ${member.description ?? member.details ?? location}`,
  };
}

function isAbroadHospitalized(member: MemberMonitorSnapshot): boolean {
  return hospitalAbroadInfo(member) !== null;
}

function hospitalAbroadLocation(description: string | null): string | null {
  const location = description?.match(/^In an? (.+?) hospital(?:\s+for\b|$)/i)?.[1]?.trim();
  return location ? `${location} hospital` : null;
}

function hospitalTimeRemainingLabel(until: number, nowMs: number): string {
  const remainingSeconds = Math.ceil((until * 1000 - nowMs) / 1000);
  if (remainingSeconds <= 0) return "Due now";

  if (remainingSeconds < 10 * 60) {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return minutes > 0 ? `${minutes} mins ${seconds}s` : `${seconds}s`;
  }

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.ceil((remainingSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours} hrs ${minutes} mins`;
  if (hours > 0) return `${hours} hrs`;
  return `${Math.max(1, minutes)} mins`;
}

function cleanHospitalDescription(description: string | null): string {
  const cleaned = description
    ?.replace(/^In hospital for\s*/i, "")
    .replace(/^In an? (.+?) hospital for\s*/i, "$1 hospital ")
    .trim();
  return cleaned || "Hospital";
}

function stateClass(state: string | null): string {
  if (state === "Hospital") return "hospital";
  if (state === "Okay") return "okay";
  if (isTravelState(state)) return "travel";
  return "other";
}

function isLocalhost(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}
