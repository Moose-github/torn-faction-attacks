# War phase model

`shared/warPhase.ts` is the common frontend/backend phase detector. It is pure:
callers supply the war, current Unix time in seconds, and optionally the global
war identity/state. Detection never writes lifecycle state or runs hooks.

Persisted state remains `none`, `upcoming`, `current`, or
`practically_finished`. Lifecycle commands own writes; termed timeline updates
still commit the state, compatibility timestamps, revision, and audit together.
Both write paths use the shared state type and identity validation.

When adding or correcting a past phase, the finish time is optional. Leaving it
blank reconstructs the first attack that reached the cumulative target, using
respect earned across the whole official war, including gaps between phases.
Attack totals must reconcile with the stored war score; final reports allow for
truncation to whole respect. An unreached target stays active while the war is
open and closes through normal phase processing. An ended war with an unreached
target requires a different target or an explicit finish. Calculated windows
still obey official bounds and overlap checks. Completed history corrections
do not replay lifecycle notifications.

The derived phases are `none`, `upcoming`, `preparation`, `current`,
`practically_finished`, and `officially_ended`. Official completion takes
precedence over stale current state. Confirmed termed phases govern reopening;
scheduled, skipped, cancelled, and removed phases cannot activate tracking.
Older records fall back to practical timestamps and lifecycle state.

The two-hour preparation window is measured from official start, falling back
to practical start. Legacy tracking windows include their finish second and
close on the following second. A confirmed closed lifecycle state disables
operations immediately. Invalid timing data cannot enable live operations.

The resolver separates member tracking, clock-based live tracking, and
lifecycle-confirmed current actions. This preserves preparation polling and
the distinction between a visible Hospital monitor panel and its enabled
launch button. An optional global context restricts operations to the selected
global war; backend callers that already select an eligible war can omit it.

`shared/warRoomPolicy.ts` owns all 17 non-event panel rules. Panel collapse state,
permissions, data availability, and enabled actions are separate from visibility.
Regenerate the review table with `node scripts/war-room-visibility.mjs` after
changing the policy. Tests independently capture the existing visibility table.

The dashboard recomputes time-based eligibility each second and refreshes War
Room lifecycle data every minute or on `practical-phases-changed`. Request
identities reject superseded lifecycle responses; panel effects restart when
the selected war, derived phase, or practical revision changes.

Event layout and event tracking timing retain their existing path. Background
target selection, collection cadence, attack classification, lifecycle hooks,
and retention remain owned by their existing modules.
