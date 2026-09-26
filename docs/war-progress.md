# War Room progress panel

Apply migration `0163_add_war_score_history.sql` before deploying the worker.
It adds `war_score_state` and `war_score_history`, both removed automatically
when their parent war is deleted. Migration `0162` supplies the enemy target.

The existing one-minute ranked-war polling updates the latest state and keeps
the first actual observation in each UTC 15-minute interval. No extra Torn API
calls are made. Collection continues after practical tracking ends, until Torn
reports the official end. The last observation retains its actual observation
timestamp; the chart displays final scores at Torn's official end time.
No history is reconstructed for periods before collection or missed intervals.

`GET /api/wars/:name/progress` is member-authenticated and cached for 55 seconds.
It returns saved targets, latest official scores and target, and ordered history.
There is no write endpoint for the panel. Events do not use this panel.

## Target calculations

Torn's returned target is treated as already decayed, as agreed for this feature.
The original is derived using the official start and observation time, then
retained. The first 24 hours use the full target; hourly steps then reduce it by
1% of the original, reaching zero at hour 124. Values retain their fractional
precision. If collection first observes zero, the original cannot be inferred
and predictions remain unavailable.

Each prediction finds the first target step that meets the absolute net lead,
holding scores constant. No scoring pace is extrapolated. A tie has no projected
winner; a planned lead that already meets the target ends when those scores are
reached. Completed wars show the recorded finish instead of predictions.

## Temporary targets

The inputs start with the saved faction respect limit and enemy target respect.
An empty or exceeded target uses that faction's current official score. Local
drafts survive polling and collapsing, but reset on reload or changing wars.
They never call a write API or use browser storage. Stale data and gaps in
history are indicated explicitly. Times are shown in TCT (UTC).
