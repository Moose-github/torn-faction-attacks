# Faction armory

V1 is available to admins at `/admin/armory`, under **Admin → Faction armory**. It covers weapons only and uses the existing home-faction setting and server Torn key.

## Deployment

Apply migration `0164_create_faction_armory.sql` before deploying the Worker. It adds four armory tables; it does not modify existing faction data. Deploy the Worker and dashboard together. Use Wrangler's migration list to check whether the target database still needs this migration.

The existing `TORN_API_KEY` binding must have Limited access and the home faction's API permissions. Both plain secret strings and Cloudflare Secrets Store bindings are supported. Credentials stay in the Worker. The sample key from the planning conversation is not part of the implementation.

## Inventory and detail refresh

The first page visit follows inventory `_metadata.links.next` until `_metadata.total` rows have been collected, then fills a shared D1 cache in batches of up to 25 UIDs. Torn can supply next links after the last page, including on empty pages, so reaching the total ends pagination. Totals count inventory rows, not individual weapon UIDs. All pages must agree on snapshot timestamp and total, and the combined rows are validated before replacing saved inventory. A failed or incomplete page leaves the previous inventory intact. Each sync processes at most four sequential detail batches; the visible page continues until complete. Progress survives leaving the page or restarting the Worker. No armory cron was added.

Inventory is fetched at most once per hour in normal use. The timestamp on the page is Torn's snapshot timestamp, while “Last checked” is the application's latest successful inventory fetch. The refresh button respects the hourly cache. Page reads every 30 seconds fetch saved D1 state, not Torn, unless sync is due.

Partial snapshots saved by the original single-page implementation are detected from their saved pagination metadata and scheduled for a full refresh without waiting for the hourly interval. Error and rate-limit backoff still apply. Detail cache entries are retained and reused across the full inventory.

Successful details persist by UID without routine expiry. Borrower changes use inventory alone. Departing copies disappear from the current view but retain cached details. Returning copies reuse those details. Manual detail refresh has a one-hour cooldown and keeps old valid details visible while replacements load. Failed or missing records have exponential retry backoff. Rate-limit and permission failures pause work on the key.

A database lease deduplicates requests across admins. Inventory replacement is transactional, invalid/older snapshots preserve previous data, and expired lease holders cannot overwrite a newer owner's results. Detail responses are joined by UID regardless of response order. Both singleton-object and array responses are supported.

## Display

Bonus weapons and any weapon with non-null rarity always remain individual. Only confirmed standard copies share a model group. Pending details are separate; no bonus status is inferred from inventory blocks. Group summaries show stat ranges. Individual-copy mode supports descending damage, accuracy and quality sorting.

Filters apply to copies before grouping; summary cards remain full-inventory totals. The Borrowers tab uses the same data and includes only borrowers represented in inventory. CSV exports the filtered view as individual copies, with all bonuses and spreadsheet formula protection.

Torn artwork is requested directly by model ID. Local CSS adds the UID's rarity glow; a textual rarity label accompanies it. Broken artwork falls back to a weapon icon. Images require no additional item-detail calls.

## Verification

- `tests/armory.test.ts`: real SQLite runs the migration and production queries; tests cover sample totals, singleton/array responses, out-of-order UIDs, cache reuse, changed borrowers, new/returning copies, malformed snapshots, partial responses, bounded batches, concurrent and expired leases, manual refresh, credential bindings, backoff and admin API access.
- `dashboard/src/utils/armory.test.ts`: classification, filtering before grouping, stat sorting and safe CSV export.
- `dashboard/src/routes.test.ts`: admin-only route and existing route round trips.
- `npm run schema:check`, `npm run check:worker`, `npm run check:dashboard`.
- Browser QA uses local mocked API responses, without live faction writes. It checks navigation, images, glows, expansion, search, borrower view, mobile containment, error retention and display states. Live server credentials are validated on the first deployed sync.

The SQLite integration tests use Node's built-in `node:sqlite` (Node 22.13+; verified with Node 26).
