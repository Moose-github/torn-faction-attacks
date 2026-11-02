# Cloudflare usage alerts to Discord DMs

The Worker accepts Cloudflare generic webhook POST requests at:

```text
https://torn-faction-attacks.moose-3065754.workers.dev/billing-alert
```

No custom domain or dashboard Route is required. The path is handled in
`src/index.ts`. It reuses the existing `DISCORD_BOT_TOKEN`.

Delivery uses the shared `sendDiscordDirectMessage` function. Other Worker features
can use it with their own recipient IDs; see [Discord private-message alerts](discord-direct-messages.md).
Billing alerts remain restricted to `BILLING_ALERT_DISCORD_USER_ID`.

## Configure and deploy

1. Set `BILLING_ALERT_WEBHOOK_SECRET` as a Worker secret with a randomly generated
   value (at least 32 random bytes). Set the same value in the Cloudflare webhook
   destination's **Secret** field. Never put it in the URL or source control.
2. `BILLING_ALERT_DISCORD_USER_ID` is configured in `wrangler.json` for the chosen
   recipient. To change it, enable Discord Developer Mode and use **Copy User ID**
   on the recipient's profile. The bot must be able to DM this user; allow DMs from the
   shared server and make sure the bot is not blocked.
3. From the repository root, configure the webhook secret interactively:

   ```powershell
   npx wrangler secret put BILLING_ALERT_WEBHOOK_SECRET
   ```

4. Run `npm run check:worker`, then deploy using `npx wrangler deploy`.
   This handler needs no database migration.
5. Under Cloudflare **Alerts → Destinations**, create a generic webhook with the
   URL above and the matching secret. **Save and Test** should send a real DM.
6. Select that destination in the usage notification and set its product metric
   threshold. This is a usage notification, not a dollar budget or a hard cap.

## Behavior and troubleshooting

- `200`: Discord confirmed the message.
- `401`: missing or incorrect `cf-webhook-auth` secret.
- `405`: use POST; opening the URL in a browser does not send a DM.
- `400` / `413`: invalid JSON, missing text, or a body larger than 64 KiB.
- `503`: webhook secret, Discord recipient ID, or bot token is missing/invalid.
- `502`: Discord delivery failed; check bot access, DM privacy settings and logs.

The handler accepts Cloudflare's text-only test payload and normal notification
payloads. It forwards the human-readable `text`, truncating long messages to 1900
characters and suppressing mentions. The recipient comes only from configuration.
Matching payloads use a stable Discord nonce to suppress retries within Discord's
short deduplication window; this is not permanent exactly-once delivery.

References: [Cloudflare generic webhooks](https://developers.cloudflare.com/notifications/get-started/configure-webhooks/),
[payload schema](https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/),
[Discord Create DM](https://docs.discord.com/developers/resources/user#create-dm).
