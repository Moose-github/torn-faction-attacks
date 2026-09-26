# Faction armory V1 implementation plan

Status: V1 implemented locally. Scope: weapons only. See [operation and deployment notes](faction-armory.md).

## Outcome and navigation

Add **Faction armory** to the existing **Admin** sidebar group, after Stock market and before Admin controls. Use a Lucide weapon/shield icon consistent with existing navigation. The page title is **Faction armory**, with **Weapons** as its scope label.

- Route: `/admin/armory`; AppView: `factionArmory`.
- Include the view in `isAdminOnlyView` and the sidebar's `adminActive` condition so direct navigation is guarded and the Admin group opens automatically.
- Lazy-load the page through the existing App component.
- Protect every armory backend endpoint with `withAdmin`; sidebar visibility alone is insufficient.
- Use the existing dashboard panels, typography, theme and table conventions.

## Page and interactions

The header shows the inventory snapshot time in TCT/UTC, its age, last successful check, a Refresh inventory button, and detail-loading progress such as “218 of 231 weapon details loaded”. Distinguish the upstream snapshot time from when this application checked it.

Summary cards show total weapons, available weapons, loaned weapons and unique borrowers. An additional compact count shows confirmed bonus weapons and pending details. Inventory totals remain usable while detail enrichment is incomplete; bonus totals are labelled partial until complete.

Provide Weapons and Borrowers views over the same saved inventory, without additional Torn requests when switching views.

### Weapons view

- Search by weapon name, UID, borrower name or borrower ID.
- Filters: Primary / Secondary / Melee; All / Available / Loaned; All / Standard / Special / Details pending; rarity; bonus title.
- Default order: weapon name, then separate special copies and the standard group for that model. Use UID as a stable tie-breaker.
- Columns: image and weapon name, rarity and bonuses, damage, accuracy, quality, quantity, available/loaned status or counts, borrower.
- Each special weapon has a separate row keyed by UID, even when another weapon has identical bonuses and stats.
- Standard weapons can have an expandable summary row per model ID. Show quantity, available count and loaned count; show stat ranges on the summary, never one copy's stats as though they apply to the group. Expanded rows expose each UID, its stats and borrower.
- Pending/unresolved details stay in individual rows and are never included in confirmed standard groups.
- Bonus labels include title and value; full descriptions are available on click/focus as well as hover. Render all bonuses, not just the first.
- Borrower names link to Torn profiles; UIDs can be copied.
- Apply filters to individual copies before grouping; label visible results separately from the full-inventory summary cards.
- Allow sorting individual copies by damage, accuracy or quality using a “Show individual copies” toggle. Missing stats sort last. Grouped mode sorts by name or inventory counts.
- Export filtered results as CSV, one row per UID, including borrower, stats, rarity and every bonus. Escape CSV cells safely, including spreadsheet formula prefixes.

### Borrowers view

One row per current borrower, with name/ID, total loans and Primary / Secondary / Melee counts. Expand to see individual weapons, images, UIDs, stats and bonuses. Identify special weapons using the same classification as the Weapons view. V1 lists borrowers present in inventory, not members with zero loans.

### Item artwork

Build image URLs from the model ID, for example `https://www.torn.com/images/items/399/large.png`, with `large@2x.png` as a 2x source. All copies of a model use the same artwork.

Implement local CSS glows from the individual item's API rarity: yellow, orange and red. Standard groups have no glow. Use a text rarity badge as well as colour; unknown rarity values get a neutral labelled style. Do not copy Torn's CSS class names expecting their styles to exist in this app. Use fixed image dimensions, lazy loading, meaningful alt text and an error fallback. Images never require extra item-detail API requests. Check loading from the actual dashboard origin during browser QA.

## Data identity and grouping

1. Fetch `GET /v2/faction/inventory?cat=weapons`.
2. Expand every `uids` array into individual inventory records. Each copy inherits the row's model ID, name, slot type and borrower. Preserve the source rows for validation.
3. Fetch `GET /v2/torn/{comma-separated-uids}/itemdetails` for uncached or retry-eligible UIDs, at most 25 per request.
4. Normalize either an object or an array under `itemdetails` to an array. Join by returned `uid`, never array position. Retain inventory slot type (`Primary`, `Secondary`, `Melee`) separately from detail type (`Weapon`) and subtype (`Rifle`, etc.).
5. Classify successfully validated details:
   - Non-empty bonuses: special, always individual.
   - Empty bonuses and null rarity: standard, eligible for model grouping.
   - Non-null rarity with empty bonuses: keep individual and identify by rarity.
   - Missing/malformed details or missing classification fields: pending/unresolved, never standard.

Inventory determines current ownership and loans; item details determine stats, bonuses and rarity. A singleton inventory block does not establish rarity. Borrower changes do not invalidate cached item details.

Store UIDs as decimal strings in application DTOs and D1 TEXT keys; avoid 32-bit coercion. Validate numeric input as safe integers before conversion. Preserve unknown bonus and rarity values for display rather than silently discarding them.

Validate duplicate UIDs, conflicting borrowers, UID/model mismatches and `amount` versus UID count. Compute normal inventory totals from `amount` and reconcile with unique copies. Reject structurally inconsistent snapshots without replacing the last valid snapshot; show a data issue instead of inventing missing copies or double-counting them. A valid empty inventory is allowed and distinct from a failed request.

## Persistent cache and refresh policy

Use shared server-side D1 storage so reloads, sessions and other admins reuse the same details.

Proposed tables:

| Table | Purpose |
| --- | --- |
| `faction_armory_state` | Faction/category, inventory timestamp, last success/check/attempt, next eligible refresh, active snapshot version, sync lease and error status |
| `faction_armory_inventory` | Current snapshot copies keyed by faction/category/UID, model/name/slot type and nullable borrower ID/name |
| `armory_weapon_details` | UID-keyed model/name/type/subtype, damage/accuracy/quality, rarity, full bonus JSON, fetch timestamp and payload version |
| `armory_detail_fetch_state` | UID retry count, retry-after time, error category and optional manual-refetch flag |

Use the next unused migration number at implementation time and update `schema/current.sql` in the same change, following `migrations/README.md`.

- Initial page load reads the saved inventory immediately, then requests a sync if missing or eligible. With 231 distinct uncached UIDs, enrichment needs 10 detail calls plus one inventory call.
- Normal page load/focus checks the backend state. Fetch upstream inventory at most once per hour during normal use; reuse a successful snapshot within that interval. While visible, check eligibility when that interval expires. No new periodic background cron is needed for V1.
- Refresh inventory rechecks when eligible and otherwise shows the next check time. It must not suggest it bypasses Torn's one-hour inventory cache.
- Unchanged inventory and complete details: zero detail calls. Newly seen UIDs: fetch only those. Retry missing results separately, without refetching successful results from the same batch.
- Persist successful details without routine time-based expiry in V1. Retain them when weapons leave the inventory so a returning UID is reused.
- A secondary “Refresh weapon details” action explicitly schedules a bounded refetch of current UIDs. Retain previous valid details until replacements succeed, display progress, and deduplicate repeated requests.
- Inventory replacement and snapshot timestamp updates are atomic after full validation. Older or late responses cannot overwrite a newer snapshot. Failed fetches preserve previous data.
- Use a D1 conditional lease with expiry to prevent concurrent admins/Worker instances duplicating the same sync or detail batch. An expired/interrupted sync is resumable.
- Enrich in bounded batches with at most two concurrent upstream requests and a maximum of four batches per backend sync request. Return progress and resume through subsequent sync requests while the page is open. This avoids depending on one long Worker request; completed batches persist even if the user leaves.
- Retry transient failures with persisted exponential backoff (start at 1 minute, cap at 1 hour). Respect upstream rate-limit signals. Stop immediate retries for key/access failures and show an actionable error. Missing returned UIDs remain pending and receive backoff too.

## Backend and frontend integration

Proposed admin endpoints:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/admin/armory` | Read current saved inventory joined to cached details, counts, freshness and sync status; no upstream calls |
| `POST /api/admin/armory/sync` | Fetch eligible inventory and process a bounded set of missing/retry-eligible detail batches; return progress and next eligible action |
| `POST /api/admin/armory/details/refresh` | Schedule a deduplicated refresh of details for current inventory UIDs; subsequent sync calls process it |

On page load, fetch the saved view and request sync if needed. During enrichment, continue bounded sync calls only when permitted by returned progress/retry timing, rereading the joined inventory after completed work. Stop continuation requests when the page unmounts or is hidden; check again on focus. Reads must not serve a stale HTTP cache after a successful sync.

Use the existing Worker secret `TORN_API_KEY`, subject to confirming it has home-faction inventory access. Send credentials only in the Authorization header. Do not embed the key shared in conversation in source, fixtures, plans or browser requests. Use `fetchTrackedTornJson` in `src/external/torn.ts` with armory-specific usage labels and its existing upstream error handling. Account for Torn API errors inside HTTP 200 responses.

Expected implementation files:

- `src/armory.ts` and focused helpers as needed: inventory validation, grouping input, D1 storage and sync orchestration.
- `src/http/adminRoutes.ts`: register the three routes using `withAdmin`.
- New migration and `schema/current.sql`: durable inventory/detail cache and sync state.
- `dashboard/src/api/armory.ts`: typed API calls using the existing authenticated client.
- `dashboard/src/views/FactionArmory.tsx` and a scoped stylesheet: page, filters, tables and loading/error states.
- `dashboard/src/utils/armory.ts`: pure classification, filtering, grouping and export helpers.
- `dashboard/src/routes.ts`, `dashboard/src/app/App.tsx`, `dashboard/src/components/Sidebar.tsx`: route, admin guard, lazy render and Admin navigation link.

## Delivery sequence and acceptance

1. Add schema, validation, detail normalization and classification with fixtures based on the supplied responses.
2. Add shared cache, tracked Torn requests, sync lease/backoff and admin endpoints.
3. Add the page, standard grouping, individual special rows, borrowers view, images/glows and CSV.
4. Wire `/admin/armory` into Admin navigation and direct-route protection.
5. Run targeted tests, schema validation and Worker/dashboard checks, then browser QA at desktop and mobile widths.

Required checks:

- The sample's AK-47 UID `15757130220` remains individual: yellow, Weaken 22%, damage 62.97, accuracy 56.56, quality 115.29%.
- ArmaLite UID `10727704270` remains individual: yellow, Achilles 52%, damage 74.81, accuracy 61.03, quality 108.35%, loaned to Daz69 in the supplied inventory.
- ArmaLite UIDs `7443497174` and `8077945671` are standard copies with distinct stats and loan status. The latter is loaned to Boptyn in the sample.
- Changing response order never changes which UID receives a bonus. Both singleton-object and array detail responses work; multiple bonuses survive intact.
- Totals from the supplied inventory reconcile to 231 weapons, 191 available, 40 loaned and 20 borrowers; details pending do not change these totals.
- A warm-cache refresh makes zero detail calls; one new UID needs one detail batch; borrower-only changes need no detail requests; returning cached UIDs need none.
- Simultaneous admins do not duplicate work; partial batches, omitted UIDs, throttling and interrupted syncs resume without discarding successful data.
- Bad or older inventory responses retain the last valid snapshot; a legitimate empty inventory clears current stock but retains the detail cache.
- Non-admin users cannot see the link or read/sync/refetch through direct API access.
- Browser QA covers standard groups, special rows, pending/error/empty states, mobile overflow, keyboard expansion, image fallback, rarity text and Admin active/open state.
- Run relevant Vitest tests, `npm run schema:check`, `npm run check:worker` and `npm run check:dashboard`. No live API credentials in test fixtures.

## Outside V1

Armor and other inventory categories; lending/recalling in Torn; reservations and requests; notifications; valuations; member loadout recommendations; historical loan dates and loan duration. Current snapshot changes do not establish the actual time a loan began. Deployment and remote migration application are a separate implementation step, not part of this planning change.

## API references

- [Torn API schema](https://www.torn.com/swagger/openapi.json): item-detail batches accept up to 25 UIDs; singleton object responses are deprecated in favour of arrays, with array-only responses documented for 1 January 2027.
- [Torn API announcement](https://www.torn.com/forums.php?a=0rh%3D37&b=0&f=63&p=threads&start=360&t=16401584): faction inventory cache and individual UID details.
- Verified during planning: the three-UID request returned out of order, with two standard ArmaLites and one yellow Achilles ArmaLite. Standard and 2x Torn item image URLs returned PNGs successfully.
