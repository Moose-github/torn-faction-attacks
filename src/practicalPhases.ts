import { practicalDuration, resolvePhase, validatePhaseTimeline, type PracticalPhase, type PracticalPhaseSummary } from "../shared/practicalPhases";
import { readAuthenticatedUserId } from "./auth";
import { bumpGlobalWarCacheVersion, bumpWarCacheVersionById } from "./cacheVersions";
import { HOME_FACTION_ID, SOURCE_NAME } from "./constants";
import { readWarFromUrl } from "./warRequest";
import { rebuildWarStatsFromRaw } from "./warStats";
import { runPracticalPhaseHooks } from "./war/lifecycleHooks";
import type { Env } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";

type PhaseWar = {
  id: number; war_type: string; status: string; practical_revision: number;
  practical_rebuild_pending: number; official_start_time: number | null;
  practical_start_time: number; official_end_time: number | null;
  enemy_faction_id: number | null; official_home_score: number | null;
};

export async function readPracticalPhases(env: Env, warId: number): Promise<PracticalPhase[]> {
  return (await env.DB.prepare("SELECT * FROM war_practical_phases WHERE war_id = ? ORDER BY scheduled_start, id")
    .bind(warId).all<PracticalPhase>()).results ?? [];
}

async function readPhaseWar(env: Env, warId: number): Promise<PhaseWar> {
  const war = await env.DB.prepare("SELECT * FROM wars WHERE id = ?").bind(warId).first<PhaseWar>();
  if (!war) throw new Error("War not found");
  return war;
}

export async function practicalPhaseSummary(env: Env, warId: number): Promise<PracticalPhaseSummary> {
  const [war, all] = await Promise.all([readPhaseWar(env, warId), readPracticalPhases(env, warId)]);
  const phases = all.filter((p) => p.removed_at === null);
  return { practical_revision: war.practical_revision, practical_phases: phases,
    practical_duration_seconds: practicalDuration(phases, Math.min(nowSeconds(), war.official_end_time ?? Infinity)),
    pending_practical_phase: phases.find((p) => p.status === "scheduled") ?? null,
    practical_rebuild_pending: war.practical_rebuild_pending };
}

// All phase edits, their audit, and compatibility fields commit together. Every
// statement is guarded by the same revision; a stale writer changes nothing.
export async function savePhaseTimeline(env: Env, war: PhaseWar, before: PracticalPhase[], after: PracticalPhase[], action: string, actor: number | null): Promise<void> {
  const guard = "EXISTS (SELECT 1 FROM wars WHERE id = ? AND practical_revision = ?)";
  const bindGuard = [war.id, war.practical_revision];
  const changed = after.filter((p) => JSON.stringify(p) !== JSON.stringify(before.find((old) => old.id === p.id)));
  // Retire an active/scheduled slot before inserting its replacement.
  changed.sort((a, b) => Number(a.status === "active" || a.status === "scheduled") - Number(b.status === "active" || b.status === "scheduled"));
  const statements = changed.map((p) => env.DB.prepare(`
    INSERT INTO war_practical_phases (id, war_id, target, scheduled_start, start_time, finish_time, status, reason, removed_at, effects_pending)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
    ON CONFLICT(id) DO UPDATE SET target=excluded.target, scheduled_start=excluded.scheduled_start,
      start_time=excluded.start_time, finish_time=excluded.finish_time, status=excluded.status,
      reason=excluded.reason, removed_at=excluded.removed_at, effects_pending=excluded.effects_pending
  `).bind(p.id, war.id, p.target, p.scheduled_start, p.start_time, p.finish_time, p.status, p.reason, p.removed_at, p.effects_pending, ...bindGuard));
  statements.push(env.DB.prepare(`INSERT INTO war_practical_phase_audit
    (war_id, changed_at, actor_id, action, before_json, after_json)
    SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(war.id, nowSeconds(), actor, action, JSON.stringify(before), JSON.stringify(after), ...bindGuard));
  const windows = after.filter((p) => !p.removed_at && p.start_time !== null && (p.status === "active" || p.status === "completed"))
    .sort((a, b) => a.start_time! - b.start_time!);
  const latest = windows.at(-1);
  const active = windows.some((p) => p.status === "active");
  const first = windows[0]?.start_time ?? war.practical_start_time;
  const finish = active ? null : latest?.finish_time ?? first;
  statements.push(env.DB.prepare(`UPDATE sync_state SET war_state = ?, updated_at = CURRENT_TIMESTAMP
    WHERE name = ? AND active_war_id = ? AND war_state IN ('current', 'practically_finished') AND ${guard}`)
    .bind(active ? "current" : "practically_finished", SOURCE_NAME, war.id, ...bindGuard));
  statements.push(env.DB.prepare(`UPDATE wars SET practical_start_time = ?, practical_finish_time = ?,
    faction_respect_limit = COALESCE(?, faction_respect_limit), practical_revision = practical_revision + 1,
    practical_rebuild_pending = 1 WHERE id = ? AND practical_revision = ?`)
    .bind(first, finish, latest?.target ?? null, ...bindGuard));
  const result = await env.DB.batch(statements);
  if (d1Changes(result[result.length - 1]) === 0) throw new Error("STALE_PHASE_REVISION");
  // Reconciliation also invalidates caches. A cache failure must not report an
  // already committed edit as rejected or invite the caller to duplicate it.
  try {
    await bumpWarCacheVersionById(env, war.id);
    await bumpGlobalWarCacheVersion(env);
  } catch (error) { console.warn("Phase saved; cache invalidation will retry during reconciliation", error); }
}

export async function reconcilePracticalPhaseStats(env: Env, warId: number): Promise<void> {
  const war = await readPhaseWar(env, warId);
  if (!war.practical_rebuild_pending) return;
  // Association is independent of practical eligibility. Keep whole-war attacks
  // available to score reconstruction and official views, including every gap.
  await env.DB.prepare(`UPDATE attacks SET war_id = ? WHERE war_id IS NULL
    AND started >= ? AND COALESCE(ended, started) <= ?
    AND (attacker_faction_id = ? OR defender_faction_id = ?)`)
    .bind(warId, war.official_start_time ?? war.practical_start_time, war.official_end_time ?? nowSeconds(), HOME_FACTION_ID, HOME_FACTION_ID).run();
  await rebuildWarStatsFromRaw(env, { scope: "single-war", warId, reason: "lifecycle" });
  await env.DB.prepare("UPDATE wars SET practical_rebuild_pending = 0 WHERE id = ? AND practical_revision = ?")
    .bind(warId, war.practical_revision).run();
  await bumpWarCacheVersionById(env, warId);
  await bumpGlobalWarCacheVersion(env);
}

export async function processPracticalPhases(env: Env, warId: number, score: number | null, observedAt: number, officialEnd: number | null = null): Promise<void> {
  const war = await readPhaseWar(env, warId);
  if (war.war_type !== "termed") return;
  const before = await readPracticalPhases(env, warId);
  const end = officialEnd ?? war.official_end_time;
  const needsScores = before.some((p) => p.removed_at === null &&
    (p.status === "active" || p.reason === "awaiting_reconciliation" || (p.status === "scheduled" && p.scheduled_start <= nowSeconds())));
  const rows = needsScores ? (await env.DB.prepare(`SELECT id, COALESCE(ended, started) AS at, respect_gain FROM attacks
    WHERE attacker_faction_id = ? AND defender_faction_id = ? AND started >= ?
      AND COALESCE(ended, started) <= ? AND respect_gain > 0
    ORDER BY COALESCE(ended, started), id`).bind(HOME_FACTION_ID, war.enemy_faction_id,
      war.official_start_time ?? war.practical_start_time, Math.min(observedAt, end ?? observedAt))
    .all<{ id: number; at: number; respect_gain: number }>()).results ?? [] : [];
  const total = rows.reduce((sum, row) => sum + row.respect_gain, 0);
  const after = before.map((phase) => {
    if (phase.removed_at !== null) return phase;
    let accumulated = 0;
    const crossing = rows.find((row) => { accumulated += row.respect_gain; return phase.target !== null && accumulated >= phase.target; });
    return resolvePhase(phase, { score: score ?? -1, observed_at: observedAt,
      crossing_at: crossing?.at ?? null,
      complete: score !== null && (score < (phase.target ?? Infinity) || Math.abs(total - score) < 0.1) }, nowSeconds(), end);
  });
  if (JSON.stringify(after) !== JSON.stringify(before)) await savePhaseTimeline(env, war, before, after, "automatic_transition", null);
  await reconcilePracticalPhaseStats(env, warId);
  for (const phase of await readPracticalPhases(env, warId)) {
    if (!phase.effects_pending || phase.removed_at !== null) continue;
    if (!await runPracticalPhaseHooks(env, phase, end !== null)) continue;
    await env.DB.prepare("UPDATE war_practical_phases SET effects_pending = 0 WHERE id = ? AND status = ?")
      .bind(phase.id, phase.status).run();
  }
}

export async function retryEndedPracticalPhases(env: Env, excludeWarId: number | null = null): Promise<void> {
  const wars = (await env.DB.prepare(`SELECT w.id, w.official_end_time, w.official_home_score
    FROM wars w WHERE w.id != ? AND w.war_type = 'termed' AND w.official_end_time IS NOT NULL AND (
      w.practical_rebuild_pending = 1 OR EXISTS (SELECT 1 FROM war_practical_phases p
        WHERE p.war_id = w.id AND p.removed_at IS NULL AND (p.effects_pending = 1 OR p.reason = 'awaiting_reconciliation' OR p.status IN ('scheduled', 'active'))))`)
    .bind(excludeWarId ?? -1).all<{ id: number; official_end_time: number; official_home_score: number | null }>()).results ?? [];
  for (const war of wars) await processPracticalPhases(env, war.id, war.official_home_score, nowSeconds(), war.official_end_time);
}

export async function closePracticalPhase(env: Env, warId: number, finishAt: number): Promise<boolean> {
  const war = await readPhaseWar(env, warId);
  if (war.war_type !== "termed") return false;
  const before = await readPracticalPhases(env, warId);
  const active = before.find((p) => p.status === "active" && p.removed_at === null);
  if (!active) return true;
  if (finishAt < active.start_time!) throw new Error("Finish must follow the active phase start");
  const after = before.map((p) => p.id === active.id ? { ...p, finish_time: finishAt, status: "completed" as const, reason: "manual", effects_pending: 1 } : p);
  await savePhaseTimeline(env, war, before, after, "manual_finish", null);
  await reconcilePracticalPhaseStats(env, warId);
  if (await runPracticalPhaseHooks(env, after.find((p) => p.id === active.id)!, false)) {
    await env.DB.prepare("UPDATE war_practical_phases SET effects_pending = 0 WHERE id = ?").bind(active.id).run();
  }
  return true;
}

export async function getPracticalPhases(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromUrl(url, env);
  if (war instanceof Response) return war;
  return json({ ok: true, ...await practicalPhaseSummary(env, war.id) });
}

export async function updateTermedWarSettings(env: Env, warId: number, body: Record<string, unknown>): Promise<Response> {
  const war = await env.DB.prepare("SELECT * FROM wars WHERE id = ?").bind(warId).first<Record<string, unknown>>();
  if (!war) return json({ ok: false, error: "War not found" }, 404);
  for (const field of ["practical_start_time", "practical_finish_time", "faction_respect_limit", "war_type"]) {
    if (body[field] !== undefined && body[field] !== war[field]) {
      return json({ ok: false, error: "Use practical phase controls to change windows and targets", code: "USE_PHASE_EDITOR" }, 409);
    }
  }
  if (body.practical_revision !== war.practical_revision) return json({ ok: false, error: "Reload before saving", code: "STALE_PHASE_REVISION" }, 409);
  const optionalTarget = (value: unknown, fallback: unknown) => {
    if (value === undefined) return fallback;
    if (value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error("Invalid respect target");
    return number;
  };
  if (!(Number(war.faction_respect_limit) > 0)) return json({ ok: false, error: "Set the phase target first" }, 400);
  const updated = await env.DB.prepare(`UPDATE wars SET enemy_target_respect = ?, member_respect_limit = ?,
    practical_revision = practical_revision + 1
    WHERE id = ? AND practical_revision = ? RETURNING *`).bind(
      optionalTarget(body.enemy_target_respect, war.enemy_target_respect),
      optionalTarget(body.member_respect_limit, war.member_respect_limit), warId, body.practical_revision).first();
  if (!updated) return json({ ok: false, error: "Reload before saving", code: "STALE_PHASE_REVISION" }, 409);
  delete updated.auto_end_enabled;
  await bumpWarCacheVersionById(env, warId);
  await bumpGlobalWarCacheVersion(env);
  return json({ ok: true, war: { ...updated, ...await practicalPhaseSummary(env, warId) } });
}

export async function mutatePracticalPhases(request: Request, url: URL, env: Env): Promise<Response> {
  let committed = false;
  try {
    const found = await readWarFromUrl(url, env);
    if (found instanceof Response) return found;
    const war = await readPhaseWar(env, found.id);
    if (war.war_type !== "termed") return json({ ok: false, error: "Practical phases require a termed war" }, 400);
    const body = await request.json() as Record<string, unknown>;
    if (body.revision !== war.practical_revision) throw new Error("STALE_PHASE_REVISION");
    if (body.action === "retry") {
      await reconcilePracticalPhaseStats(env, war.id);
      return getPracticalPhases(url, env);
    }
    const before = await readPracticalPhases(env, war.id);
    const after = before.map((p) => ({ ...p }));
    const selected = after.find((p) => p.id === body.phase_id && p.removed_at === null);
    const now = nowSeconds();
    const target = Number(body.target);
    const timestamp = (value: unknown): number => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("A valid timestamp is required");
      return parsed;
    };
    const needsTarget = ["reopen", "schedule", "update", "add_history", "edit_history", "set_target"].includes(String(body.action));
    if (needsTarget && (!Number.isFinite(target) || target <= 0)) throw new Error("A positive cumulative target is required");
    const create = (start: number): PracticalPhase => ({ id: crypto.randomUUID(), war_id: war.id, target,
      scheduled_start: start, start_time: null, finish_time: null, status: "scheduled", reason: null, removed_at: null, effects_pending: 0 });
    if (body.action === "reopen" || body.action === "schedule") {
      if (war.official_end_time !== null || war.status !== "active") throw new Error("This war is not open");
      if (after.some((p) => !p.removed_at && (p.status === "active" || p.status === "scheduled"))) throw new Error("Close the active phase or manage the existing reopening first");
      const start = body.action === "reopen" ? now : timestamp(body.start_time);
      if (start < now) throw new Error("Use history corrections for past windows");
      after.push(create(start));
    } else if (["update", "cancel", "start_now"].includes(String(body.action))) {
      if (!selected || selected.status !== "scheduled") throw new Error("Scheduled phase not found");
      if (body.action === "cancel") { selected.status = "cancelled"; selected.reason = "admin_cancelled"; }
      else {
        if (war.official_end_time !== null) throw new Error("This war has officially ended");
        if (body.action === "update") selected.target = target;
        selected.scheduled_start = body.action === "start_now" ? now : timestamp(body.start_time);
        selected.reason = null;
        if (selected.scheduled_start < now) throw new Error("Scheduled start cannot be in the past");
      }
    } else if (body.action === "set_target") {
      if (!selected || selected.status !== "active") throw new Error("Active phase not found");
      selected.target = target;
    } else if (["add_history", "edit_history", "remove_history"].includes(String(body.action))) {
      if (body.action !== "add_history" && (!selected || selected.status !== "completed")) throw new Error("Only completed phases can be corrected");
      if (body.action === "remove_history") selected!.removed_at = now;
      else {
        const start = timestamp(body.start_time);
        const finish = timestamp(body.finish_time);
        if (finish > now) throw new Error("History must end in the past");
        const phase = body.action === "add_history" ? create(start) : selected!;
        Object.assign(phase, { target, scheduled_start: start, start_time: start, finish_time: finish,
          status: "completed", reason: "history_correction", effects_pending: 0 });
        if (body.action === "add_history") after.push(phase);
      }
    } else throw new Error("Unknown phase action");
    validatePhaseTimeline(after, war.official_start_time ?? war.practical_start_time, war.official_end_time);
    await savePhaseTimeline(env, war, before, after, String(body.action), await readAuthenticatedUserId(request, env));
    committed = true;
    // The regular ingestion runner supplies fresh score evidence. Immediate starts
    // are processed there too, after fetching attacks, never from a stale score.
    if (body.action === "reopen" || body.action === "start_now") {
      const { runIngestion } = await import("./ingestion");
      await runIngestion(env, "practical-phase");
    } else await reconcilePracticalPhaseStats(env, war.id);
    return getPracticalPhases(url, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stale = message === "STALE_PHASE_REVISION";
    return json({ ok: false, error: stale ? "Phases changed. Reload before saving." : message,
      code: stale ? "STALE_PHASE_REVISION" : committed ? "PHASE_RECONCILIATION_PENDING" : "INVALID_PHASE",
      saved: committed }, stale ? 409 : committed ? 503 : 400);
  }
}
