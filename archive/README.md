# Retired features

Dice Game and Packs were retired on 2026-09-25. Their source is kept here for reference and possible restoration, outside the active dashboard and worker source trees. These snapshots are not maintained or built. Original relative imports are preserved and become valid again when restored to their original locations.

- [Dice Game](dice-game/README.md)
- [Packs](packs/README.md)

The active app has no sidebar entries, page components or API registrations for these features. `/dice-game` and `/admin/packs` replace the current browser history entry with `/`, including on browser back/forward navigation. Their former API URLs fall through to the normal API not-found response.

Database tables, stored data and historical migrations are retained. No database cleanup or migration is needed for this retirement.

## Restoring a feature

1. Copy its archived standalone files back to the same repository-relative paths. Merge the archived API helper and type fragments into the corresponding existing files; do not overwrite shared files.
2. Merge its archived CSS back into `dashboard/src/styles.css`. The archive includes responsive and theme rules, including the retired selectors extracted from shared selector lists. Preserve cascade order when merging; the pre-retirement stylesheet is available in Git.
3. Reconnect the lazy page import, render branch, route/view entry, sidebar link/icon and relevant API registrations. Backend route snippets are saved beside each feature README. Remove that page from `retiredPageRedirect`.
4. Restore any feature-only dependencies and route tests, then run the dashboard build, worker check and route tests. The last commit before this retirement is `41a9d4a`; use it to compare the original integration and stylesheet order. Do not reset unrelated subsequent changes.

Shared infrastructure remains in active source. Archived fragments rely on it and are not standalone applications. `.txt` route/test snippets deliberately stay outside test discovery.
