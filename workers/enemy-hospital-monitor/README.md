# Enemy Hospital Monitor Worker

Dedicated Cloudflare Worker for live enemy hospital monitoring during an active war.

The Worker uses one named Durable Object, `active-war`, as the live coordinator. It keeps only operational state: active war target, connected WebSocket clients, current member snapshots, in-memory alert dedupe, and monitor API key health. It does not store event history.

## Setup

Set the two monitor Torn API keys as Worker secrets:

```sh
npx wrangler secret put MONITOR_TORN_API_KEY_1 --config wrangler.jsonc
npx wrangler secret put MONITOR_TORN_API_KEY_2 --config wrangler.jsonc
```

Optional, for signed WebSocket tickets:

```sh
npx wrangler secret put MONITOR_TICKET_SECRET --config wrangler.jsonc
```

If `MONITOR_TICKET_SECRET` is unset, `/ws` accepts connections without a ticket. That is useful during early local testing only; production should set the secret and have the main app mint short-lived member tickets.

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
