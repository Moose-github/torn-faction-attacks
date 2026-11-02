import { bumpWarCacheVersionById } from "./cacheVersions";
import { ensureEventCompetitionStarted } from "./eventCompetition";
import { finishEventTracking } from "./warLifecycle";
import { applyIncrementalEventSummaries } from "./warStats";
import { EVENT_ATTACK_MATCH_SQL } from "./sql";
import type { Env } from "./types";
import { d1Changes, nowSeconds } from "./utils";

// Links change when attacks are inserted or completed; event edits are handled by
// the wars triggers. Rechecking recent attacks tolerates late inserts and skipped runs.
const EVENT_LINK_AUDIT_SECONDS = 6 * 60 * 60;
// Triggers handle window edits and imports immediately. Full audits are a safety
// net for older corruption, so revisit each event at most once a day.
const EVENT_LINK_FULL_AUDIT_SECONDS = 24 * 60 * 60;
const EVENT_LINK_AUDIT_STATE_PREFIX = "event_link_audit:v1:";
const EVENT_LINK_AUDIT_RECENT_EVENT_SECONDS = 7 * 24 * 60 * 60;
const EVENT_LINK_AUDIT_SAMPLE_LIMIT = 10;
const EXPECTED_EVENT_ID_SQL = `(SELECT w.id FROM wars w WHERE ${EVENT_ATTACK_MATCH_SQL} ORDER BY w.id LIMIT 1)`;

type EventLinkAuditMetrics = { writeStatements: number; changedRows: number; details: Record<string, unknown> };

/** Carries the repairs an audit made, so maintenance health records them with the failure. */
export class EventLinkAuditError extends Error {
  constructor(message: string, readonly metrics: EventLinkAuditMetrics) {
    super(message);
  }
}

type EventLinkScope = { eventId: number | null; from: string; where: string; binds: number[] };
type EventLinkSample = { attackId: number; eventId: number | null; expectedEventId: number | null };

/** Run after deploying the new worker, never while applying the additive schema. */
export async function initializeIndependentEvents(env: Env): Promise<void> {
  const name = "independent_event_tracking:v1";
  if (await env.DB.prepare("SELECT name FROM sync_state WHERE name = ?").bind(name).first()) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE attacks SET war_id = NULL
      WHERE war_id IN (SELECT id FROM wars WHERE war_type = 'event')`),
    env.DB.prepare(`UPDATE sync_state SET active_war_id = NULL, war_state = 'none'
      WHERE name = 'attacks' AND active_war_id IN (SELECT id FROM wars WHERE war_type = 'event')`),
    env.DB.prepare("INSERT INTO sync_state (name, last_started) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
      .bind(name, nowSeconds()),
  ]);
}

/** Events have their own clock and never claim the global active-war slot. */
export async function refreshEventTracking(env: Env, now = nowSeconds()): Promise<void> {
  const events = await env.DB.prepare(`SELECT id, status, practical_finish_time FROM wars
    WHERE war_type = 'event' AND practical_start_time <= ?
      AND (status IN ('scheduled', 'active') OR (status = 'ended'
        AND EXISTS (SELECT 1 FROM war_stats_dirty WHERE war_id = wars.id)))
    ORDER BY practical_start_time, id`).bind(now)
    .all<{ id: number; status: string; practical_finish_time: number | null }>();
  for (const event of events.results ?? []) {
    if (event.status !== "ended" && event.practical_finish_time !== null && event.practical_finish_time <= now) {
      await finishEventTracking(env, { warId: event.id, finishAt: event.practical_finish_time });
      continue;
    }
    if (event.status !== "ended") {
      await env.DB.prepare("UPDATE wars SET status = 'active' WHERE id = ? AND status = 'scheduled'")
        .bind(event.id).run();
      await ensureEventCompetitionStarted(env, event.id, now);
    }
    if (await applyIncrementalEventSummaries(env, event.id)) await bumpWarCacheVersionById(env, event.id);
  }
}

/**
 * Checks event_id against the event windows for recent attacks and for every attack
 * of the audited events, and checks that no attack is owned by an event through
 * war_id, which tracker_attacks would then list twice. Repairs what disagrees, then
 * fails so the repair surfaces in maintenance health with sample attacks.
 */
export async function auditEventAttackLinks(env: Env, now = nowSeconds()): Promise<EventLinkAuditMetrics> {
  const scopes: EventLinkScope[] = [{
    eventId: null,
    from: "attacks AS a INDEXED BY idx_attacks_started",
    where: "a.started >= ?",
    binds: [now - EVENT_LINK_AUDIT_SECONDS],
  }];
  const auditedEvents = await readAuditedEvents(env, now);
  for (const event of auditedEvents) {
    // The window finds missing links; event_id finds stray links outside it.
    scopes.push({
      eventId: event.id,
      from: "attacks AS a",
      where: "(a.started BETWEEN ? AND ? OR a.event_id = ?)",
      binds: [event.start, event.finish ?? now, event.id],
    });
  }

  let writeStatements = 0;
  let changedRows = 0;
  const samples: EventLinkSample[] = [];
  const results = [];
  for (const scope of scopes) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS checked,
        COALESCE(SUM(a.event_id IS NOT ${EXPECTED_EVENT_ID_SQL}), 0) AS mismatched
      FROM ${scope.from} WHERE ${scope.where}`).bind(...scope.binds)
      .first<{ checked: number; mismatched: number }>();
    const checked = Number(row?.checked ?? 0);
    const mismatched = Number(row?.mismatched ?? 0);
    results.push({ eventId: scope.eventId, checked, mismatched });
    if (mismatched === 0) continue;

    const found = await env.DB.prepare(`SELECT a.id AS attackId, a.event_id AS eventId,
        ${EXPECTED_EVENT_ID_SQL} AS expectedEventId
      FROM ${scope.from} WHERE ${scope.where} AND a.event_id IS NOT ${EXPECTED_EVENT_ID_SQL}
      ORDER BY a.id LIMIT ?`).bind(...scope.binds, EVENT_LINK_AUDIT_SAMPLE_LIMIT - samples.length)
      .all<EventLinkSample>();
    samples.push(...(found.results ?? []));
    const repair = await env.DB.prepare(`UPDATE ${scope.from} SET event_id = ${EXPECTED_EVENT_ID_SQL}
      WHERE ${scope.where} AND a.event_id IS NOT ${EXPECTED_EVENT_ID_SQL}`).bind(...scope.binds).run();
    writeStatements += 1;
    changedRows += d1Changes(repair);
  }
  const relinked = changedRows;

  const owned = await env.DB.prepare(`SELECT id FROM attacks
    WHERE war_id IN (SELECT id FROM wars WHERE war_type = 'event') ORDER BY id LIMIT ?`)
    .bind(EVENT_LINK_AUDIT_SAMPLE_LIMIT).all<{ id: number }>();
  const eventOwnedSamples = (owned.results ?? []).map(row => Number(row.id));
  let eventOwned = 0;
  if (eventOwnedSamples.length > 0) {
    // Clearing an event-owned war_id does not trigger its stats queue. Capture
    // every affected event before clearing ownership, in the same transaction,
    // so the normal queue runner repairs duplicate totals and bumps the cache.
    const [queued, repair] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
        SELECT id, -1, -1 FROM wars
        WHERE war_type = 'event' AND EXISTS (SELECT 1 FROM attacks WHERE war_id = wars.id)
        ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING`),
      env.DB.prepare(`UPDATE attacks SET war_id = NULL
        WHERE war_id IN (SELECT id FROM wars WHERE war_type = 'event')`),
    ]);
    writeStatements += 2;
    eventOwned = d1Changes(repair);
    changedRows += d1Changes(queued) + eventOwned;
  }

  const details = { scopes: results, relinked, samples, eventOwned, eventOwnedSamples };
  const problems = [];
  if (relinked > 0) {
    const shown = samples.map(s => `attack ${s.attackId} ${s.eventId ?? "none"}→${s.expectedEventId ?? "none"}`);
    problems.push(`relinked ${relinked} attacks to their event (${shown.join(", ")})`);
  }
  if (eventOwned > 0) {
    problems.push(`cleared war_id on ${eventOwned} attacks owned by an event (${eventOwnedSamples.join(", ")})`);
  }
  if (problems.length > 0) {
    throw new EventLinkAuditError(`Event link audit ${problems.join("; ")}`, { writeStatements, changedRows, details });
  }
  // Only acknowledge clean, completed audits. Repairs and interrupted runs are
  // checked again next time, rather than being deferred for another day.
  if (auditedEvents.length > 0) {
    const checkpoints = await env.DB.batch(auditedEvents.map(event => env.DB.prepare(`
      INSERT INTO sync_state (name, last_started, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET last_started = excluded.last_started, updated_at = CURRENT_TIMESTAMP
      WHERE sync_state.last_started < excluded.last_started`)
      .bind(`${EVENT_LINK_AUDIT_STATE_PREFIX}${event.id}`, now)));
    writeStatements += checkpoints.length;
    changedRows += checkpoints.reduce((total, result) => total + d1Changes(result), 0);
  }
  return { writeStatements, changedRows, details };
}

/** Due recent events plus the least recently checked older event, without clock-slot starvation. */
async function readAuditedEvents(env: Env, now: number) {
  const events = await env.DB.prepare(`SELECT w.id, w.practical_start_time AS start, w.practical_finish_time AS finish
    FROM wars w LEFT JOIN sync_state s ON s.name = ? || w.id
    WHERE w.war_type = 'event' AND w.practical_start_time <= ?
      AND (s.name IS NULL OR s.last_started <= ?)
    ORDER BY COALESCE(s.last_started, 0), w.id`)
    .bind(EVENT_LINK_AUDIT_STATE_PREFIX, now, now - EVENT_LINK_FULL_AUDIT_SECONDS)
    .all<{ id: number; start: number; finish: number | null }>();
  let includedOlder = false;
  return (events.results ?? []).filter(event => {
    if (event.finish === null || event.finish >= now - EVENT_LINK_AUDIT_RECENT_EVENT_SECONDS) return true;
    if (includedOlder) return false;
    includedOlder = true;
    return true;
  });
}
