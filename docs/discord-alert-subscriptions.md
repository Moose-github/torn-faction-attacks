# Member alert subscriptions

In **Admin controls → Discord**, each alert has an **Allow subscriptions** toggle
and a count of saved subscribers. The default fallback route has no toggle.

Turning it on lists the alert in member **Settings → Discord notifications**,
`/alerts manage`, and `/alerts list`. Members opt in individually and need a
linked Discord account. Turning it off hides the option and pauses personal
subscriber mentions. Saved choices are retained and resume if it is enabled
again. The subscriber count includes these paused choices.

This setting is independent of whether the alert is sent, its destination, its
administrator role/group/user mentions, and assigned Chain Watch watchers.
Persistent boards retain their existing behaviour: new posts can notify, edits
do not send fresh notifications. Allowing subscriptions does not create new
senders or change alert triggers.

Changes appear when member settings reload or `/alerts manage` is opened again.
The server validates availability on every save. Discord Submit buttons include
the available options and stable catalog positions; stale or legacy buttons
refresh the menu for review without overwriting saved choices. If all alerts
are unavailable, Discord shows an explanation with no dropdown.

`GET /api/admin/discord-alerts/subscriptions` returns availability and subscriber
counts. `POST` accepts `{ "alert_key": "enemy_push", "subscribable": true }`.
Both require dashboard admin access. Member reads, writes, and outgoing mentions
use the same stored availability. No slash-command re-registration is required.

Apply migration `0150_add_discord_subscription_settings.sql` before deploying
the Worker. It adds an override table without changing existing member choices.
Missing overrides use the existing defaults from `DISCORD_ALERTS`. Keep that
catalog append-only so Discord selections retain stable identities.
