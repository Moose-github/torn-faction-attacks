# Discord alert mentions

In **Admin controls → Discord**, use **Edit mentions** beside an alert to select
up to 20 server roles and independently enable `@everyone` or `@here`. Save applies
the selection to that alert; Cancel discards the draft. Clear the checkboxes and
save to remove its role and broadcast mentions. **Refresh roles** reloads role
names and saved settings from the server.

Roles are loaded from the configured faction Discord server using the bot token.
The server validates role IDs again on save. Both the read and update endpoints
require dashboard admin access. Existing administrator user mentions, personal
subscriptions and automatically appended chain watchers are preserved. There are
no broadcast mentions enabled by default. Route test messages do not ping these
mentions.

Settings apply to chain status, warning, critical and drop messages, the
retaliation board, both travel trackers, enemy push and scouting reports, the
Xanax reminder, termed war auto-end notices, and shoplifting alerts. Persistent
messages keep their existing edit behaviour: new posts can notify, edits do not
send fresh notifications. A changed setting appears when the next message is
sent or updated. The missed check-in alert can be configured in advance; its
reminder, confirmation and escalation sender are still not implemented.

The bot must have permission to mention the selected roles/groups in the target
channel. Discord uses `allowed_mentions.parse: ["everyone"]` for both broadcast
types, with the selected `@everyone` and/or `@here` text placed in message content.
Explicit user and role ID lists remain in place, including for embeds and image
attachments. See [Discord's message documentation](https://docs.discord.com/developers/resources/message#allowed-mentions-object).

Apply migration `0149_add_discord_broadcast_mentions.sql` before deploying the
Worker. It extends `discord_admin_alert_subscriptions` with `everyone` and `here`
subscription types while preserving existing IDs, enabled flags and timestamps.
Saving replaces only the chosen alert's role/broadcast rows in an atomic batch.
