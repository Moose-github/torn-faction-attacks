# Enemy Hospital Monitor Worker

Dedicated Cloudflare Worker for live enemy hospital monitoring during an active war.

The Worker uses one named Durable Object, `active-war`, as the live coordinator. It keeps only operational state: active war target, connected WebSocket clients, current member snapshots, in-memory alert dedupe, and monitor API key health. It does not store event history.

## Setup

Set the two Torn API keys as account-level Secrets Store secrets. These names are intentionally generic so other Workers can reuse the same account secrets later:

```sh
npx wrangler secrets-store secret create a65cbe2569df4bbf8723b8911a5bdc67 --name TORN_API_KEY_POOL_1 --scopes workers --remote
npx wrangler secrets-store secret create a65cbe2569df4bbf8723b8911a5bdc67 --name TORN_API_KEY_POOL_2 --scopes workers --remote
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
    "binding": "TORN_API_KEY_POOL_1",
    "store_id": "a65cbe2569df4bbf8723b8911a5bdc67",
    "secret_name": "TORN_API_KEY_POOL_1"
  },
  {
    "binding": "TORN_API_KEY_POOL_2",
    "store_id": "a65cbe2569df4bbf8723b8911a5bdc67",
    "secret_name": "TORN_API_KEY_POOL_2"
  }
]
```

For local development, use matching values in this Worker's `.dev.vars` file or create local Secrets Store secrets without `--remote`. The old `MONITOR_TORN_API_KEY_1` and `MONITOR_TORN_API_KEY_2` names are still accepted as a temporary local fallback.

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
```

Early exits are broadcast immediately. Timer decreases use a small grace threshold because they are watch signals, not immediate action signals.
