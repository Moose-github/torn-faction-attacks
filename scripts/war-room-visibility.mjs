import { writeFileSync } from "node:fs";
import { resolveWarPhase } from "../shared/warPhase.ts";
import { WAR_ROOM_PANEL_POLICY, warRoomPanelVisibility } from "../shared/warRoomPolicy.ts";

// Regenerate after editing the policy: node scripts/war-room-visibility.mjs
const start = 100_000;
const phases = [
  { label: "Upcoming (>2h)", now: start - 7201, state: "upcoming", status: "scheduled" },
  { label: "Preparation (≤2h)", now: start - 7200, state: "upcoming", status: "scheduled" },
  { label: "Current", now: start, state: "current", status: "active" },
  { label: "Practically finished", now: start + 101, state: "practically_finished", status: "active", practical_finish_time: start + 100 },
  { label: "Officially ended", now: start + 201, state: "none", status: "ended", practical_finish_time: start + 100, official_end_time: start + 200 },
];
const lines = [
  "# War Room panel visibility", "",
  "Generated from `shared/warRoomPolicy.ts` using `node scripts/war-room-visibility.mjs`.", "",
  "True means present, including a collapsed panel or empty-state content. Events are excluded. Upcoming/current columns assume the selected global war and a linked enemy faction. An unselected war or missing enemy link shows only the existing explanatory fallback.", "",
];
for (const war_type of ["real", "termed"]) {
  const visibility = phases.map(sample => {
    const war = { id: 1, enemy_faction_id: 99, war_type, practical_start_time: start,
      official_start_time: start, practical_finish_time: null, official_end_time: null, ...sample };
    return warRoomPanelVisibility(resolveWarPhase(war, sample.now, { activeWarId: 1, warState: sample.state }), war);
  });
  lines.push(`## ${war_type === "real" ? "Real" : "Termed"} wars`, "",
    `| Panel | ${phases.map(p => p.label).join(" | ")} |`,
    `|---|${phases.map(() => "---").join("|")}|`);
  for (const [id, rule] of Object.entries(WAR_ROOM_PANEL_POLICY)) {
    lines.push(`| ${rule.title} | ${visibility.map(v => String(v[id])).join(" | ")} |`);
  }
  lines.push("");
}
lines.push("A scheduled reopening stays practically finished until the backend activates it; an active reopening uses the Current column. Selecting another war disables live tracking without changing that war's phase. Hospital monitor is visible during preparation, but its launch action waits for Current.", "");
writeFileSync(new URL("../docs/war-room-visibility.md", import.meta.url), lines.join("\n"));
