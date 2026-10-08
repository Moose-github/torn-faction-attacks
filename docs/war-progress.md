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

Recorded war pages also show this panel when saved score history is available.
Wars without collected history omit it. Completed wars show final scores and
the historical graph, with no temporary targets or predictions. The finish date
and winner footer appears only in the War room.

## Target calculations

Torn's returned target is treated as already decayed, as agreed for this feature.
The original is derived using the official start and observation time, then
retained. The first 1% reduction occurs exactly at hour 24; subsequent hourly
steps remove 1% of the original, reaching zero at hour 123. Values retain their fractional
precision. If collection first observes zero, the original cannot be inferred
and predictions remain unavailable.

Each prediction finds the first target step that meets the absolute net lead,
holding scores constant. No scoring pace is extrapolated. A tie has no projected
winner; a planned lead that already meets the target ends when those scores are
reached. Completed wars show the recorded finish instead of predictions.

Below the graph, War length shows the duration from the official start to the
planned finish, and War end shows that finish date in TCT. These follow the
planned targets; completed wars use the official end instead. Tied targets
have no projected finish.

## Temporary targets

The inputs start with the saved faction respect limit and enemy target respect.
An empty or exceeded target uses that faction's current official score. Local
drafts survive polling and collapsing, but reset on reload or changing wars.
While a termed war is not officially ended, Reset targets appears below the
horizontal control only when a target differs from its saved amount. It clears
both local drafts and restores the latest saved faction and enemy targets.
They never call a write API or use browser storage. Stale data and gaps in
history are indicated explicitly. Times are shown in TCT (UTC).

Dragging the planned line adjusts the net lead in either direction. Once a
target reaches its current score, further movement raises the opposing target
instead. Neither target drops below recorded respect. Any planned increase
shared by both sides is preserved, including when reversing direction. The
keyboard slider also adjusts the net lead: up/down by 100 (Shift: 1,000),
Home/End to the bottom/top of the displayed range.

The horizontal drag control between the target inputs moves both targets
by the same amount, preserving the lead, winner, and projected finish. Drag
right to add respect to each side and left to subtract it; subtraction stops
when either target reaches its recorded score. Each gesture starts from the
current targets, and the handle recentres on release. The left/right
arrow keys adjust each target by 100 (Shift + arrows: 1,000); Home removes the
shared increase. This remains a local preview and does not save war settings.
