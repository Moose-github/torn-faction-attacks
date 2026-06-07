# Torn Faction Attacks

A Cloudflare Worker and React dashboard that import Torn faction attack data into D1 and track war-level and member-level faction performance.

## What It Does

- Pulls faction attack data from the Torn API on a schedule.
- Stores immutable attack records in Cloudflare D1.
- Tracks active, scheduled, ended, and imported wars.
- Assigns attacks to the active war window.
- Builds summary tables for:
  - war totals
  - member war stats
- Exposes JSON API endpoints for the dashboard and admin controls.

## Stack

- Cloudflare Workers
- Cloudflare D1
- Wrangler
- TypeScript
- Torn API v2

## Project Structure

```text
src/
  index.ts        Worker routes and scheduled handler
  ingestion.ts    Torn API import and war assignment
  wars.ts         War creation, import, listing, and lookup APIs
  reports.ts      Torn ranked war report fetch and validation helpers
  summaries.ts    War and member summary rebuilds
  enemyScouting.ts Enemy faction member/status/travel cache helpers
  auth.ts         Torn-key session authentication and admin lookup
  sql.ts          Shared SQL column lists and action windows
  constants.ts    API constants and faction settings
  types.ts        Worker, D1, and Torn API types
  utils.ts        Shared helpers

migrations/
  0002_create_torn_attack_tables.sql
  0003_rebuild_member_performance_tables.sql
  0004_add_war_event_fields.sql
  ...
```

The app schema starts in `0002_create_torn_attack_tables.sql`; later migrations reshape member performance, add event/termed-war fields, ranked war report fields, auth tables, enemy scouting/travel fields, raw respect totals, and schema cleanup.

## Configuration

The Worker expects:

- A D1 binding named `DB`
- A secret named `TORN_API_KEY`
- Optional: a secret named `BSP_TORN_API_KEY` for BSP stat predictions
- Optional: a secret named `FFSCOUTER_API_KEY` for enemy stat estimates
- A shared secret named `MONITOR_TICKET_SECRET` for signing enemy hospital monitor WebSocket tickets

Set the Torn API key with:

```bash
npx wrangler secret put TORN_API_KEY
```

Set the BSP Torn API key with:

```bash
npx wrangler secret put BSP_TORN_API_KEY
```

Set the FFScouter key with:

```bash
npx wrangler secret put FFSCOUTER_API_KEY
```

`MONITOR_TICKET_SECRET` should be the same value used by the dedicated enemy hospital monitor Worker. Prefer Cloudflare Secrets Store for this shared secret so both Workers bind to the same account-level value:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "MONITOR_TICKET_SECRET",
    "store_id": "a65cbe2569df4bbf8723b8911a5bdc67",
    "secret_name": "MONITOR_TICKET_SECRET"
  }
]
```

The home faction is currently configured in `src/constants.ts`:

```ts
export const HOME_FACTION_ID = 8803;
```

## Database

Apply migrations locally:

```bash
npx wrangler d1 migrations apply DB --local
```

Apply migrations to the remote D1 database:

```bash
npx wrangler d1 migrations apply DB --remote
```

The main app tables are:

- `attacks`
- `wars`
- `sync_state`
- `war_summary`
- `war_member_stats`
- `enemy_faction_members`
- `home_faction_members`
- `faction_activity_heatmap`
- `admin_users`
- `auth_sessions`

## API Endpoints

Admin and debug endpoints require an app session token:

```http
Authorization: Bearer <session-token>
```

Create a session by entering a Torn key on the dashboard admin page, or by calling:

```http
POST /api/auth/torn
```

Refresh an existing browser session with:

```http
GET /api/auth/me
Authorization: Bearer <session-token>
```

The Worker checks the key with Torn's `/v2/key/info` endpoint. Admin access is granted when the key belongs to faction `8803` and either:

- its Torn user ID exists in `admin_users`
- the key has `info.access.faction = true`, which automatically adds that Torn user ID to `admin_users`

Add or remove admins with D1 SQL:

```sql
INSERT INTO admin_users (torn_user_id) VALUES (123456);
DELETE FROM admin_users WHERE torn_user_id = 123456;
```

Health check:

```http
GET /api/health
```

Manually run ingestion:

```http
POST /api/run
```

Rebuild derived stats from raw attacks:

```http
POST /api/rebuild
```

List recent attacks:

```http
GET /api/attacks?limit=50
```

Create an active or scheduled event:

```http
POST /api/wars
```

Example body:

```json
{
  "name": "example-event",
  "practical_start_time": 1760000000,
  "enemy_faction_id": 12345,
  "war_type": "event"
}
```

Official `real` and `termed` wars are created automatically while live/upcoming, or imported after they finish.

Import a historical war:

```http
POST /api/wars/import
```

Example body:

```json
{
  "name": "old-war",
  "practical_start_time": 1759000000,
  "practical_finish_time": 1759086400,
  "enemy_faction_id": 12345,
  "war_type": "real",
  "torn_war_id": 40232
}
```

Import a historical event:

```http
POST /api/wars/import-event
```

Example body:

```json
{
  "name": "training-night",
  "practical_start_time": 1759000000,
  "practical_finish_time": 1759086400,
  "enemy_faction_id": 12345
}
```

End the active war:

```http
POST /api/wars/end
```

List wars:

```http
GET /api/wars
```

Filter wars by war type:

```http
GET /api/wars?war_type=termed
```

Get a war summary:

```http
GET /api/wars/:name
```

Get cached enemy scouting for a war:

```http
GET /api/wars/:name/enemy-scouting
```

Refresh enemy scouting for a war:

```http
POST /api/wars/:name/enemy-scouting
```

Compare home and enemy scouting:

```http
GET /api/wars/:name/scouting-comparison
```

Get activity heatmap data:

```http
GET /api/wars/:name/activity-heatmap
```

Get chain bonus hits for a war:

```http
GET /api/wars/:name/chain-bonuses
```

Get attacks for a war:

```http
GET /api/wars/:name/attacks?limit=100
```

Get overall stats:

```http
GET /api/stats
```

Filter stats by war type:

```http
GET /api/stats?war_type=real
GET /api/stats?war_type=termed
GET /api/stats?war_type=event
```

## Scheduled Ingestion

The Worker uses separate cron schedules for ingestion and heatmap sampling:

```json
"triggers": {
  "crons": ["* * * * *"]
}
```

Every minute, the ingestion run:

1. Ensures sync state exists.
2. Checks Torn's latest ranked war and creates a scheduled war if the faction is enlisted in a future war.
3. Activates any scheduled war that is due.
4. Fetches new Torn attacks with a small overlap window.
5. Inserts unseen attacks into D1.
6. Updates active war summaries when relevant attacks are imported.
7. Checks active termed wars with auto-end enabled against the latest Torn ranked war score.
8. Updates live official Torn scores and fetches the active war report once Torn marks the war ended.
9. Refreshes current enemy faction member statuses for active wars, including cached scouting status and travel estimates.

Every 15 minutes, the maintenance run samples faction member activity, updates cached revivable status, fetches missing ranked war reports for ended wars, retries missing FFScouter stat estimates, and refreshes missing networth estimates.

For termed wars, the latest Torn ranked war score is stored in `wars.official_home_score` and `wars.official_enemy_score`. If `official_home_score` reaches `faction_respect_limit`, the Worker records a `practical_finish_time` and rebuilds derived stats using that practical window for Buttgrass attacks.

If the latest Torn ranked war has a future `start` time, the Worker creates a scheduled `real` war using Torn's war ID and enemy faction ID. If a different scheduled war already exists, the sync skips creating another one.

## Development

Install dependencies:

```bash
npm install
```

Run type/deploy checks:

```bash
npm run check
```

Run locally:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Dashboard

The React dashboard lives in `dashboard/` and is intended to be deployed with Cloudflare Pages. It shows recorded wars, member breakdowns, enemy status/scouting/travel panels, activity heatmaps, ranked war report validation, discrepancy drilldowns, member attack lists, and admin controls for the testing workflow.

Install dashboard dependencies:

```bash
cd dashboard
npm install
```

Run dashboard locally:

```bash
npm run dev
```

Build dashboard:

```bash
npm run build
```

Cloudflare Pages settings:

```text
Root directory: dashboard
Build command: npm run build
Build output directory: dist
```

Set this Pages environment variable so the dashboard knows where the Worker API is:

```text
VITE_API_BASE_URL=https://torn-faction-attacks.moose-3065754.workers.dev
```

## Notes

Admin and mutation endpoints require a dashboard auth session. The current admin model is intentionally lightweight while the project is still changing.

