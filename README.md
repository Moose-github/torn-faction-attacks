# Torn Faction Attacks

A Cloudflare Worker that imports Torn faction attack data into D1 and tracks war-level summaries for faction performance.

The current project is API-first. The next planned step is to add a dashboard on top of these endpoints for viewing wars, attack activity, member stats, and long-term career totals.

## What It Does

- Pulls faction attack data from the Torn API on a schedule.
- Stores immutable attack records in Cloudflare D1.
- Tracks active, scheduled, ended, and imported wars.
- Assigns attacks to the active war window.
- Builds summary tables for:
  - war totals
  - member war stats
  - member career stats
- Exposes JSON API endpoints for testing and future dashboard use.

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
  summaries.ts    War/member/career summary rebuilds and increments
  constants.ts    API constants and faction settings
  types.ts        Worker, D1, and Torn API types
  utils.ts        Shared helpers

migrations/
  0001_create_comments_table.sql
  0002_create_torn_attack_tables.sql
  0003_rebuild_member_performance_tables.sql
```

`0001_create_comments_table.sql` is from the original Cloudflare D1 template. The app schema starts in `0002_create_torn_attack_tables.sql`, and member performance summaries are reshaped in `0003_rebuild_member_performance_tables.sql`.

## Configuration

The Worker expects:

- A D1 binding named `DB`
- A secret named `TORN_API_KEY`

Set the Torn API key with:

```bash
npx wrangler secret put TORN_API_KEY
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
- `member_career_stats`

## API Endpoints

Health check:

```http
GET /api/health
```

Manually run ingestion:

```http
POST /api/run
```

List recent attacks:

```http
GET /api/attacks?limit=50
```

Create an active or scheduled war:

```http
POST /api/wars
```

Example body:

```json
{
  "name": "example-war",
  "start_time": 1760000000,
  "faction_id": 12345,
  "war_type": "ranked"
}
```

Import a historical war:

```http
POST /api/wars/import
```

Example body:

```json
{
  "name": "old-war",
  "start_time": 1759000000,
  "finish_time": 1759086400,
  "faction_id": 12345,
  "war_type": "ranked"
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

Get a war summary:

```http
GET /api/wars/:name
```

Get attacks for a war:

```http
GET /api/wars/:name/attacks?limit=100
```

Get overall stats:

```http
GET /api/stats
```

## Scheduled Ingestion

The Worker is configured to run every 5 minutes:

```json
"triggers": {
  "crons": ["*/5 * * * *"]
}
```

During each run, the Worker:

1. Ensures sync state exists.
2. Activates any scheduled war that is due.
3. Fetches new Torn attacks with a small overlap window.
4. Inserts unseen attacks into D1.
5. Updates active war summaries when relevant attacks are imported.

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

## Dashboard Roadmap

The next planned piece is a dashboard that can sit on top of the existing API. Likely first views:

- Current active war status
- Recent attacks feed
- War list and historical imports
- Per-war member leaderboard
- Respect gained/lost summaries
- Outside hits and enemy attacks
- Career stats across ended wars

## Notes

The mutation endpoints are currently intended for testing. Before sharing the deployed Worker URL more widely, add authentication for endpoints that can trigger ingestion or mutate war state.
