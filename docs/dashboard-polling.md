# Dashboard polling

`dashboard/src/utils/polling.ts` owns request scheduling and lifecycle. `startPolling` runs one task at a time, schedules the next interval after that task settles, and skips missed ticks. Tasks may return a different delay for server-directed scheduling or `false` to stop automatic refreshes. An interval of `null` allows an initial load and manual refreshes without a timer.

Use the task's `signal` for GET requests and `isCurrent()` before accepting results, including errors. `stop()` aborts the active request and removes timers/listeners. Ordinary refresh triggers share the current work; `invalidate()` discards it and queues one fresh request after it settles. This distinction matters after a mutation. Cancellation is not a visible request failure.

Visibility and focus behavior are explicit options. Existing features retain their own cadence and activation policy. Armory also disables its initial load while hidden. No automatic immediate retries are added; normal polling or the feature's returned retry delay governs retries.

## Resource ownership

`usePollingResource` adds React state, last-success time, manual refresh, and mutation-safe `setData` to the scheduler. Keys must identify the resource and all response-changing parameters. Changing a key hides the previous data immediately. `setData` invalidates older reads without an extra request; `invalidate` requires a fresh read. Presentation components decide whether an error should retain or hide the last successful response.

The hook owns local state. Sharing requires an explicit common owner, rather than a global cache of every GET:

- `ChainWatchLiveProvider` wraps the authenticated dashboard and supplies both the sidebar and live panel with one 15-second resource. It is remounted when the user or access level changes and removed on sign-out. Schedule changes and manual refresh invalidate it. Historical schedules and war-specific Chain Watch remain separate resources.
- `useWarRoomTracking` owns scouting/comparison refreshes and separates 30-second live values from five-minute history. History responses supply history arrays; they cannot replace live values or settings owned by the faster resource. Last successful history remains available when a history refresh fails. Phase revisions form part of the key.
- `useWarRoomHeatmaps` keys by war, phase, and selected members, and only loads open panels. `useWarChainWatch` uses the war-specific endpoint and live phase policy.
- `useArmoryPolling` owns the inventory read/sync sequence, server-directed delay, 60-second failure retry, and focus/visibility handling. A local-edit revision preserves ownership or stock settings when a read or sync begun before the save completes afterward. Sync POSTs are only issued when the server's deadline is due.

App-level war polling, home summaries, data health, retaliations, competition, practical phases, and progress panels use the same scheduler or resource hook. Countdown/animation timers, authentication renewal, debounce timers, and hospital monitor WebSocket lifecycle are separate concerns.

## Verification

Run `npm run check:all`. Scheduler tests use fake timers and controlled promises to exercise overlap, mutation invalidation, visibility, cancellation, retry delays, deferred initial loads, and completed-resource polling stops. War Room tests verify ownership of live values versus history. Browser verification should also cover React Strict Mode, resource-key changes, saved edits during pending reads, sign-out, and a single live Chain Watch request per refresh while both consumers are mounted.

This refactor changes dashboard request ownership only. Worker collection schedules, backend caches, API payloads, and database schema are unchanged.
