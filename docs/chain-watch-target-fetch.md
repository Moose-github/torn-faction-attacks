# Chain watch target fetch

`fetchChainWatchTargets(env)` in `src/chainWatchTargets.ts` returns available target IDs independently of Discord. The faction alarm uses it in background work after delivering each 60- or 30-second warning and scheduling the next alarm.

## Alert links

The initial warning, including its normal mentions, is sent without waiting for targets. The Durable Object retains the optional enrichment task with `waitUntil`. When targets arrive, `src/chainWatchWarningTargets.ts` randomly chooses up to two distinct IDs and edits the existing warning to add primary and backup attack buttons. Its existing text and card color are preserved, and mentions are disabled for the edit.

The 60-second lookup also saves up to 25 shuffled IDs on its warning cycle (`chain_watch_warning_cycles.target_ids`), the first two being the ones shown on that card. The 30-second critical then posts with attack buttons already attached, preferring IDs the warning did not show in case those attacks were lost, and runs no second lookup. Reuse is safe because a successful hit on any of those targets would have reset the timer and prevented the critical. The cache is only used for the same timer, chain length and unresolved cycle. Without it (no targets, a muted or skipped 60-second warning, a lookup still running, or an unreadable value), the critical posts without buttons and falls back to the background lookup and edit.

The lookup runs outside the warning cycle's cleanup lease. Before fetching, and again under that lease before editing, the task verifies the timer version, chain count, message/channel identity, expiry and unresolved outcome. A 60-second warning is also skipped once a critical warning has superseded it. Stored saving attacks are checked even if the live monitor state has not caught up yet. A busy cleanup lease causes the optional edit to be skipped rather than delaying cleanup.

After releasing the edit lease, the task runs cleanup against fresh state so a save or drop during the Discord PATCH becomes the final summary. Cleanup replaces all components, removing the target buttons. No targets, lookup failures or deleted messages leave the original alert alone; target work never posts a replacement or fails the alarm. This is best-effort background work, not a durable delivery queue.

## Direct requests

Members can request a fresh lookup with `POST /api/chain-watch/targets` (no body), using the normal dashboard session. Responses are not cached. The endpoint has a shared 20-second action cooldown to limit requests; the underlying API calls also consume the selected keys' Enemy scouting usage allowance.

The lookup uses **only keys enabled for Enemy scouting**, without environment-key fallback. It randomly samples two different page positions from `src/chainWatchTargetCursors.ts`, fetches them concurrently, and returns all distinct viable IDs. If none qualify, it tries unused page positions, up to three batches / six searches, within a twelve-second search budget and a five-second timeout per page. Partial batch success is usable. Exhausted keys, unavailable pages and timeouts return an explicit status rather than fabricated targets. Authentication/rate-limited keys are paused through the existing key pool.

Example response:

```json
{
  "ok": true,
  "target_ids": [123456, 234567],
  "status": "ok",
  "pages_fetched": 2,
  "failed_pages": 0,
  "checked_at": 1792908000
}
```

`pages_fetched` counts attempted page requests. `no_targets` is HTTP 200 with an empty ID array; `unavailable` is 503 and `timeout` is 504. The endpoint returns 429 during its cooldown.

Availability filtering rejects hospital (icon 15), jail (16), federal jail (70), and travel/abroad/hiding out (71), confirmed against Torn's live search responses. Status titles also catch these states and Fallen/resting-in-peace. Malformed players or missing icon arrays are excluded. Other icon descriptions are not searched because they contain player and faction names. There is deliberately no own-faction, blocklist, activity-status, FF or BSP filter. These are suggested attackable targets based on the returned snapshot, not guaranteed easy wins.

Searches use `lastActionYearAgo,level:=:1,offences:=:0,notInHospital`: only level-1 players. The bundled 200 page positions were collected on 2026-10-25 with this filter, taking 100 pages from the front (`ASC`) and 100 from the back (`DESC`) at no more than 20 requests per minute. Each position stores its sort direction alongside its cursor and must be reused with that direction. Each direction includes its first page's null cursor, giving 198 pagination tokens and two first-page positions. Results can move as players' names/statuses change; deduplicate each response and periodically recollect the cursors if they become unproductive. The source capture lives in the local output file `chain-target-search-cursors-level1-both-20261025-215532.json`; deployment uses the bundled TypeScript data, not that ignored output directory. No API key is stored with the cursor data.
