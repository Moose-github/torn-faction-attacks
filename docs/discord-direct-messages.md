# Discord private-message alerts

Worker features can send an alert to a chosen Discord user through
`sendDiscordDirectMessage` in `src/discord.ts`:

```ts
import { sendDiscordDirectMessage } from "./discord";

const messageId = await sendDiscordDirectMessage(env, discordUserId, "Your alert message", {
  nonce: `chain-warning:${eventId}`,
});
```

Only the existing `DISCORD_BOT_TOKEN` is required. The caller supplies the recipient's
Discord user ID, selects which events should notify that user, and handles failures.
The bot must be able to DM the recipient. A Torn player ID or Discord display name
cannot be used in place of the Discord user ID.

Messages must contain non-whitespace text and be at most 1900 characters. Mentions
are suppressed. Optional `embeds`, `embedColor`, `cardColor`, and card `actionRows`
use the same formatting as channel messages. Each Discord request defaults to an
8-second timeout, overridable with `timeoutMs`.

The function returns the confirmed message ID or throws. Discord HTTP errors retain
their `ExternalApiError.status`, allowing callers to distinguish blocked delivery,
rate limiting, and server errors. It does not queue or automatically retry messages.

Supply a stable, feature-specific `nonce` for retries of the same event, and a new one
for each new event. The helper scopes it to the recipient, so the same event can be
sent to multiple users without sharing a retry identifier. This uses the existing
short-window Discord duplicate protection, not permanent deduplication.

This is an internal sending function. Features still need to choose their recipients
and triggers; there is no new public messaging endpoint or subscription UI.

Cloudflare billing alerts use this function but always obtain their recipient from
`BILLING_ALERT_DISCORD_USER_ID`. Incoming billing payloads cannot change it. See
[billing alert setup](billing-alerts.md).
