import React from "react";
import { Activity, AlertTriangle, Clock3, Radio, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { MONITOR_WORKER_URL, WarSummary } from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatRelativeTime, formatTime } from "../utils/format";

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
  | { type: "pong"; now: number };

const MAX_VISIBLE_EVENTS = 40;

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

  const canMonitor = Boolean(
    activeWar &&
      activeWar.status === "active" &&
      activeWar.enemy_faction_id !== null &&
      activeWar.official_end_time === null &&
      activeWar.practical_finish_time === null,
  );

  React.useEffect(() => {
    setEvents([]);
    setMembers([]);
    setStatus(null);
  }, [activeWar?.id]);

  React.useEffect(() => {
    if (!activeWar || !canMonitor) {
      setConnectionState("idle");
      return;
    }

    const socketUrl = monitorSocketUrl(activeWar);
    const socket = new WebSocket(socketUrl);
    setConnectionState("connecting");
    setSocketError(null);

    socket.addEventListener("open", () => {
      setConnectionState("open");
    });

    socket.addEventListener("message", (event) => {
      const message = parseMonitorMessage(event.data);
      if (!message) return;

      if (message.type === "snapshot") {
        setStatus(message.status);
        setMembers(message.members);
      } else if (message.type === "status") {
        setStatus(message.status);
      } else if (message.type === "monitor_event") {
        setEvents((current) => [message.event, ...current].slice(0, MAX_VISIBLE_EVENTS));
      } else if (message.type === "error") {
        setSocketError(message.error);
      }
    });

    socket.addEventListener("close", () => {
      setConnectionState("closed");
    });

    socket.addEventListener("error", () => {
      setConnectionState("error");
      setSocketError("WebSocket connection failed");
    });

    return () => {
      socket.close(1000, "Monitor page closed");
    };
  }, [activeWar, canMonitor]);

  if (!activeWar) {
    return (
      <section className="panel">
        <PanelHeader title="Enemy hospital monitor" />
        <EmptyState text="No active war to monitor" />
      </section>
    );
  }

  if (!canMonitor) {
    return (
      <section className="panel">
        <PanelHeader title="Enemy hospital monitor" />
        <EmptyState text="Enemy hospital monitoring is available during an active war with an enemy faction" />
      </section>
    );
  }

  const hospitalizedMembers = members.filter((member) => member.state === "Hospital").length;
  const earlyAlertCount = events.filter((event) => event.type === "hospital_exit_early").length;
  const latestEvent = events[0] ?? null;
  const sortedMembers = [...members].sort(compareMonitorMembers);

  return (
    <>
      <section className="hero-panel compact-hero-panel enemy-monitor-hero">
        <div>
          <p className="eyebrow">Enemy hospital monitor</p>
          <div className="war-title-row">
            <h2>{activeWar.name}</h2>
            <span>{connectionLabel(connectionState)}</span>
          </div>
          <p>
            Enemy faction: <strong>{activeWar.enemy_faction_id}</strong>
          </p>
        </div>
        <div className="enemy-monitor-live-state">
          {connectionState === "open" ? <Wifi size={18} /> : <WifiOff size={18} />}
          <strong>{status?.lastSuccessAt ? formatRelativeTime(status.lastSuccessAt) : "Waiting"}</strong>
          <span>Last poll</span>
        </div>
      </section>

      <section className="status-grid enemy-monitor-status-grid">
        <MetricCard
          label="Connection"
          value={connectionLabel(connectionState)}
          icon={connectionState === "open" ? <Radio size={17} /> : <WifiOff size={17} />}
          detail={status?.hasBaseline ? "Baseline active" : "Baseline pending"}
        />
        <MetricCard
          label="Hospitalized"
          value={String(hospitalizedMembers)}
          icon={<ShieldAlert size={17} />}
          detail={`${members.length} members observed`}
        />
        <MetricCard
          label="Early exits"
          value={String(earlyAlertCount)}
          icon={<AlertTriangle size={17} />}
          detail={latestEvent ? eventTitle(latestEvent.type) : "No alerts this session"}
        />
        <MetricCard
          label="Next poll"
          value={status?.nextPollAt ? formatTime(status.nextPollAt) : "-"}
          icon={<Clock3 size={17} />}
          detail={status?.lastError ?? socketError ?? "One second cadence"}
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
                <MemberStatusRow key={member.id} member={member} />
              ))}
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function MonitorEventRow({ event }: { event: MonitorEvent }) {
  return (
    <article className={`enemy-monitor-event priority-${event.priority}`}>
      <div>
        <strong>{event.name}</strong>
        <span>{eventTitle(event.type)}</span>
      </div>
      <p>{eventDetail(event)}</p>
      <small>{formatLongDateTime(event.observedAt)}</small>
    </article>
  );
}

function MemberStatusRow({ member }: { member: MemberMonitorSnapshot }) {
  return (
    <article className="enemy-monitor-member">
      <div>
        <strong>{member.name}</strong>
        <small>#{member.id}</small>
      </div>
      <span className={`enemy-monitor-state ${stateClass(member.state)}`}>
        {member.description ?? member.state ?? "Unknown"}
      </span>
      <small>
        {member.until ? `Until ${formatTime(member.until)}` : member.lastActionRelative ?? "No timer"}
      </small>
    </article>
  );
}

function monitorSocketUrl(activeWar: WarSummary): string {
  const url = new URL("/ws", MONITOR_WORKER_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("warId", String(activeWar.id));
  url.searchParams.set("warName", activeWar.name);
  url.searchParams.set("enemyFactionId", String(activeWar.enemy_faction_id));
  if (activeWar.torn_war_id) {
    url.searchParams.set("tornWarId", String(activeWar.torn_war_id));
  }
  return url.toString();
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
  const leftHospital = left.state === "Hospital" ? 0 : 1;
  const rightHospital = right.state === "Hospital" ? 0 : 1;
  if (leftHospital !== rightHospital) return leftHospital - rightHospital;

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

function stateClass(state: string | null): string {
  if (state === "Hospital") return "hospital";
  if (state === "Okay") return "okay";
  if (state === "Traveling" || state === "Abroad") return "travel";
  return "other";
}
