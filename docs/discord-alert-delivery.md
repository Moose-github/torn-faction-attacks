# Discord message delivery controls

Every on/off switch in **Admin controls → Discord → Discord alerts** controls
Discord message delivery. Muting an alert leaves its underlying feature active.
Use the feature's own controls to stop tracking or end an event.

- Chain watch controls the persistent status message. Warning, critical and
  dropped each have their own delivery switch and channel assignment. The
  monitoring state, alarms, watcher assignments and new-chain detection continue
  while messages are muted. Muted warning/drop events are processed normally;
  re-enabling does not replay old warnings.
- Home and target travel have independent delivery switches. Their existing
  tracking controls, data refreshes, manual targets and war lifecycle still run.
  The delivery preference persists across war starts. Muting blocks new messages,
  edits and stopped notices; re-enabling updates the tracker with current data.
- The retaliation board continues refreshing opportunities and scheduling its
  active refresh loop while its Discord message is muted.
- Enemy pressure and shoplifting data, scouting, competition rollover, and war
  completion run independently of their Discord message switches. A ready scouting
  report stays pending while muted and can be delivered after re-enabling.

Alerts use their own assigned channel/thread, or the default route if no specific
assignment exists. The **Test** button is an explicit delivery test and can send a
test message even when automatic messages are off. Existing messages stay in
Discord when muted; use the message deletion control to remove a message.

The five new Chain Watch/travel delivery preferences default to on and are stored
in the existing `alert_settings` table when changed. No new migration is needed
for these delivery settings. Deploy both the Worker and dashboard for the new
toggles to be available.
