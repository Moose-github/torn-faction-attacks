# Company recruitment

The Recruitment page under Miscellaneous matches Torn's daily active-player snapshot against a saved work-stat HOF database. Members can search results. Administrators can refresh candidates directly from Torn and start, pause or resume HOF scans.

Apply `0210_create_recruitment.sql` before deploying the worker and dashboard. No initial scan or candidate refresh is performed by deployment.

## Scanning

Start HOF scan begins at offset zero and saves players with at least 100,000 total work stats, including players currently inactive. A full page ending exactly at the cutoff is followed by another page so tied totals are retained. Completion occurs below the cutoff or at the end of the leaderboard. The approximate 200,526 positions / 2,006 calls shown in the UI is an estimate, not a hardcoded stopping point.

The minute scheduler advances only manually started scans. Closing the page does not stop the scan. Pausing stops new reservations; an in-flight request can still save its page. Resume continues from the last committed offset, including after failures. A completed scan can be refreshed manually from the beginning. Existing cache rows remain available during refresh.

Recruitment uses all active submitted pool keys, regardless of other feature opt-ins, as requested for this tool. The environment fallback is never read. Keys labelled Fallback or Fallback key (case-insensitive, ignoring surrounding whitespace) are also excluded. Disabled, cooling or undecryptable keys cannot send requests.

Each API attempt is reserved transactionally before sending, with a ceiling of 10 per key in a rolling 60-second window. Failed requests count too, and starting/resuming does not reset reservations. Existing per-key pool budgets are respected, with a conservative owner ceiling of 90 reservations across the current and previous minute. Other tools and external use of the same keys can reduce achievable throughput. Key failures cool the key; owner rate errors cool all its keys. Transient failures back off, and five failures or an invalid page stop the scan for manual resume.

The scan uses a database lease to prevent overlapping cron workers. Each page's cache upserts and checkpoint advance commit together. Expired workers cannot commit after another worker claims the lease. API keys and API pagination URLs are never stored in recruitment tables or returned to the browser. Row counts shown for a scan count qualifying records processed; rank movement during a scan can revisit players, whose cache rows are upserted by ID.

## Snapshots and candidates

Refresh candidates fetches today's snapshot directly from the official [`GET /v2/user/snapshot`](https://www.torn.com/swagger.php#/User/getUsersSnapshot) endpoint using a pooled key, then matches it against saved work stats. There is no file upload or date picker. Each refresh makes one API request and shares the HOF scanner's 10-per-key rolling budget, pool limits and Fallback exclusion. A shared two-minute refresh guard prevents overlapping requests. Refreshing candidates does not start or alter the HOF scan.

Responses are limited to 20 MB / 250,000 players, validated completely and staged before switching the current snapshot. Failed or incomplete refreshes preserve existing candidates. Superseded snapshots older than 24 hours are cleaned up after a successful refresh. Scan attempts are retained for 24 hours during scanning; scan totals remain on the scan record.

Only unemployed players and the six city jobs are retained for matching; company employees/directors and nonzero federal-jail flags are excluded. Counts reflect those exclusions. Snapshot presence provides activity eligibility as of that snapshot, not a live last-action timestamp. Candidate names and jobs come from the snapshot; work-stat totals, HOF positions and check times come from the cache.

Unmatched IDs are explicitly unknown, not assumed to be under the cutoff. Default results show saved stats with a minimum of 100,000; filters can also show unknowns. Searches, status polling and matching make no Torn calls. Both HOF scans and candidate refreshes are manual. This feature does not interact with Torn's website, contact players or change anything in-game.

## Verification

`npx vitest run tests/recruitment.test.ts` exercises SQLite transactions, shared rolling key limits, Fallback exclusion, pause/resume, lease fencing, errors, cutoff ties, direct snapshot refresh, concurrent refresh protection, response validation and local candidate matching. Torn requests are mocked.
