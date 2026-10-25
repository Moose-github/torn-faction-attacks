# Chain watch target fetch

`fetchChainWatchTargets(env)` in `src/chainWatchTargets.ts` returns available target IDs independently of Discord. Nothing calls it from the chain messages or scheduled jobs yet.

Members can request a fresh lookup with `POST /api/chain-watch/targets` (no body), using the normal dashboard session. Responses are not cached. The endpoint has a shared 20-second action cooldown to limit requests; the underlying API calls also consume the selected keys' Enemy scouting usage allowance.

The lookup uses **only keys enabled for Enemy scouting**, without environment-key fallback. It randomly samples two different page positions from `src/chainWatchTargetCursors.ts`, fetches them concurrently, and returns all distinct viable IDs. If none qualify, it tries unused page positions, up to three batches / six searches, within a five-second search budget and a two-second timeout per page. Partial batch success is usable. Exhausted keys, unavailable pages and timeouts return an explicit status rather than fabricated targets. Authentication/rate-limited keys are paused through the existing key pool.

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

The bundled page positions were collected on 2026-10-25 using `lastActionYearAgo,level:>:5,offences:=:0,notInHospital`, sorted `ASC`: 91 pages, including the first page's null cursor. Preserve those filters and sorting when reusing the tokens. Results can move as players' names/statuses change; deduplicate each response and periodically recollect the cursors if they become unproductive. The source capture lives in the local output file `chain-target-search-cursors-20261025-064304.json`; deployment uses the bundled TypeScript data, not that ignored output directory. No API key is stored with the cursor data.
