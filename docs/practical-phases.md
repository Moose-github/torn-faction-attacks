# Termed war practical phases

Termed wars automatically close practical time at their cumulative faction target.
The old auto-end toggle is no longer used. Real wars and events retain their existing behaviour.

Admins can reopen immediately or schedule one reopening after the previous phase
has closed. Pending reopenings can be edited, cancelled, or started immediately.
At the intended start, an already-met target skips the phase. Otherwise practical
time runs from the intended start until the crossing hit, manual closure, or official
end. Delayed processing reconstructs this from attacks, including gap attacks in
the overall score. A gap never becomes practical just because another phase opens.

When the official score and attack history cannot establish a crossing timestamp,
the UI shows `awaiting_reconciliation`. Ingestion retries each minute. An unresolved
active phase is bounded by official end while its earlier target crossing is being
reconciled; an unresolved scheduled phase contributes no practical time. No monitoring
samples are invented for delayed execution.

## Interfaces

`GET /api/wars/:name/practical-phases` is member-authenticated. It returns
`practical_revision`, `practical_phases`, `pending_practical_phase`,
`practical_duration_seconds`, and `practical_rebuild_pending`. War list, detail,
and global-war responses include the same phase summary for termed wars.

`POST` on the same path is admin-only. Every request supplies `revision` and `action`:

| Action | Additional fields |
| --- | --- |
| `reopen` | `target` |
| `schedule` | `target`, `start_time` |
| `update` | `phase_id`, `target`, `start_time` |
| `start_now`, `cancel` | `phase_id` |
| `set_target` | Active `phase_id`, `target` |
| `add_history` | `target`, `start_time`, `finish_time` |
| `edit_history` | Completed `phase_id`, `target`, `start_time`, `finish_time` |
| `remove_history` | Completed `phase_id` |
| `retry` | None; retry a pending statistics rebuild |

Times are Unix seconds; the dashboard labels date inputs TCT/UTC. Targets must be
positive. Phase windows cannot overlap or share an attack boundary. Historical
boundaries are explicit: changing a historical target does not move its finish.
Removed phases and before/after corrections remain in the database audit.

A stale revision returns 409 without changes. If an edit commits but its rebuild
fails, the response is 503 with `saved: true` and `PHASE_RECONCILIATION_PENDING`.
Reload the phase list and retry reconciliation rather than repeating the edit.
An immediate reopening with unavailable upstream data remains visible as pending.

War-wide member/enemy target edits advance the same revision as phase changes.
Their dashboard payload omits phase timestamps and the phase target, so editing
these settings cannot round or overwrite authoritative phase boundaries.

Statistics rebuilds and incremental ingestion each update totals and attack
`stats_pending` markers in one database transaction. A rebuild acknowledges the
attacks in its snapshot; ingestion adds only still-pending attacks. This prevents
double counting when a correction overlaps ingestion or a batch is retried, while
retaining the original `ingest_run_id` for diagnostics. Failed termed-war ingestion
queues reconciliation for the next tick, including when no new attacks arrive.

Phase records are authoritative. The old practical timestamps summarize the first
start and latest finish (or null while active), and must not be used as one continuous
counting window. Official attack association includes gaps; practical predicates
select the union of active/completed phase windows. Legacy untimed attacks retain
their original eligibility until that legacy phase is explicitly corrected.

## Deployment and verification

1. Run `npm run schema:check`, `npm test`, `npm run check:worker`, and
   `npm --prefix dashboard run build`.
2. Check existing open termed wars for missing/nonpositive `faction_respect_limit`:
   `SELECT id, name, faction_respect_limit FROM wars WHERE war_type = 'termed' AND official_end_time IS NULL AND (faction_respect_limit IS NULL OR faction_respect_limit <= 0);`
   Obtain any missing targets before rollout; do not infer them. Historical null
   targets remain valid legacy records.
3. Apply `0170_add_practical_phases.sql` before deploying the worker and dashboard.
   It backfills one phase per existing termed war and retains the unused database
   auto-end column for compatibility. Only the new worker should edit phases.
   For the concurrency fix, apply `0171_track_pending_attack_stats.sql` before
   deploying its worker build. This additive migration requires no dashboard downtime.
4. Confirm the active war's phase status, target, practical duration, and global
   tracking state. Check for `practical_rebuild_pending = 1` and phase reasons
   `awaiting_reconciliation` / `target_required` after ingestion ticks.

Lifecycle effects have phase-specific completion latches and short leases.
Target notifications also retain delivery receipts and use a stable Discord nonce
to suppress duplicates on short retries. As with other external deliveries, a crash
after Discord accepts a message but before its receipt is saved cannot provide an
unbounded exactly-once guarantee.

Do not roll back to the single-window worker after multiple phases have been used:
it would count the gaps. Keep the phase-aware worker and correct or cancel phases
through the admin controls instead.
