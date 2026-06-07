# Migration Hygiene

Cloudflare D1 migrations are deployment history. Keep existing migration files in place once they may have been applied to local or remote databases; renaming or removing historical files can make Wrangler treat old changes as new migrations.

Rules for new migrations:

- Use the next unique numeric prefix after the current highest migration.
- Do not reuse a prefix, even when the migration touches a different domain.
- Update `schema/current.sql` in the same change so the canonical schema snapshot stays reviewable.
- Run `npm run schema:check` before applying or shipping migrations.

Known history:

- `0069_create_stock_market_tables.sql` and `0069_create_torn_api_call_log.sql` share a prefix. This is a grandfathered historical duplicate, so both files stay in place and the schema checker allows only this duplicate.
