# Chain watch sign-ups

The independent watch is available at `/chain-watch` after signing in. It shares
the same D1 schedule with the Discord bot; it does not depend on a war or event.

## Discord commands

- `/chain-watch create name:<name> [start] [finish]` posts in the invoking channel.
- `/chain-watch setfinish [finish]` targets the only unfinished watch.
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
- Setfinish defaults to the next whole hour, cancels slots beginning at or after
  the finish, and preserves earlier assignments. Extending an unfinished watch
  reopens cancelled slots without restoring their assignments.

Both commands are **temporarily public for testing**, in the configured faction
server only. To restore administrator-only commands, set
`CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING = false` in `src/discordCommands.ts`,
deploy the Worker, and re-register the commands. That one constant controls both
the command manifest and the server permission check. Website admin checks are
never relaxed by this flag.

## Player and admin actions

Discord rosters have a date heading, hourly UTC slots and Sign up, Leave slots, and Open page
buttons. Sign up and Leave slots each open one private message containing the
dropdown and a Confirm button. Confirm enables after a valid selection; changing
the selection and confirming both update that same message. Selections are bound
to the invoking player and expire after ten minutes. Both platforms use the
existing Torn/Discord links.

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
not discard assignments. Deleted rosters are recreated when next refreshed.

On reconciliation, an unfinished watch with the old rolling layout is converted
transactionally to daily sheets. Existing slot times, assignments, cancellation
history and pending confirmations are preserved. Existing Discord messages are
reused for their original UTC date, and any newly split day gets its own message.
Already published days are filled out to midnight for an ongoing watch.
No schema migration is needed for this conversion.

## Release steps

1. Apply D1 migration `0146_create_chain_watch_schedules.sql` to the target database.
2. Deploy the Worker and dashboard. The existing `DISCORD_GUILD_ID`,
   `DISCORD_BOT_TOKEN`, and `DISCORD_PUBLIC_KEY` configuration is reused.
3. Register commands with `npm run discord:commands:guild` (or the existing global
   registration workflow), supplying `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`
   and, for guild registration, `DISCORD_GUILD_ID` through the environment.
4. The bot needs View Channel, Send Messages and Embed Links in the chosen channel.
   For threads it also needs Send Messages in Threads.

The automated tests use an in-memory SQLite database and a fake Discord transport;
they do not post to the live Discord server. The SQLite adapter requires Node 22.13+
or a newer Node release with `node:sqlite` available.
