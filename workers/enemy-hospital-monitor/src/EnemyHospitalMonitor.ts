import { DurableObject } from "cloudflare:workers";
import type {
  ActiveWarConfig,
  MemberMonitorSnapshot,
  MonitorEnv,
  MonitorEvent,
  MonitorKeyState,
  MonitorStatus,
  TornFactionMember,
  TornFactionMembersResponse,
} from "./types";

const POLL_INTERVAL_MS = 1_000;
const RECENT_ACTION_SECONDS = 5 * 60;
const TIMER_DECREASE_GRACE_SECONDS = 10;
const STORAGE_ACTIVE_WAR_KEY = "activeWar";
const STORAGE_KEEP_ALIVE_UNTIL_KEY = "keepAliveUntil";

type MonitorKeyAlias = MonitorKeyState["alias"];

class TornApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export class EnemyHospitalMonitor extends DurableObject<MonitorEnv> {
  private activeWar: ActiveWarConfig | null = null;
  private keepAliveUntil: number | null = null;
  private snapshots = new Map<number, MemberMonitorSnapshot>();
  private emittedEvents = new Set<string>();
  private hasBaseline = false;
  private pollInFlight = false;
  private lastPollStartedAt: number | null = null;
  private lastPollFinishedAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastSuccessAtMs: number | null = null;
  private lastTornResponseMs: number | null = null;
  private lastError: string | null = null;
  private nextPollAt: number | null = null;
  private keyStates: MonitorKeyState[] = [
    emptyKeyState("monitor-1"),
    emptyKeyState("monitor-2"),
  ];

  constructor(ctx: DurableObjectState, env: MonitorEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.activeWar = (await this.ctx.storage.get<ActiveWarConfig>(STORAGE_ACTIVE_WAR_KEY)) ?? null;
      this.keepAliveUntil = (await this.ctx.storage.get<number>(STORAGE_KEEP_ALIVE_UNTIL_KEY)) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request, url);
    }

    if (url.pathname === "/status") {
      return Response.json({ ok: true, status: this.status() });
    }

    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    if (!this.shouldPoll()) {
      this.nextPollAt = null;
      await this.ctx.storage.deleteAlarm();
      this.broadcastStatus();
      return;
    }

    const alarmStartedMs = Date.now();
    await this.poll();
    await this.scheduleNextPoll(Math.max(0, POLL_INTERVAL_MS - (Date.now() - alarmStartedMs)));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let parsed: { type?: string } | null = null;
    try {
      parsed = JSON.parse(message) as { type?: string };
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "Invalid JSON message" }));
      return;
    }

    if (parsed.type === "ping") {
      ws.send(
        JSON.stringify({
          type: "pong",
          now: nowSeconds(),
          nowMs: Date.now(),
          clientSentAtMs:
            typeof (parsed as { clientSentAtMs?: unknown }).clientSentAtMs === "number"
              ? (parsed as { clientSentAtMs: number }).clientSentAtMs
              : null,
        }),
      );
    }
  }

  async webSocketClose(): Promise<void> {
    await this.stopIfIdle();
  }

  async webSocketError(): Promise<void> {
    await this.stopIfIdle();
  }

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ ok: false, error: "Expected websocket upgrade" }, { status: 426 });
    }

    const activeWar = activeWarFromUrl(url);
    if (activeWar instanceof Response) return activeWar;

    await this.setActiveWar(activeWar);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: nowSeconds(), warId: activeWar.warId });

    this.send(server, { type: "snapshot", status: this.status(), members: [...this.snapshots.values()] });

    await this.startPollingNow();

    return new Response(null, { status: 101, webSocket: client });
  }

  private async setActiveWar(activeWar: ActiveWarConfig): Promise<void> {
    const changed =
      !this.activeWar ||
      this.activeWar.warId !== activeWar.warId ||
      this.activeWar.enemyFactionId !== activeWar.enemyFactionId;

    this.activeWar = activeWar;
    await this.ctx.storage.put(STORAGE_ACTIVE_WAR_KEY, activeWar);

    if (changed) {
      this.snapshots.clear();
      this.emittedEvents.clear();
      this.hasBaseline = false;
      this.lastError = null;
      this.broadcastStatus();
    }
  }

  private async startPollingNow(): Promise<void> {
    if (!this.shouldPoll()) return;
    await this.ctx.storage.setAlarm(Date.now());
    this.nextPollAt = nowSeconds();
    this.broadcastStatus();
  }

  private async stopIfIdle(): Promise<void> {
    if (this.shouldPoll()) return;
    this.nextPollAt = null;
    await this.ctx.storage.deleteAlarm();
    this.broadcastStatus();
  }

  private async scheduleNextPoll(delayMs = POLL_INTERVAL_MS): Promise<void> {
    if (!this.shouldPoll()) {
      this.nextPollAt = null;
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const scheduledAt = Date.now() + delayMs;
    this.nextPollAt = Math.floor(scheduledAt / 1000);
    await this.ctx.storage.setAlarm(scheduledAt);
    this.broadcastStatus();
  }

  private shouldPoll(): boolean {
    if (!this.activeWar) return false;

    const now = nowSeconds();
    const keepAliveActive = this.keepAliveUntil !== null && this.keepAliveUntil > now;
    return this.ctx.getWebSockets().length > 0 || keepAliveActive;
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight || !this.activeWar) return;

    this.pollInFlight = true;
    const pollStartedMs = Date.now();
    const pollStartedAt = Math.floor(pollStartedMs / 1000);
    this.lastPollStartedAt = pollStartedAt;

    const keyState = this.chooseMonitorKey(pollStartedAt);
    if (!keyState) {
      const nextKeyAt = this.nextKeyRetryAt();
      this.lastError = "No healthy monitor API key is currently available";
      this.lastPollFinishedAt = nowSeconds();
      this.pollInFlight = false;
      this.broadcastStatus();
      if (nextKeyAt) {
        await this.scheduleNextPoll(Math.max(1_000, nextKeyAt * 1000 - Date.now()));
      }
      return;
    }

    keyState.lastUsedAt = pollStartedAt;

    try {
      const result = await this.fetchMembers(this.activeWar.enemyFactionId, keyState.alias);
      const observedAtMs = result.finishedAtMs;
      const observedAt = Math.floor(observedAtMs / 1000);
      keyState.lastSuccessAt = observedAt;
      keyState.consecutiveErrors = 0;
      keyState.lastError = null;
      keyState.backoffUntil = null;
      this.lastSuccessAt = observedAt;
      this.lastSuccessAtMs = observedAtMs;
      this.lastTornResponseMs = result.responseTimeMs;
      this.lastError = null;
      this.lastPollFinishedAt = observedAt;
      this.handleMembers(result.members, observedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.lastPollFinishedAt = nowSeconds();
      this.markKeyError(keyState, err);
    } finally {
      this.pollInFlight = false;
      this.broadcastStatus();
    }
  }

  private async fetchMembers(
    enemyFactionId: number,
    keyAlias: MonitorKeyAlias,
  ): Promise<{ members: TornFactionMember[]; responseTimeMs: number; finishedAtMs: number }> {
    const key = keyAlias === "monitor-1" ? this.env.MONITOR_TORN_API_KEY_1 : this.env.MONITOR_TORN_API_KEY_2;
    const url = new URL(`https://api.torn.com/v2/faction/${enemyFactionId}/members`);
    url.searchParams.set("striptags", "true");
    url.searchParams.set("timestamp", String(Date.now()));
    url.searchParams.set("comment", "status-monitor");

    const startedAtMs = Date.now();
    const response = await fetch(url, {
      headers: {
        Authorization: `ApiKey ${key}`,
      },
    });

    let body: TornFactionMembersResponse | null = null;
    try {
      body = (await response.json()) as TornFactionMembersResponse;
    } catch {
      throw new TornApiError(`Torn returned non-JSON response (${response.status})`);
    }

    if (!response.ok) {
      throw new TornApiError(body?.error?.error ?? `Torn request failed (${response.status})`, body?.error?.code ?? null);
    }

    if (body.error) {
      throw new TornApiError(body.error.error ?? "Torn API error", body.error.code ?? null);
    }

    if (!Array.isArray(body.members)) {
      throw new TornApiError("Torn response did not include a members array");
    }

    const finishedAtMs = Date.now();
    return {
      members: body.members,
      responseTimeMs: finishedAtMs - startedAtMs,
      finishedAtMs,
    };
  }

  private handleMembers(members: TornFactionMember[], observedAt: number): void {
    const currentSnapshots = new Map<number, MemberMonitorSnapshot>();
    const events: MonitorEvent[] = [];

    for (const member of members) {
      const current = snapshotFromMember(member, observedAt);
      currentSnapshots.set(current.id, current);

      const previous = this.snapshots.get(current.id);
      if (!previous || !this.hasBaseline) continue;

      const event = classifyEvent(previous, current, observedAt, this.emittedEvents);
      if (event) {
        this.emittedEvents.add(eventDedupeKey(event));
        events.push(event);
      }
    }

    this.snapshots = currentSnapshots;
    this.hasBaseline = true;

    const urgent = events.filter((event) => event.type === "hospital_exit_early");
    const secondary = events.filter((event) => event.type !== "hospital_exit_early");

    urgent.forEach((event) => this.broadcast({ type: "monitor_event", event }));
    secondary.forEach((event) => this.broadcast({ type: "monitor_event", event }));
    this.broadcast({ type: "snapshot", status: this.status(), members: [...this.snapshots.values()] });
  }

  private chooseMonitorKey(now: number): MonitorKeyState | null {
    return (
      this.keyStates
        .filter((key) => key.backoffUntil === null || key.backoffUntil <= now)
        .sort((left, right) => (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0))[0] ?? null
    );
  }

  private nextKeyRetryAt(): number | null {
    return this.keyStates
      .map((key) => key.backoffUntil)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;
  }

  private markKeyError(keyState: MonitorKeyState, err: unknown): void {
    const now = nowSeconds();
    keyState.consecutiveErrors += 1;
    keyState.lastError = err instanceof Error ? err.message : String(err);

    if (err instanceof TornApiError) {
      if (err.retryAfterSeconds) {
        keyState.backoffUntil = now + err.retryAfterSeconds;
      } else if (err.code === 5) {
        keyState.backoffUntil = now + 60;
      } else if (err.code === 2 || err.code === 7 || err.code === 10) {
        keyState.backoffUntil = now + 15 * 60;
      } else {
        keyState.backoffUntil = now + Math.min(60, 5 * keyState.consecutiveErrors);
      }
      return;
    }

    keyState.backoffUntil = now + Math.min(60, 5 * keyState.consecutiveErrors);
  }

  private status(): MonitorStatus {
    return {
      activeWar: this.activeWar,
      connectedClients: this.ctx.getWebSockets().length,
      hasBaseline: this.hasBaseline,
      lastPollStartedAt: this.lastPollStartedAt,
      lastPollFinishedAt: this.lastPollFinishedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastSuccessAtMs: this.lastSuccessAtMs,
      lastTornResponseMs: this.lastTornResponseMs,
      serverNowMs: Date.now(),
      lastError: this.lastError,
      nextPollAt: this.nextPollAt,
      keyStates: this.keyStates,
      keepAliveUntil: this.keepAliveUntil,
    };
  }

  private broadcastStatus(): void {
    this.broadcast({ type: "status", status: this.status() });
  }

  private broadcast(message: unknown): void {
    const encoded = JSON.stringify(message);
    this.ctx.getWebSockets().forEach((ws) => {
      try {
        ws.send(encoded);
      } catch {
        ws.close(1011, "Unable to send monitor message");
      }
    });
  }

  private send(ws: WebSocket, message: unknown): void {
    ws.send(JSON.stringify(message));
  }
}

function classifyEvent(
  previous: MemberMonitorSnapshot,
  current: MemberMonitorSnapshot,
  observedAt: number,
  emittedEvents: Set<string>,
): MonitorEvent | null {
  if (previous.state !== "Hospital" || previous.until === null) {
    return null;
  }

  let event: MonitorEvent | null = null;

  if (current.state !== "Hospital") {
    if (previous.until > observedAt) {
      event = {
        type: "hospital_exit_early",
        priority: 1,
        memberId: current.id,
        name: current.name,
        observedAt,
        previousUntil: previous.until,
        currentUntil: current.until,
        secondsEarly: previous.until - observedAt,
        previousDetails: previous.details,
        currentDescription: current.description,
        lastActionStatus: current.lastActionStatus,
        lastActionTimestamp: current.lastActionTimestamp,
        lastActionRelative: current.lastActionRelative,
      };
    } else if (isRecentlyActive(current, observedAt)) {
      event = {
        type: "hospital_exit_expected_online",
        priority: 2,
        memberId: current.id,
        name: current.name,
        observedAt,
        previousUntil: previous.until,
        currentUntil: current.until,
        previousDetails: previous.details,
        currentDescription: current.description,
        lastActionStatus: current.lastActionStatus,
        lastActionTimestamp: current.lastActionTimestamp,
        lastActionRelative: current.lastActionRelative,
      };
    } else {
      event = {
        type: "hospital_exit_expected_offline",
        priority: 4,
        memberId: current.id,
        name: current.name,
        observedAt,
        previousUntil: previous.until,
        currentUntil: current.until,
        previousDetails: previous.details,
        currentDescription: current.description,
        lastActionStatus: current.lastActionStatus,
        lastActionTimestamp: current.lastActionTimestamp,
        lastActionRelative: current.lastActionRelative,
      };
    }
  } else if (
    current.until !== null &&
    current.until < previous.until - TIMER_DECREASE_GRACE_SECONDS
  ) {
    event = {
      type: "hospital_timer_decreased",
      priority: 3,
      memberId: current.id,
      name: current.name,
      observedAt,
      previousUntil: previous.until,
      currentUntil: current.until,
      decreaseSeconds: previous.until - current.until,
      previousDetails: previous.details,
      currentDescription: current.description,
      lastActionStatus: current.lastActionStatus,
      lastActionTimestamp: current.lastActionTimestamp,
      lastActionRelative: current.lastActionRelative,
    };
  }

  if (!event || emittedEvents.has(eventDedupeKey(event))) {
    return null;
  }

  return event;
}

function eventDedupeKey(event: MonitorEvent): string {
  if (event.type === "hospital_timer_decreased") {
    return `${event.memberId}:${event.type}:${event.currentUntil}`;
  }
  return `${event.memberId}:${event.type}:${event.previousUntil}`;
}

function snapshotFromMember(member: TornFactionMember, observedAt: number): MemberMonitorSnapshot {
  return {
    id: member.id,
    name: member.name,
    level: typeof member.level === "number" ? member.level : null,
    state: member.status?.state ?? null,
    description: member.status?.description ?? null,
    details: member.status?.details ?? null,
    until: typeof member.status?.until === "number" ? member.status.until : null,
    observedAt,
    lastActionStatus: member.last_action?.status ?? null,
    lastActionTimestamp: typeof member.last_action?.timestamp === "number" ? member.last_action.timestamp : null,
    lastActionRelative: member.last_action?.relative ?? null,
    hasEarlyDischarge: member.has_early_discharge ?? false,
  };
}

function isRecentlyActive(member: MemberMonitorSnapshot, observedAt: number): boolean {
  return (
    member.lastActionStatus === "Online" ||
    (member.lastActionTimestamp !== null && member.lastActionTimestamp >= observedAt - RECENT_ACTION_SECONDS)
  );
}

function activeWarFromUrl(url: URL): ActiveWarConfig | Response {
  const warId = Number(url.searchParams.get("warId"));
  const warName = url.searchParams.get("warName")?.trim() ?? "";
  const enemyFactionId = Number(url.searchParams.get("enemyFactionId"));
  const tornWarIdRaw = url.searchParams.get("tornWarId");
  const tornWarId = tornWarIdRaw ? Number(tornWarIdRaw) : null;

  if (!Number.isInteger(warId) || warId <= 0) {
    return Response.json({ ok: false, error: "Invalid warId" }, { status: 400 });
  }
  if (!warName) {
    return Response.json({ ok: false, error: "Invalid warName" }, { status: 400 });
  }
  if (!Number.isInteger(enemyFactionId) || enemyFactionId <= 0) {
    return Response.json({ ok: false, error: "Invalid enemyFactionId" }, { status: 400 });
  }
  if (tornWarIdRaw) {
    if (!Number.isInteger(tornWarId) || tornWarId === null || tornWarId <= 0) {
      return Response.json({ ok: false, error: "Invalid tornWarId" }, { status: 400 });
    }
  }

  return { warId, warName, enemyFactionId, tornWarId: tornWarId ?? null };
}

function emptyKeyState(alias: MonitorKeyAlias): MonitorKeyState {
  return {
    alias,
    lastUsedAt: null,
    lastSuccessAt: null,
    backoffUntil: null,
    consecutiveErrors: 0,
    lastError: null,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
