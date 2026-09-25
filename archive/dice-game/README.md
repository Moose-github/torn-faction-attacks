# Dice Game archive

Retired on 2026-09-25. See [restoration instructions](../README.md).

Preserved at their original repository-relative paths:

- `dashboard/src/views/DiceGame.tsx`: complete page.
- `src/diceGame.ts`: backend game logic.
- `dashboard/src/api/member.ts`: feature API helper fragment.
- `dashboard/src/api/types/index.ts`: feature response/type fragment.
- `dashboard/src/styles.css`: feature styling, animations, responsive and theme rules.

`backend-routes.txt` records the removed registrations from `src/http/memberRoutes.ts`. Restore their import of `getDiceGameState`, `rollDiceGame` and `sendXanaxToDiceGame` from `../diceGame` as well.

Former page: `/dice-game` (`diceGame` view, `Dices` icon). Former API endpoints: `GET /api/dice-game`, `POST /api/dice-game/roll`, `POST /api/dice-game/send-xanax`. No exclusive npm dependency was required. Existing game data and migrations are retained.
