import { DurableObject } from "cloudflare:workers";
import { parseActiveWarFromUrl } from "./activeWar";
import {
  markMonitorKeyFailure,
  readMonitorKeyCandidates,
  recordMonitorKeyUsage,
  type MonitorKeyCandidate,
} from "./keyPool";
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
const KEY_CACHE_TTL_MS = 60_000;
const USAGE_FLUSH_INTERVAL_MS = 10_000;
const RECENT_ACTION_SECONDS = 5 * 60;
const TIMER_DECREASE_GRACE_SECONDS = 10;
const STORAGE_ACTIVE_WAR_KEY = "activeWar";
const STORAGE_KEEP_ALIVE_UNTIL_KEY = "keepAliveUntil";

type MonitorKeyAlias = MonitorKeyState["alias"];
type PendingUsage = {
  candidate: MonitorKeyCandidate;
  count: number;
};

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
  private keyCache: MonitorKeyCandidate[] = [];
  private keyCacheLoadedAtMs = 0;
  private pendingUsage = new Map<string, PendingUsage>();
  private lastUsageFlushAtMs = 0;

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

    await this.refreshKeyCacheIfNeeded(pollStartedMs);
    const keyCandidate = this.chooseMonitorKey(pollStartedAt);
    if (!keyCandidate) {
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

    const keyState = this.keyStateForAlias(keyCandidate.alias);
    keyState.lastUsedAt = pollStartedAt;

    try {
      const result = await this.fetchMembers(this.activeWar.enemyFactionId, keyCandidate);
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
      const pauseSeconds = this.markKeyError(keyState, err);
      await markMonitorKeyFailure(this.env, keyCandidate, message, this.lastPollFinishedAt, pauseSeconds)
        .catch(() => undefined);
    } finally {
      this.noteKeyUsage(keyCandidate, pollStartedAt);
      await this.flushPendingUsageIfDue(Date.now());
      this.pollInFlight = false;
      this.broadcastStatus();
    }
  }

  private async fetchMembers(
    enemyFactionId: number,
    keyCandidate: MonitorKeyCandidate,
  ): Promise<{ members: TornFactionMember[]; responseTimeMs: number; finishedAtMs: number }> {
    const url = new URL(`https://api.torn.com/v2/faction/${enemyFactionId}/members`);
    url.searchParams.set("striptags", "true");
    url.searchParams.set("timestamp", String(Date.now()));
    url.searchParams.set("comment", "status-monitor");

    const startedAtMs = Date.now();
    const response = await fetch(url, {
      headers: {
        Authorization: `ApiKey ${keyCandidate.key}`,
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

    const orderedEvents = [...events].sort((left, right) => left.priority - right.priority);
    orderedEvents.forEach((event) => this.broadcast({ type: "monitor_event", event }));
    this.broadcast({ type: "snapshot", status: this.status(), members: [...this.snapshots.values()] });
  }

  private chooseMonitorKey(now: number): MonitorKeyCandidate | null {
    return (
      this.keyCache
        .filter((candidate) => {
          const state = this.keyStateForAlias(candidate.alias);
          const pending = this.pendingUsage.get(candidate.id)?.count ?? 0;
          const underLimit = candidate.maxRequestsPerMinute === null ||
            candidate.currentMinuteUsage + pending < candidate.maxRequestsPerMinute;
          return underLimit && (state.backoffUntil === null || state.backoffUntil <= now);
        })
        .sort((left, right) => {
          const leftState = this.keyStateForAlias(left.alias);
          const rightState = this.keyStateForAlias(right.alias);
          return (leftState.lastUsedAt ?? left.lastUsedAt ?? 0) - (rightState.lastUsedAt ?? right.lastUsedAt ?? 0);
        })[0] ?? null
    );
  }

  private nextKeyRetryAt(): number | null {
    return this.keyStates
      .map((key) => key.backoffUntil)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;
  }

  private markKeyError(keyState: MonitorKeyState, err: unknown): number {
    const now = nowSeconds();
    keyState.consecutiveErrors += 1;
    keyState.lastError = err instanceof Error ? err.message : String(err);

    let pauseSeconds: number;
    if (err instanceof TornApiError) {
      if (err.retryAfterSeconds) {
        pauseSeconds = err.retryAfterSeconds;
      } else if (err.code === 5) {
        pauseSeconds = 60;
      } else if (err.code === 2 || err.code === 7 || err.code === 10) {
        pauseSeconds = 15 * 60;
      } else {
        pauseSeconds = Math.min(60, 5 * keyState.consecutiveErrors);
      }
    } else {
      pauseSeconds = Math.min(60, 5 * keyState.consecutiveErrors);
    }

    keyState.backoffUntil = now + pauseSeconds;
    return pauseSeconds;
  }

  private async refreshKeyCacheIfNeeded(nowMs: number, force = false): Promise<void> {
    if (!force && this.keyCache.length > 0 && nowMs - this.keyCacheLoadedAtMs < KEY_CACHE_TTL_MS) {
      return;
    }

    try {
      const candidates = await readMonitorKeyCandidates(this.env, Math.floor(nowMs / 1000));
      this.keyCache = candidates;
      this.keyCacheLoadedAtMs = nowMs;
      this.syncKeyStates(candidates);
    } catch (err) {
      if (this.keyCache.length === 0) {
        this.lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  private syncKeyStates(candidates: MonitorKeyCandidate[]): void {
    const previous = new Map(this.keyStates.map((state) => [state.alias, state]));
    this.keyStates = candidates.map((candidate) => previous.get(candidate.alias) ?? emptyKeyState(candidate.alias));
  }

  private keyStateForAlias(alias: MonitorKeyAlias): MonitorKeyState {
    let state = this.keyStates.find((key) => key.alias === alias);
    if (!state) {
      state = emptyKeyState(alias);
      this.keyStates.push(state);
    }
    return state;
  }

  private noteKeyUsage(candidate: MonitorKeyCandidate, now: number): void {
    candidate.currentMinuteUsage += 1;
    candidate.lastUsedAt = now;
    if (candidate.sourceType !== "submitted") return;

    const existing = this.pendingUsage.get(candidate.id);
    if (existing) {
      existing.count += 1;
    } else {
      this.pendingUsage.set(candidate.id, { candidate, count: 1 });
    }
  }

  private async flushPendingUsageIfDue(nowMs: number, force = false): Promise<void> {
    if (this.pendingUsage.size === 0) return;
    if (!force && nowMs - this.lastUsageFlushAtMs < USAGE_FLUSH_INTERVAL_MS) return;

    const pending = [...this.pendingUsage.values()];
    this.pendingUsage.clear();
    this.lastUsageFlushAtMs = nowMs;

    await Promise.all(pending.map((item) =>
      recordMonitorKeyUsage(this.env, item.candidate, Math.floor(nowMs / 1000), item.count)
        .catch(() => {
          this.pendingUsage.set(item.candidate.id, item);
        }),
    ));
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
  if (previous.until === null) {
    return null;
  }

  const event =
    previous.state === "Hospital"
      ? classifyHospitalEvent(previous, current, observedAt)
      : classifyTravelEvent(previous, current, observedAt);

  if (!event || emittedEvents.has(eventDedupeKey(event))) {
    return null;
  }

  return event;
}

function classifyHospitalEvent(
  previous: MemberMonitorSnapshot,
  current: MemberMonitorSnapshot,
  observedAt: number,
): MonitorEvent | null {
  if (current.state !== "Hospital") {
    const isActive = isRecentlyActive(current, observedAt);
    if (previous.until !== null && previous.until > observedAt) {
      return buildMonitorEvent(
        "hospital_exit_early",
        isActive ? 1 : 2,
        previous,
        current,
        observedAt,
        { secondsEarly: previous.until - observedAt },
      );
    }

    return buildMonitorEvent(
      isActive ? "hospital_exit_expected_online" : "hospital_exit_expected_offline",
      isActive ? 2 : 4,
      previous,
      current,
      observedAt,
    );
  }

  if (
    previous.until !== null &&
    current.until !== null &&
    current.until < previous.until - TIMER_DECREASE_GRACE_SECONDS
  ) {
    return buildMonitorEvent(
      "hospital_timer_decreased",
      3,
      previous,
      current,
      observedAt,
      { decreaseSeconds: previous.until - current.until },
    );
  }

  return null;
}

function classifyTravelEvent(
  previous: MemberMonitorSnapshot,
  current: MemberMonitorSnapshot,
  observedAt: number,
): MonitorEvent | null {
  if (previous.state !== "Traveling" || current.state !== "Okay") {
    return null;
  }

  const isActive = isRecentlyActive(current, observedAt);
  return buildMonitorEvent(
    isActive ? "travel_return_expected_online" : "travel_return_expected_offline",
    isActive ? 2 : 4,
    previous,
    current,
    observedAt,
  );
}

function buildMonitorEvent(
  type: MonitorEvent["type"],
  priority: MonitorEvent["priority"],
  previous: MemberMonitorSnapshot,
  current: MemberMonitorSnapshot,
  observedAt: number,
  extra: Partial<Pick<MonitorEvent, "secondsEarly" | "decreaseSeconds">> = {},
): MonitorEvent {
  return {
    type,
    priority,
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
    ...extra,
  };
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
  if (member.lastActionTimestamp !== null) {
    return member.lastActionTimestamp >= observedAt - RECENT_ACTION_SECONDS;
  }

  return member.lastActionStatus === "Online";
}

function activeWarFromUrl(url: URL): ActiveWarConfig | Response {
  const parsed = parseActiveWarFromUrl(url);
  return parsed.ok ? parsed.activeWar : Response.json({ ok: false, error: parsed.error }, { status: 400 });
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
