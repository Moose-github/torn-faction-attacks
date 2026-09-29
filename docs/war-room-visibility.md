# War Room panel visibility

Generated from `shared/warRoomPolicy.ts` using `node scripts/war-room-visibility.mjs`.

True means present, including a collapsed panel or empty-state content. Events are excluded. Upcoming/current columns assume the selected global war and a linked enemy faction. An unselected war or missing enemy link shows only the existing explanatory fallback.

## Real wars

| Panel | Upcoming (>2h) | Preparation (≤2h) | Current | Practically finished | Officially ended |
|---|---|---|---|---|---|
| War header / countdown | true | true | true | true | true |
| Enemy status summary | false | true | true | false | false |
| War progress | true | true | true | true | true |
| Chain Watch | true | true | true | true | false |
| Hospital monitor | false | true | true | false | false |
| War control (WIP) | false | true | true | false | false |
| Enemy push pressure (WIP) | false | true | true | false | false |
| Revivable members | false | true | true | false | false |
| Enemy travel tracker | false | true | true | false | false |
| Stats comparison | true | true | true | true | true |
| War-room tracking paused | true | false | false | true | false |
| Activity heatmaps | true | true | true | true | true |
| Practical phases | false | false | false | false | false |
| Enemy faction scouting | true | true | true | true | true |
| Enemy big hitters | true | true | true | true | true |
| Members to watch | true | true | true | true | true |
| Tracking cadence | true | true | true | true | true |

## Termed wars

| Panel | Upcoming (>2h) | Preparation (≤2h) | Current | Practically finished | Officially ended |
|---|---|---|---|---|---|
| War header / countdown | true | true | true | true | true |
| Enemy status summary | false | true | true | false | false |
| War progress | true | true | true | true | true |
| Chain Watch | true | true | true | true | false |
| Hospital monitor | false | false | false | false | false |
| War control (WIP) | false | false | false | false | false |
| Enemy push pressure (WIP) | false | false | false | false | false |
| Revivable members | false | false | false | false | false |
| Enemy travel tracker | false | true | true | false | false |
| Stats comparison | true | true | true | true | true |
| War-room tracking paused | true | false | false | true | false |
| Activity heatmaps | true | true | true | true | true |
| Practical phases | true | true | true | true | true |
| Enemy faction scouting | true | true | true | true | true |
| Enemy big hitters | true | true | true | true | true |
| Members to watch | true | true | true | true | true |
| Tracking cadence | true | true | true | true | true |

A scheduled reopening stays practically finished until the backend activates it; an active reopening uses the Current column. Selecting another war disables live tracking without changing that war's phase. Hospital monitor is visible during preparation, but its launch action waits for Current.
