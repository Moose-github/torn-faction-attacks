# Chain watch sign-ups

The independent watch is available at `/chain-watch` after signing in. It shares
the same D1 schedule with the Discord bot; it does not depend on a war or event.

## Live faction monitoring

A watch activates the shared faction chain monitor at its start time. Monitoring
uses the existing faction attack ingestion feed, including attacks without a war
assignment and chains which began before the watch. No separate attack poller is
created. The existing Torn chain endpoint remains the fallback when stored hits
are stale and the confirmation source before warnings.

The monitor has one faction state and one faction alarm. An enabled current war
can also request monitoring; disabling or ending that war does not stop a running
watch, and finishing the watch does not stop monitoring needed by the war. A
future watch does not activate monitoring early. Finishing all active requests
stops the monitor on its next tick or alarm. A dropped chain does not finish the
schedule or cancel assignments.

`GET /api/chain-watch/live` returns member-authenticated faction state, server
time, activation sources and computed countdown/status without fetching Torn.
The existing War Room endpoints remain compatibility views, and the Discord
chain-status control reads the faction monitor without requiring a war.

The page displays a live panel above the sign-up sheet with chain count, a
server-synchronised countdown, last hit, current/next watcher and monitoring
freshness. It polls the stored live endpoint every 15 seconds while visible and
on focus, independently of roster requests. The countdown ticks each second;
stale data or a failed refresh hides it, and local expiry waits for a monitoring
update before calling the chain dropped. Historical sheets never supply watcher
names for a different active watch.

The 60-second warning, 30-second critical warning and drop alert each post a new
Discord message, with the live status message continuing to update separately.
Each alert keeps its configured user/role mentions and appends the current slot's
assigned watcher using their linked Discord account, without changing alert
subscriptions or routing. The assignment is read at alert time, including at
hourly handovers and after admin reassignment; an already mentioned watcher is
included only once. Cancelled/unassigned slots, inactive watches and missing or
invalid Discord links add no watcher. The global chain-alert enable setting is
still respected, and an assignment lookup failure does not prevent the ordinary
alert from being delivered.

`chain_watch_missed_check_in` is available as a separate "Chain watch missed
check-in" alert setting, channel route and optional member subscription. Its
global toggle defaults to enabled; member subscriptions default to off, with no
role mentions preconfigured. The handover reminder, confirmation button and
missed check-in scheduling are not implemented yet; this adds the settings only.

`chain_watch_unfilled_slot` is a separate "Chain watch unfilled slot" alert. The
one-minute schedule job warns when an unassigned slot is one hour from starting,
including before the watch itself starts. If a slot becomes empty, a watch is
created, or delivery resumes during that final hour, it warns on the next tick.
Assigned, cancelled, finished and already-started slots are excluded. The message
includes UTC slot times, a relative start time and the watch sign-up link.

Delivery defaults to enabled and uses its own configured alert route or the
server's default route. Member subscriptions default to off; admin mentions and
subscriptions use the usual settings. A stored per-slot marker prevents repeated
warnings, including after assignment changes. Failed delivery retries until the
slot starts; a lease and stable Discord nonce protect overlapping ticks and
recent retries. Roster publication failures do not block these alerts.

Migration `0148_create_faction_chain_watch_state.sql` preserves the current
legacy monitor's message ID and warning markers. Legacy per-war alarms retire
after the Worker upgrade; the next ingestion tick schedules the faction alarm.
The old state table remains available for historical war reads.

## Discord commands

- `/chain-watch create name:<name> [start] [finish]` posts in the invoking channel.
- `/chain-watch setfinish finish:<time|ongoing>` targets the only unfinished watch.
  Finish is required: select a time or **No finish — continue daily sheets**.
  Typing `ongoing` also removes the finish. This works only before the watch ends.
- Time options offer the next 24 whole hours in a dropdown, labelled with UTC
  and today, tomorrow, or the date. Typing filters the suggestions.
- Time-only inputs such as `18` or `18:00` mean the next occurrence strictly
  after now for start/setfinish, or strictly after the chosen start for create's
  finish. Start `23:00`, finish `02:00` spans midnight; matching hours mean 24 hours.
- Dates display as `DD-MM-YY`, with time in `HH:00 UTC`. Enter a full date as
  `DD-MM-YY HH:00` for scheduling further ahead; two-digit years mean 2000–2099.
  Existing `YYYY-MM-DD HH:00` and ISO UTC inputs remain accepted.
  Selected suggestions store the displayed date/time,
  and command replies show the full resolved dates. An explicit date that has
  passed is rejected, rather than moved to the next day.
- Start defaults to the next whole hour. Each Discord sheet covers one UTC date:
  the first starts at the chosen hour and ends at midnight; following days cover
  00:00–24:00. With no finish, tomorrow's sheet is published at 12:00 UTC today.
  Creation after noon publishes tomorrow alongside today's partial sheet.
  A watch starting on a future date initially publishes just its first day.
- With a fixed finish, generate the full schedule as daily sheets, with the final
  day's slots ending at the finish time.
- Setting a finish cancels slots beginning at or after that time and preserves
  earlier assignments. Extending an unfinished watch reopens cancelled slots
  without restoring their assignments. Returning it to `ongoing` resumes noon
  publication: cancelled future days reopen as they become due, while active
  assignments and past history remain intact. An empty Discord command is rejected.
  The page's existing explicit confirmation of a next-hour finish is unchanged.

Both commands are **temporarily public for testing**, in the configured faction
server only. To restore administrator-only commands, set
`CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING = false` in `src/discordCommands.ts`,
deploy the Worker, and re-register the commands. That one constant controls both
the command manifest and the server permission check. Website admin checks are
never relaxed by this flag.

## Player and admin actions

Discord rosters have a compact name and date heading, a plain filled count on the next line,
hourly UTC ranges (e.g. 00:00 - 01:00), and Sign up, Leave slots, and Open page
buttons. Sign up and Leave slots each open one private message with the sheet's
date, time-only dropdown choices, and a Confirm button. Confirm enables after a valid selection; changing
the selection and confirming both update that same message. Each Discord user
has one active claim/leave message across all sheets. Opening another immediately
invalidates the previous one and attempts to delete it. An expired Discord token
or delivery failure can prevent deletion, but the old controls remain unusable.
Inactive private messages expire after ten minutes; an alarm attempts to remove
them and discards stored webhook credentials. Both platforms use the existing
Torn/Discord links.

Selections are bound to the user, private message and latest selection token.
Changing a selection invalidates the previous token, including when the new
selection is invalid. A per-user `ChainWatchSessions` Durable Object serializes
state changes and Discord responses and ignores out-of-order interaction IDs.
Completed messages cannot regain working controls. Interrupted or failed reply
updates close the session; reopen from the roster to continue. Confirmation tokens
are consumed in the same D1 transaction as the assignments to prevent replay.

All buttons disappear from a Discord sheet when it has no future, non-cancelled
slots left to edit (23:00 UTC for a full day).

Cancelled slots are hidden from Discord rosters. When every slot on a day is
cancelled, its Discord message is deleted. The day, slots and assignment history
remain in the database and on the page. Deletion failures retry on the next sync;
extending an unfinished watch republishes any day whose slots reopen.

The current slot has a green dot on Discord and a green highlight on the page.
The indicator moves with the hour and never highlights cancelled slots.

The page shows all published slots in one chronological list, with small date
dividers and a link to each day's Discord roster. There is no sheet selector.

Players can claim multiple future slots, with a maximum of two consecutive hours
and at least one hour off. The rule also spans sheet boundaries. Started and past
slots are locked. Website admins can replace assignments and override time/break
restrictions. Cancelled slots and the single-watch restriction cannot be overridden.

Slot updates use D1 transactions and SQLite triggers to protect capacity,
ownership, current faction membership, started slots and breaks under concurrency.
If a multi-slot claim fails, none of that selection is saved.

The page refreshes every 15 seconds while visible and on focus. Changes request an
immediate Discord refresh; a separate minute cron retries missed updates and
publishes successor sheets. Per-sheet leases prevent concurrent message edits;
dirty counters retain changes made during an in-flight edit. Discord failures do
not discard assignments. Deleted rosters with non-cancelled slots are recreated
when next refreshed.

On reconciliation, an unfinished watch with the old rolling layout is converted
transactionally to daily sheets. Existing slot times, assignments, cancellation
history and pending confirmations are preserved. Existing Discord messages are
reused for their original UTC date, and any newly split day gets its own message.
Already published days are filled out to midnight for an ongoing watch.
No schema migration is needed for this conversion.

## Release steps

1. Apply D1 migrations through `0152_add_chain_watch_unfilled_slot_alerts.sql` to the target database.
2. Deploy the Worker and dashboard. The existing `DISCORD_GUILD_ID`,
   `DISCORD_BOT_TOKEN`, and `DISCORD_PUBLIC_KEY` configuration is reused.
   Worker deployment applies Durable Object migration `v3` and binds
   `CHAIN_WATCH_SESSIONS`; the session safeguards require no additional D1
   migration. Private pickers opened before this deployment must be reopened
   from the roster. Public roster buttons and existing assignments are preserved.
3. Register commands with `npm run discord:commands:guild` (or the existing global
   registration workflow), supplying `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`
   and, for guild registration, `DISCORD_GUILD_ID` through the environment.
4. The bot needs View Channel, Send Messages and Embed Links in the chosen channel.
   For threads it also needs Send Messages in Threads.

The automated tests use an in-memory SQLite database and a fake Discord transport;
they do not post to the live Discord server. The SQLite adapter requires Node 22.13+
or a newer Node release with `node:sqlite` available.
