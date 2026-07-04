# Enemy Hospital Monitor Worker

Dedicated Cloudflare Worker for live enemy hospital monitoring during an active war.

The Worker uses one named Durable Object, `active-war`, as the live coordinator. It keeps only operational state: active war target, connected WebSocket clients, current member snapshots, in-memory alert dedupe, and monitor API key health. It does not store event history.

## Setup

Hospital Monitor reads submitted keys from the shared D1-backed Torn key pool. Users should submit their own keys through the main app settings page and opt in to Hospital Monitor use.

Keep one admin/fallback Torn API key as an account-level Secrets Store secret:

```sh
npx wrangler secrets-store secret create a65cbe2569df4bbf8723b8911a5bdc67 --name TORN_API_KEY --scopes workers --remote
npx wrangler secrets-store secret create a65cbe2569df4bbf8723b8911a5bdc67 --name TORN_KEY_STORAGE_SECRET --scopes workers --remote
```

Set the shared monitor ticket signing secret. Prefer Cloudflare Secrets Store and bind the same account-level secret to both this Worker and the main app Worker:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "MONITOR_TICKET_SECRET",
    "store_id": "a65cbe2569df4bbf8723b8911a5bdc67",
    "secret_name": "MONITOR_TICKET_SECRET"
  },
  {
    "binding": "TORN_API_KEY",
    "store_id": "a65cbe2569df4bbf8723b8911a5bdc67",
    "secret_name": "TORN_API_KEY"
  },
  {
    "binding": "TORN_KEY_STORAGE_SECRET",
    "store_id": "a65cbe2569df4bbf8723b8911a5bdc67",
    "secret_name": "TORN_KEY_STORAGE_SECRET"
  }
]
```

For local development, use matching values in this Worker's `.dev.vars` file or create local Secrets Store secrets without `--remote`. The retired `TORN_API_KEY_POOL_1` and `TORN_API_KEY_POOL_2` secrets are no longer used; existing raw pool keys should be submitted by their users through the main app instead of migrated manually.

The monitor fails closed when `MONITOR_TICKET_SECRET` is missing. The main app mints short-lived member tickets, and this Worker verifies the ticket before opening `/ws`.

## Commands

```sh
npm run types
npm run check
npm run dev
npm run deploy
```

## WebSocket

The War Room panel should open the socket only when the panel is expanded:

```txt
/ws?warId=123&warName=Enemy&enemyFactionId=51794&tornWarId=456&ticket=...
```

The first successful poll is baseline-only. Later polls emit page-only visual events:

```txt
hospital_exit_early
hospital_exit_expected_online
hospital_timer_decreased
hospital_exit_expected_offline
travel_return_expected_online
travel_return_expected_offline
```

Early exits are broadcast immediately. Timer decreases use a small grace threshold because they are watch signals, not immediate action signals. Travel returns emit only expected online/offline watch alerts; travel has no early-reduction alert path.
