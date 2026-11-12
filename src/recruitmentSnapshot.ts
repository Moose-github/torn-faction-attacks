import { CITY_JOBS, type RecruitmentSnapshot } from '../shared/recruitment';
import type { Env } from './types';
import { fetchTrackedTornResponse } from './external/torn';
import { readRecruitmentKeys, reserveRecruitmentPoolCall, SNAPSHOT_REFRESH_STATE } from './recruitmentKeys';
import { markTornKeyFailure } from './tornKeyPool';
import { nowSeconds } from './utils';
import { rebuildRecruitmentResults } from './recruitmentResults';

export class RecruitmentInputError extends Error {}
type SnapshotPlayer = { player_id: number; username: string; city_job: string | null; level: number; faction_id: number | null };

// CSV quoting matters: fed reasons can contain commas, escaped quotes or newlines.
export function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.some(value => value !== '')) yield row;
        row = [];
      }
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new RecruitmentInputError('The snapshot returned invalid CSV quoting.');
      cell += c;
    }
  }
  if (quoted) throw new RecruitmentInputError('The snapshot ends inside a quoted field.');
  if (row.length || cell.length || closed) { row.push(cell); yield row; }
}

export function parseRecruitmentSnapshot(text: string) {
  const rows = csvRows(text);
  const header = rows.next().value as string[] | undefined;
  const required = ['id', 'name', 'company', 'job', 'level', 'faction', 'fed'];
  if (!header || new Set(header).size !== header.length || required.some(h => !header.includes(h))) {
    throw new RecruitmentInputError('Torn did not return the expected player snapshot. Saved candidates are unchanged.');
  }
  const columns = Object.fromEntries(required.map(h => [h, header.indexOf(h)]));
  const ids = new Set<number>();
  const players: SnapshotPlayer[] = [];
  let total = 0, unemployed = 0, city = 0, fedded = 0;
  for (const row of rows) {
    if (row.length !== header.length) throw new RecruitmentInputError(`Snapshot row ${total + 2} has the wrong number of fields.`);
    const id = Number(row[columns.id]), level = Number(row[columns.level]);
    const name = row[columns.name].trim(), company = row[columns.company], job = row[columns.job];
    const fed = row[columns.fed], faction = row[columns.faction];
    if (!/^[1-9]\d*$/.test(row[columns.id]) || !Number.isSafeInteger(id) || ids.has(id)
      || !name || name.length > 100 || !/^\d+$/.test(row[columns.level]) || level < 1 || level > 100
      || !/^\d+$/.test(fed) || !Number.isSafeInteger(Number(fed))
      || (company !== '' && (!/^\d+$/.test(company) || !Number.isSafeInteger(Number(company))))
      || (faction !== '' && (!/^\d+$/.test(faction) || !Number.isSafeInteger(Number(faction))))) {
      throw new RecruitmentInputError(`Snapshot row ${total + 2} has invalid or duplicate player data.`);
    }
    ids.add(id); total++;
    if (total > 250_000) throw new RecruitmentInputError('Snapshot exceeds 250,000 players.');
    if (Number(fed) > 0) { fedded++; continue; }
    if (Number(company) > 0) continue;
    if (job !== '' && !(CITY_JOBS as readonly string[]).includes(job)) {
      throw new RecruitmentInputError(`Unknown city job in snapshot row ${total + 1}.`);
    }
    if (job === '') unemployed++; else city++;
    players.push({ player_id: id, username: name, city_job: job || null, level, faction_id: Number(faction) || null });
  }
  if (!total) throw new RecruitmentInputError('The snapshot contains no players.');
  return { players, total_players: total, unemployed, city_jobs: city, excluded_fed: fedded };
}

export async function saveRecruitmentSnapshot(env: Env, text: string, date: string, now: number): Promise<RecruitmentSnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date || date > new Date(now * 1000).toISOString().slice(0, 10)) {
    throw new RecruitmentInputError('Invalid snapshot date.');
  }
  const parsed = parseRecruitmentSnapshot(text);
  const { players, ...counts } = parsed;
  const snapshot = { id: crypto.randomUUID(), snapshot_date: date, imported_at: now, ...counts };
  await env.DB.prepare(`INSERT INTO recruitment_snapshots(id, snapshot_date, imported_at, total_players, unemployed, city_jobs, excluded_fed)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(snapshot.id, date, now, counts.total_players, counts.unemployed, counts.city_jobs, counts.excluded_fed).run();
  try {
    for (let i = 0; i < players.length; i += 1000) {
      await env.DB.prepare(`INSERT INTO recruitment_snapshot_players(snapshot_id, player_id, username, city_job, level, faction_id)
        SELECT ?, json_extract(value, '$.player_id'), json_extract(value, '$.username'), json_extract(value, '$.city_job'),
          json_extract(value, '$.level'), json_extract(value, '$.faction_id') FROM json_each(?)`)
        .bind(snapshot.id, JSON.stringify(players.slice(i, i + 1000))).run();
    }
    // Only a complete import becomes visible. Concurrent older imports cannot replace newer data.
    await env.DB.batch([env.DB.prepare(`UPDATE recruitment_current_snapshot SET snapshot_id = ? WHERE id = 1 AND
      (snapshot_id IS NULL OR EXISTS (SELECT 1 FROM recruitment_snapshots old WHERE old.id = snapshot_id AND
        (old.snapshot_date < ? OR (old.snapshot_date = ? AND old.imported_at <= ?))))`)
      .bind(snapshot.id, date, date, now),
      env.DB.prepare('UPDATE recruitment_scan SET results_pending = 1 WHERE id = 1 AND changes() > 0')]);
  } catch (error) {
    await env.DB.prepare('DELETE FROM recruitment_snapshot_players WHERE snapshot_id = ?').bind(snapshot.id).run();
    await env.DB.prepare('DELETE FROM recruitment_snapshots WHERE id = ?').bind(snapshot.id).run();
    throw error;
  }
  await rebuildRecruitmentResults(env);
  // Keep current data and recent in-progress imports; do not accumulate daily copies.
  // Cleanup is best-effort and must never roll back a successfully published import.
  const obsolete = `SELECT id FROM recruitment_snapshots WHERE imported_at < ?
    AND id NOT IN (SELECT snapshot_id FROM recruitment_current_snapshot WHERE snapshot_id IS NOT NULL)`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM recruitment_snapshot_players WHERE snapshot_id IN (${obsolete})`).bind(now - 86400),
    env.DB.prepare(`DELETE FROM recruitment_snapshots WHERE id IN (${obsolete})`).bind(now - 86400),
  ]).catch(() => undefined);
  return snapshot;
}

async function readSnapshotResponse(response: Response) {
  const maxBytes = 20 * 1024 * 1024;
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel();
    throw new RecruitmentInputError('The player snapshot exceeds the supported size.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new RecruitmentInputError('Torn returned an empty player snapshot.');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let text = '', bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RecruitmentInputError('The player snapshot exceeds the supported size.');
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function refreshRecruitmentSnapshot(env: Env) {
  const now = nowSeconds();
  const today = new Date(now * 1000).toISOString().slice(0,10);
  const current = await env.DB.prepare(`SELECT s.* FROM recruitment_snapshots s JOIN recruitment_current_snapshot c
    ON s.id = c.snapshot_id WHERE c.id = 1`).first<RecruitmentSnapshot>();
  if (current?.snapshot_date === today) {
    await rebuildRecruitmentResults(env);
    return current;
  }
  const claim = await env.DB.prepare(`INSERT INTO sync_state(name, last_started) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET last_started = excluded.last_started, updated_at = CURRENT_TIMESTAMP
    WHERE sync_state.last_started <= ? RETURNING name`).bind(SNAPSHOT_REFRESH_STATE, now, now - 120).first();
  if (!claim) throw new RecruitmentInputError('A candidate refresh was just requested. Please wait two minutes before refreshing again.');
  const keys = await readRecruitmentKeys(env, now);
  for (const key of keys) {
    if (!await reserveRecruitmentPoolCall(env, key, nowSeconds(), { snapshotRefreshAt: now })) continue;
    const response = await fetchTrackedTornResponse(env, `https://api.torn.com/v2/user/snapshot?timestamp=${now}`,
      { headers: { Authorization: `ApiKey ${key.key}` } },
      { feature: 'company_recruitment', keySource: key.keySource, timeoutMs: 15_000 });
    const text = await readSnapshotResponse(response);
    let code: number | undefined;
    if (text.trimStart().startsWith('{')) {
      try { const body = JSON.parse(text); if (Number.isSafeInteger(body?.error?.code)) code = body.error.code; } catch { /* Invalid response is rejected below. */ }
    }
    if (!response.ok || code !== undefined) {
      const message = code === undefined ? `Torn snapshot request failed (HTTP ${response.status}).`
        : `Torn snapshot request failed (API error ${code}).`;
      const rateLimited = response.status === 429 || code === 5 || code === 14;
      const keyError = response.status === 401 || response.status === 403 || (code !== undefined && [1,2,7,10,13,16,18].includes(code));
      if (rateLimited || keyError) {
        const pauseSeconds = keyError || code === 14 ? 86400 : 120;
        await markTornKeyFailure(env, key.id, message, nowSeconds(), pauseSeconds);
        if (rateLimited) await env.DB.prepare(`UPDATE torn_api_keys SET paused_until = MAX(COALESCE(paused_until, 0), ?)
          WHERE owner_torn_user_id = (SELECT owner_torn_user_id FROM torn_api_keys WHERE id = ?)`).bind(nowSeconds() + pauseSeconds, key.id).run();
      }
      throw new RecruitmentInputError(`${message} Saved candidates are unchanged.`);
    }
    return saveRecruitmentSnapshot(env, text, new Date(now * 1000).toISOString().slice(0, 10), now);
  }
  throw new RecruitmentInputError('No pool key has capacity right now. Please try refreshing candidates again later.');
}
