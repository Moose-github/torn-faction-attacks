# Migration Hygiene

Cloudflare D1 migrations are deployment history. Keep existing migration files in place once they may have been applied to local or remote databases; renaming or removing historical files can make Wrangler treat old changes as new migrations.

Rules for new migrations:

- Use the next unique numeric prefix after the current highest migration.
- Do not reuse a prefix, even when the migration touches a different domain.
- Update `schema/current.sql` in the same change so the canonical schema snapshot stays reviewable.
- Run `npm run schema:check` before applying or shipping migrations.

Deploying:

- `npm run deploy` (and `npm run deploy:all`) applies pending remote migrations before deploying the main worker, so new code never runs against an older schema.
- Pushing to `main` deploys the main worker through Cloudflare's Git integration. It only applies migrations if that build's deploy command is `npm run deploy`.
- Migrations that drop or delete what deployed code still uses (for example `0180_remove_matzstonks_copy_bot.sql`) must ship after the code that stops using it, including the stock and hospital monitor workers, which do not deploy on push. Push the code first and add the migration in a later change.

Known history:

- `0069_create_stock_market_tables.sql` and `0069_create_torn_api_call_log.sql` share a prefix. This is a grandfathered historical duplicate, so both files stay in place and the schema checker allows only this duplicate.
