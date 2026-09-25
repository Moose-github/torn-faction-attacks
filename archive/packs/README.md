# Packs archive

Retired on 2026-09-25. See [restoration instructions](../README.md).

Preserved at their original repository-relative paths:

- `dashboard/src/views/Packs.tsx`: complete page.
- `dashboard/src/components/SiegePackOpeningModal.tsx` and `dashboard/src/components/packOpening/`: pack reveal components.
- `dashboard/src/assets/packs/`: original images.
- `src/packs.ts`: backend pack listing logic.
- `dashboard/src/api/admin.ts`: feature API helper fragment.
- `dashboard/src/api/types/index.ts`: feature response/type fragment.
- `dashboard/src/styles.css`: feature styling, animations, responsive and theme rules.

`backend-routes.txt` records the removed registration from `src/http/adminRoutes.ts`; restore the `listPacks` import from `../packs` too. `backend-route-test.txt` preserves its original test body, which needs the `listPacks` import, mock and success response restored in the route test setup.

Former page: `/admin/packs` (admin-only `packs` view, `PackageOpen` icon). Former API endpoint: `GET /api/admin/packs`. Restore the dashboard dependency `pixi.js` (previous range `^8.19.0`) with npm before rebuilding the reveal components. Existing pack definitions, rewards, item data and migrations are retained.
