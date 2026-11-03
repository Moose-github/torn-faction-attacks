# Stock database

The main Worker and `workers/stock-market` both bind `STOCK_DB` to
`torn_stocks_db` (`731fde36-b6f4-4cdf-997a-c780bd19679e`). The 14 `stock_*`
tables hold profiles, minute prices, rollups, ingestion history, member benefit
preferences, and paper-trading accounts, positions, trades and equity history.

`DB` remains `torn_attacks_db`. Authentication, the shared Torn API-key pool,
API usage logs, action cooldowns, and stock refresh/rollup cursors in `sync_state`
remain there. Pass the original environment to API-key and logging helpers;
do not replace `env.DB` with the stock binding. Stock SQL and stock health queries
explicitly use `env.STOCK_DB`; there is no fallback to core storage.

## Development and deployment

- `npm run migrate:local` applies both database migration streams.
- `npm run migrate:stocks:local` initializes only the stock database.
- `npm run migrate:remote` applies core and stock migrations.
- `npm run deploy` applies both streams before deploying the main Worker.
- `npm run deploy:stock-worker` applies stock migrations before deploying the stock Worker.

Add future stock migrations under `stock-migrations/` and update
`schema/stocks.sql`. Historical core migrations and the old stock definitions in
`schema/current.sql` are retained; do not rename or replay historical migrations
against the stock database. The stock baseline includes all subsequent column and
index changes present at cutover. Its `IF NOT EXISTS` clauses allow recording the
baseline after an existing schema has been imported, but are not a schema upgrade
mechanism.

## Cutover and recovery

Set `STOCK_STORAGE_PAUSED` to `"true"` in both Worker configurations and deploy
both before a storage cutover. This stops stock cron jobs and returns a noncached
503 on stock HTTP routes; other application routes continue running. The pause
does not cancel requests that started earlier. The November 2026 cutover also
installed `stock_split_frozen_*` triggers on the old stock tables to reject late
writes and prevent an accidental rollback from silently writing stale data.

The old stock tables remain in the core database as a frozen recovery copy. They
are not queried by the current stock features and must not be mistaken for current
prices or account balances. Removing that copy is a separate cleanup operation.

To verify a transfer, export only the 14 tables using `wrangler d1 export` with
one `--table` argument per table and `--no-schema`. Import into an initialized
stock database while both Workers are paused. D1 exports start with
`PRAGMA defer_foreign_keys=TRUE` so dependent rows can be restored together.
Export the destination again and run:

```sh
node scripts/stock-export-manifest.mjs source.sql source-manifest.json
node scripts/stock-export-manifest.mjs destination.sql destination-manifest.json
```

All per-table SHA-256 values and statement counts should match; also check remote
table row counts and `PRAGMA foreign_key_check`. The hash comparison assumes the
D1 export retains row order; investigate any mismatch rather than proceeding.
Never apply the source freeze triggers to the destination.

Switch both `STOCK_DB` bindings to the verified destination before setting the
pause variables to `"false"` and deploying both Workers. Verify a new successful
stock ingestion run, fresh snapshots, and no new stock rows in the old database.

Once stock writes resume on the new database, changing the binding back to the
old frozen copy would lose newer history and account changes. Recovery must pause
both Workers again and reconcile or restore the latest stock data first. If
reverting before any new writes, remove the `stock_split_frozen_*` triggers from
the core database, restore both stock bindings to core, and resume both Workers.
