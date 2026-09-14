import { bumpWarCacheVersionById } from "./cacheVersions";
import { fetchTrackedTornJson } from "./external/torn";
import { runWithTornKeyPool } from "./tornKeyPool";
import { readWarFromUrl } from "./warRequest";
import type { Env, WarRow } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";

export type EventType = "general" | "elimination" | "halloween";
const FINAL_GRACE_SECONDS = 15 * 60;
const RETRY_SECONDS = 60;
const MAX_ATTEMPTS = 3;

type CompetitionReading =
  | { type: "elimination"; participation: "participating" | "not_participating"; team: string | null }
  | { type: "halloween"; treats: number; basketId: number; basketName: string };

export function parseCompetitionReading(value: unknown, type: EventType): CompetitionReading {
  const competition = (value as { competition?: Record<string, unknown> } | null)?.competition;
  if (!competition || competition.name !== (type === "elimination" ? "Elimination" : "Halloween")) {
    throw new Error("Competition data unavailable or a different competition was returned");
  }
  if (type === "elimination") {
    if (typeof competition.team !== "string" || !competition.team.trim()) {
      throw new Error("Elimination team unavailable");
    }
    const team = competition.team.trim();
    return team.toLowerCase() === "unknown"
      ? { type, participation: "not_participating", team: null }
      : { type, participation: "participating", team };
  }
  const basket = competition.basket as Record<string, unknown> | null;
  if (type !== "halloween" || !Number.isSafeInteger(competition.treats_collected)
    || Number(competition.treats_collected) < 0 || !basket || !Number.isSafeInteger(basket.id)
    || typeof basket.name !== "string" || !basket.name.trim()) {
    throw new Error("Halloween reading incomplete");
  }
  return { type, treats: Number(competition.treats_collected), basketId: Number(basket.id), basketName: basket.name };
}

export function parseEventCompetitionSettings(body: { event_type?: unknown; competition_refresh_hours?: unknown }, existing?: WarRow) {
  const eventType = body.event_type ?? existing?.event_type ?? "general";
  const hours = body.competition_refresh_hours ?? existing?.competition_refresh_hours ?? 6;
  if (!["general", "elimination", "halloween"].includes(String(eventType)) || typeof eventType !== "string") {
    throw new Error("Event type must be general, elimination or halloween");
  }
  if (hours !== 6 && hours !== 12) throw new Error("Competition refresh must be 6 or 12 hours");
  return { eventType: eventType as EventType, hours };
}

export async function ensureEventCompetitionStarted(env: Env, warId: number, now = nowSeconds()): Promise<void> {
  const war = await env.DB.prepare("SELECT * FROM wars WHERE id = ?").bind(warId).first<WarRow>();
  if (!war || war.war_type !== "event" || war.status !== "active" || !war.event_type || war.event_type === "general"
    || war.practical_start_time > now || (war.practical_finish_time !== null && war.practical_finish_time <= now)) return;
  if (war.event_type === "halloween") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE event_competition_members SET poll_kind = 'refresh', poll_due_at = ?,
        attempts = 0, lease_until = 0, final_observed_at = NULL
        WHERE war_id = ? AND EXISTS (SELECT 1 FROM event_competition_state WHERE war_id = ? AND final_requested_at IS NOT NULL)`)
        .bind(now + (war.competition_refresh_hours ?? 6) * 3600, warId, warId),
      env.DB.prepare(`UPDATE event_competition_state SET final_requested_at = NULL, finish_at = NULL
        WHERE war_id = ? AND final_requested_at IS NOT NULL`).bind(warId),
    ]);
  }
  // Insert the roster before its latch in one transaction so retries cannot add later joiners.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO event_competition_members (war_id, member_id, member_name, report_exempt, poll_due_at)
      SELECT ?, member_id, name, COALESCE(report_exempt, 0), ? FROM home_faction_members
      WHERE is_current = 1 AND NOT EXISTS (SELECT 1 FROM event_competition_state WHERE war_id = ?)
      ON CONFLICT(war_id, member_id) DO NOTHING`).bind(warId, now, warId),
    env.DB.prepare(`INSERT INTO event_competition_state (war_id, initialized_at)
      SELECT ?, ? WHERE EXISTS (SELECT 1 FROM event_competition_members WHERE war_id = ?)
      ON CONFLICT(war_id) DO NOTHING`).bind(warId, now, warId),
  ]);
}

export async function requestEventCompetitionFinish(env: Env, warId: number, finishAt: number, now = nowSeconds()): Promise<void> {
  const state = await env.DB.prepare(`SELECT s.*, w.event_type FROM event_competition_state s
    JOIN wars w ON w.id = s.war_id WHERE s.war_id = ?`).bind(warId)
    .first<{ initialized_at: number; final_requested_at: number | null; event_type: EventType }>();
  if (!state || state.final_requested_at !== null) return;
  const canCollect = state.event_type === "halloween" && finishAt >= state.initialized_at && now <= finishAt + FINAL_GRACE_SECONDS;
  await env.DB.batch([
    env.DB.prepare(`UPDATE event_competition_members SET poll_kind = 'final', poll_due_at =
      CASE WHEN ? = 1 AND baseline_at IS NOT NULL THEN ? ELSE NULL END, attempts = 0, lease_until = 0,
      last_error = CASE WHEN ? = 0 OR baseline_at IS NULL THEN 'Finish reading unavailable' ELSE NULL END
      WHERE war_id = ? AND EXISTS (SELECT 1 FROM event_competition_state WHERE war_id = ? AND final_requested_at IS NULL)`)
      .bind(canCollect ? 1 : 0, now, canCollect ? 1 : 0, warId, warId),
    env.DB.prepare(`UPDATE event_competition_state SET final_requested_at = ?, finish_at = ?
      WHERE war_id = ? AND final_requested_at IS NULL`).bind(now, finishAt, warId),
  ]);
}

export async function rescheduleEventCompetition(env: Env, warId: number, hours: number): Promise<void> {
  await env.DB.prepare(`UPDATE event_competition_members
    SET poll_due_at = ?, attempts = 0
    WHERE war_id = ? AND poll_kind = 'refresh' AND lease_until = 0
      AND EXISTS (SELECT 1 FROM wars WHERE id = ? AND status = 'active' AND event_type = 'halloween')`)
    .bind(nowSeconds() + hours * 3600, warId, warId).run();
}

type PollRow = {
  war_id: number; member_id: number; poll_kind: "initial" | "refresh" | "final";
  poll_due_at: number; attempts: number; latest_treats: number | null;
  event_type: EventType; competition_refresh_hours: number; finish_at: number | null;
};

export async function runEventCompetitionCron(env: Env): Promise<void> {
  const now = nowSeconds();
  const active = await env.DB.prepare(`SELECT id FROM wars WHERE war_type = 'event' AND status = 'active'
    AND event_type != 'general'`).all<{ id: number }>();
  for (const war of active.results ?? []) await ensureEventCompetitionStarted(env, war.id, now);
  // Recover a finish interrupted between the lifecycle update and collection scheduling.
  const ended = await env.DB.prepare(`SELECT w.id, w.practical_finish_time FROM wars w
    JOIN event_competition_state s ON s.war_id = w.id
    WHERE w.status = 'ended' AND s.final_requested_at IS NULL`).all<{ id: number; practical_finish_time: number }>();
  for (const war of ended.results ?? []) await requestEventCompetitionFinish(env, war.id, war.practical_finish_time, now);
  const due = await env.DB.prepare(`SELECT m.*, w.event_type, w.competition_refresh_hours, s.finish_at
    FROM event_competition_members m JOIN wars w ON w.id = m.war_id
    JOIN event_competition_state s ON s.war_id = m.war_id
    WHERE m.poll_due_at <= ? AND m.lease_until <= ? AND (
      (w.status = 'active' AND m.poll_kind != 'final' AND w.practical_start_time <= ?
        AND (w.practical_finish_time IS NULL OR w.practical_finish_time > ?))
      OR (w.status = 'ended' AND m.poll_kind = 'final'))
    ORDER BY CASE m.poll_kind WHEN 'final' THEN 0 WHEN 'initial' THEN 1 ELSE 2 END, m.poll_due_at, m.member_id LIMIT 20`)
    .bind(now, now, now, now).all<PollRow>();
  const changed = new Set<number>();
  for (const row of due.results ?? []) {
    const startedAt = nowSeconds();
    const leaseUntil = startedAt + 90;
    const claimed = await env.DB.prepare(`UPDATE event_competition_members SET lease_until = ?
      WHERE war_id = ? AND member_id = ? AND poll_due_at = ? AND poll_kind = ? AND lease_until <= ?`)
      .bind(leaseUntil, row.war_id, row.member_id, row.poll_due_at, row.poll_kind, startedAt).run();
    if (!d1Changes(claimed)) continue;
    changed.add(row.war_id);
    try {
      if (row.poll_kind === "final" && startedAt > (row.finish_at ?? 0) + FINAL_GRACE_SECONDS) {
        throw new Error("Finish reading deadline passed");
      }
      const { result } = await runWithTornKeyPool(env, {
        feature: "war_live_data",
        run: async ({ key, keySource }) => fetchTrackedTornJson(env,
          `https://api.torn.com/v2/user/${row.member_id}/competition`,
          { headers: { Authorization: `ApiKey ${key}` } },
          { feature: "Event competition data", keySource, timeoutMs: 10000 }),
      });
      const reading = parseCompetitionReading(result, row.event_type);
      const observedAt = nowSeconds();
      if (reading.type === "halloween" && row.latest_treats !== null && reading.treats < row.latest_treats) {
        throw new Error("Treat counter decreased; previous reading retained");
      }
      if (reading.type === "elimination") {
        await env.DB.prepare(`UPDATE event_competition_members SET participation = ?, team_name = ?, captured_at = ?,
          poll_due_at = NULL, lease_until = 0, last_error = NULL
          WHERE war_id = ? AND member_id = ? AND lease_until = ? AND poll_kind = ?`)
          .bind(reading.participation, reading.team, observedAt, row.war_id, row.member_id, leaseUntil, row.poll_kind).run();
      } else {
        const targetAt = row.poll_kind === "final" ? row.finish_at! : row.poll_due_at;
        // Both writes use the lease and phase to discard responses superseded by a finish.
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO event_competition_snapshots
            (war_id, member_id, poll_kind, target_at, observed_at, treats_collected, basket_id, basket_name)
            SELECT war_id, member_id, ?, ?, ?, ?, ?, ? FROM event_competition_members
            WHERE war_id = ? AND member_id = ? AND lease_until = ? AND poll_kind = ?
            ON CONFLICT(war_id, member_id, poll_kind, target_at) DO NOTHING`)
            .bind(row.poll_kind, targetAt, observedAt, reading.treats, reading.basketId, reading.basketName,
              row.war_id, row.member_id, leaseUntil, row.poll_kind),
          env.DB.prepare(`UPDATE event_competition_members SET baseline_treats = COALESCE(baseline_treats, ?),
            baseline_at = COALESCE(baseline_at, ?), latest_treats = ?, latest_at = ?, basket_id = ?, basket_name = ?,
            final_observed_at = CASE WHEN poll_kind = 'final' THEN ? ELSE final_observed_at END,
            poll_due_at = ?, poll_kind = ?, lease_until = 0, attempts = 0, last_error = NULL
            WHERE war_id = ? AND member_id = ? AND lease_until = ? AND poll_kind = ?`)
            .bind(reading.treats, observedAt, reading.treats, observedAt, reading.basketId, reading.basketName,
              observedAt, row.poll_kind === "final" ? null : observedAt + row.competition_refresh_hours * 3600,
              row.poll_kind === "final" ? "final" : "refresh", row.war_id, row.member_id, leaseUntil, row.poll_kind),
        ]);
      }
    } catch (error) {
      const attempt = row.attempts + 1;
      const exhausted = attempt >= MAX_ATTEMPTS || (row.poll_kind === "final" && nowSeconds() + RETRY_SECONDS > (row.finish_at ?? 0) + FINAL_GRACE_SECONDS);
      const regular = exhausted && row.event_type === "halloween" && row.poll_kind !== "final";
      const nextAt = exhausted ? (regular ? nowSeconds() + row.competition_refresh_hours * 3600 : null) : nowSeconds() + RETRY_SECONDS;
      const message = error instanceof Error && /^(Competition data|Elimination team|Halloween reading|Treat counter|Finish reading)/.test(error.message)
        ? error.message : "Competition request failed";
      await env.DB.prepare(`UPDATE event_competition_members SET poll_due_at = ?, poll_kind = ?, attempts = ?,
        lease_until = 0, last_error = ? WHERE war_id = ? AND member_id = ? AND lease_until = ? AND poll_kind = ?`)
        .bind(nextAt, regular ? "refresh" : row.poll_kind, regular ? 0 : attempt, message,
          row.war_id, row.member_id, leaseUntil, row.poll_kind).run();
    }
  }
  for (const warId of changed) await bumpWarCacheVersionById(env, warId);
}

type MemberRow = {
  member_id: number; member_name: string; participation: string | null; team_name: string | null;
  captured_at: number | null; last_error: string | null; poll_due_at: number | null;
  baseline_at: number | null; final_observed_at: number | null;
};
export type CompetitionSnapshot = {
  member_id: number; observed_at: number; treats_collected: number; basket_name: string;
  poll_kind: string; target_at: number;
};

export function projectTreatReadings(samples: CompetitionSnapshot[], start: number, finish: number | null) {
  const members = new Map<number, { baseline: CompetitionSnapshot; latest: CompetitionSnapshot }>();
  const history: Array<{ observed_at: number; treats_gained: number }> = [];
  let total = 0;
  for (const sample of [...samples].sort((a, b) => a.observed_at - b.observed_at || a.member_id - b.member_id)) {
    if (sample.observed_at < start || (finish !== null && sample.observed_at > finish
      && !(sample.poll_kind === "final" && sample.target_at === finish))) continue;
    const member = members.get(sample.member_id);
    if (member) {
      if (sample.treats_collected < member.latest.treats_collected) continue;
      total += sample.treats_collected - member.latest.treats_collected;
      member.latest = sample;
    } else {
      members.set(sample.member_id, { baseline: sample, latest: sample });
    }
    const previous = history[history.length - 1];
    if (previous?.observed_at === sample.observed_at) previous.treats_gained = total;
    else history.push({ observed_at: sample.observed_at, treats_gained: total });
  }
  return { members, history, total };
}

export async function readEventCompetition(env: Env, war: WarRow) {
  if (war.war_type !== "event" || !war.event_type || war.event_type === "general") return null;
  const state = await env.DB.prepare("SELECT * FROM event_competition_state WHERE war_id = ?").bind(war.id)
    .first<{ initialized_at: number; final_requested_at: number | null; finish_at: number | null }>();
  const rows = await env.DB.prepare(`SELECT * FROM event_competition_members
    WHERE war_id = ? AND report_exempt = 0 ORDER BY member_name, member_id`).bind(war.id).all<MemberRow>();
  const samples = war.event_type === "halloween"
    ? await env.DB.prepare(`SELECT s.* FROM event_competition_snapshots s JOIN event_competition_members m
      ON m.war_id = s.war_id AND m.member_id = s.member_id
      WHERE s.war_id = ? AND m.report_exempt = 0 ORDER BY s.observed_at, s.member_id`).bind(war.id).all<CompetitionSnapshot>()
    : { results: [] };
  const projection = projectTreatReadings(samples.results ?? [], war.practical_start_time, war.practical_finish_time);
  const members = (rows.results ?? []).map((row) => {
    const readings = projection.members.get(row.member_id);
    const ended = war.status === "ended";
    const finalComplete = readings?.latest.poll_kind === "final" && readings.latest.target_at === war.practical_finish_time;
    return {
      member_id: row.member_id, member_name: row.member_name, participation: row.participation,
      team_name: row.team_name, captured_at: row.captured_at,
      baseline_at: readings?.baseline.observed_at ?? null, updated_at: readings?.latest.observed_at ?? row.captured_at,
      treats_gained: readings ? readings.latest.treats_collected - readings.baseline.treats_collected : null,
      basket_name: readings?.latest.basket_name ?? null,
      status: war.event_type === "elimination" ? (row.captured_at !== null ? "complete" : row.last_error ? "unavailable" : "pending")
        : ended ? (finalComplete ? "complete" : row.poll_due_at !== null ? "finishing" : "incomplete")
          : row.last_error ? "stale" : readings ? "tracking" : "pending",
      last_error: war.event_type === "elimination" && row.captured_at !== null ? null : row.last_error,
    };
  });
  return {
    event_type: war.event_type, refresh_hours: war.competition_refresh_hours ?? 6,
    initialized_at: state?.initialized_at ?? null, final_requested_at: state?.final_requested_at ?? null,
    members, total_treats_gained: projection.members.size ? projection.total : null, history: projection.history,
    next_refresh_at: war.status === "active" && (rows.results ?? []).some(row => row.poll_due_at !== null)
      ? Math.min(...(rows.results ?? []).flatMap(row => row.poll_due_at === null ? [] : [row.poll_due_at])) : null,
  };
}

export async function getEventCompetition(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromUrl(url, env);
  if (war instanceof Response) return war;
  return json({ ok: true, competition: await readEventCompetition(env, war) });
}
