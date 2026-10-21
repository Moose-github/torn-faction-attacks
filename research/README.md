# Ranked war research

The collector and saved findings live in **Admin → War research**. Collection is a finite, explicitly started job. The existing minute scheduler advances active jobs; paused, complete and frozen jobs make no Torn requests. Each tick has a single database lease and a bounded batch. No new Cloudflare service or recurring user automation is required.

## Use

1. Opt a submitted pool key into **War research** in Settings. It is disabled by default and does not use fallback keys or keys without a known owner.
2. Create a named dataset with completed UTC days and a total request budget. Start collection or import existing API v2 reports. Requests include listing pages, reports and failures. All starting ranks must be inspected because the listing has no rank fields. Both starting ranks must be Platinum for inclusion; forfeits are excluded.
3. Pause whenever needed. Resume keeps the cursor and reuses already saved reports. An explicit larger total budget is required after exhaustion. Failures pause without discarding progress.
4. Freeze the reports already saved. Pending reports are removed from that sample. The snapshot cannot resume or change; create a new dataset for a new era or larger sample. Shared raw reports are immutable and deduplicated by war ID.
5. Download the frozen dataset. Run `research/Analyze.cmd` on Windows (or `python research/analyse_dataset.py export.json --prices prices.json`). Enter full-dollar cache prices, not millions. NumPy is required; `pip install -r research/requirements.txt` if needed.
6. Upload the generated `upload-analysis.json` into the same dataset. The admin page displays adjusted factors, uncertainty, reward summaries, assumptions and limitations. Reanalysis with different prices or assumptions does not call Torn. Previous analysis versions remain stored.

The analysis preserves the local prototype's screening gates (100 valued wars, 20 factions, model sample size/rank checks), outcome/division/roster/month controls, two-way war/faction clustered uncertainty, chronological-half checks, faction-exclusion sensitivity, and collinearity checks. It withholds adjusted estimates for the August 2026 transition or mixed eras. It reports associations, not causal effects, payout forecasts, caps or a cross-rank scaling rule. Member counts remain proxies requiring validation against known wars. A truncated chronological sample is not a random sample.

### Whole-war rewards

New analyses include two views, with **Combined war pot** selected by default. Whole-war value is the sum of both factions' gross cache values at the same prices, counted once per war. Missing prices on either side exclude the entire pot from monetary analysis; audit problems on either side exclude it from the adjusted model. The faction view remains available separately. Existing uploaded faction-only analyses still display; rerun the frozen export to add whole-war results without new Torn requests.

The whole-war model separately examines combined attacks, combined score, pooled participation, pooled within-faction top-20% attack concentration, duration, attack balance and score balance. Balance is the smaller side's share of the total (0 to 0.5). Controls are combined roster size, roster balance, winner and loser starting divisions, and month. Each war supplies one observation. Its uncertainty estimator allows wars sharing either faction to be dependent, even when factions switch winning/losing roles or meet repeatedly; it uses the [dyadic sandwich method](https://arxiv.org/abs/1312.3398) with an n/(n-p) degrees-of-freedom correction. Wider network dependence can still remain.

The display shows the combined gross value before any agreement between factions. No split calculator or expense deductions are included. The API does not disclose which wars were termed, actual agreed splits or transfers.

Test the offline aggregation and model with `python -m unittest discover -s research -p test_analysis.py`.

## Capacity

Research reserves its allowance transactionally **before** calling Torn and counts failures. It uses at most 10 attempts per rolling 60 seconds per known owner across all their keys, stops when observed dashboard use reaches 50 requests in the past 60 seconds, and leaves five calls below the selected key's configured minute allowance. Only one research batch runs at once. These controls constrain this collector; existing features and external apps do not all share an atomic owner-wide limiter. Torn's account-wide limit is shared across keys and apps, so the collector pauses on API failure and cannot guarantee capacity used elsewhere.

## Deployment and validation

Apply `migrations/0176_ranked_war_research.sql` to the Worker D1 database, deploy the Worker and build/deploy the dashboard together. This migration only adds research tables. Collection remains inactive after deployment until an administrator opts in a key and starts a run. Existing raw local reports can be imported without requesting them again.

Run `npm test -- tests/rankedResearch.test.ts src/http/adminRoutes.test.ts src/tornKeyPool.test.ts`, worker TypeScript checking, `npm --prefix dashboard run build`, and `npm run schema:check`. The tests cover budget exhaustion, failed attempts, shared owners, cursor safety, resumability, immutable snapshots, filtering and admin route protection. Use a separate fixture dataset for UI verification; do not trigger live collection during checks.

Sources: [Torn API](https://www.torn.com/api.html), [Torn API schema](https://www.torn.com/swagger/openapi.json), [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/).
