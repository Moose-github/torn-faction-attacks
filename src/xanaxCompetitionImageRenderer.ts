import { renderSvgToPng } from "./discordImageRenderer";
import type { XanaxCompetitionProgress } from "./xanaxCompetition";

const SVG_NS = "http://www.w3.org/2000/svg";
const XANAX_TARGET = 100;

export type XanaxCompetitionImageData = {
  enabled: boolean;
  monthKey: string;
  currentPrize: number;
  latestSnapshotDate: string | null;
  leaderboard: XanaxCompetitionProgress[];
};

export async function renderXanaxCompetitionReminderPng(
  data: XanaxCompetitionImageData,
): Promise<Uint8Array> {
  return renderSvgToPng(buildXanaxCompetitionReminderSvg(data));
}

function buildXanaxCompetitionReminderSvg({
  enabled,
  monthKey,
  currentPrize,
  latestSnapshotDate,
  leaderboard,
}: XanaxCompetitionImageData): string {
  const width = 1200;
  const height = 675;
  const leaders = leaderboard.slice(0, 5);
  const leader = leaders[0] ?? null;
  const eligibleCount = leaderboard.filter((row) => row.eligible).length;
  const leaderProgress = leader ? Math.min(1, leader.monthly_xanax / XANAX_TARGET) : 0;
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);
  const statusLabel = enabled
    ? eligibleCount > 0
      ? `${eligibleCount} ready to claim`
      : "Prize still up for grabs"
    : "Competition paused";

  return [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    "<linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
    "<stop offset=\"0%\" stop-color=\"#092f3f\"/>",
    "<stop offset=\"45%\" stop-color=\"#124e5f\"/>",
    "<stop offset=\"100%\" stop-color=\"#172554\"/>",
    "</linearGradient>",
    "<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
    "<stop offset=\"0%\" stop-color=\"#fde68a\"/>",
    "<stop offset=\"100%\" stop-color=\"#f59e0b\"/>",
    "</linearGradient>",
    "<linearGradient id=\"bar\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\">",
    "<stop offset=\"0%\" stop-color=\"#22c55e\"/>",
    "<stop offset=\"100%\" stop-color=\"#38bdf8\"/>",
    "</linearGradient>",
    "</defs>",
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    `<path d="M760 0 L1200 0 L1200 166 L900 166 Z" fill="#38bdf8" opacity="0.12"/>`,
    `<path d="M0 546 L350 546 L260 675 L0 675 Z" fill="#f59e0b" opacity="0.12"/>`,
    renderCapsules(),
    `<rect x="46" y="42" width="1108" height="591" rx="28" fill="#f8fafc" opacity="0.96"/>`,
    `<rect x="78" y="76" width="1044" height="96" rx="20" fill="#0f172a"/>`,
    svgText(108, 120, "Xanax Competition", {
      size: 42,
      weight: 800,
      fill: "#ffffff",
    }),
    svgText(110, 150, `Month ${monthKey} | Generated ${generatedAt} UTC`, {
      size: 16,
      fill: "#cbd5e1",
    }),
    pill(872, 102, 220, 42, statusLabel, enabled ? "#dcfce7" : "#fee2e2", enabled ? "#166534" : "#991b1b"),
    `<rect x="80" y="206" width="1042" height="250" rx="24" fill="#111827"/>`,
    `<path d="M80 386 H1122 V456 H80 Z" fill="#020617" opacity="0.28"/>`,
    svgText(124, 258, "Prize if won this month", { size: 26, weight: 800, fill: "#e5e7eb" }),
    svgText(124, 350, formatMoney(currentPrize), {
      size: 92,
      weight: 800,
      fill: "#fbbf24",
      maxLength: 18,
    }),
    svgText(126, 405, "Includes any rollover currently on the board.", {
      size: 22,
      fill: "#cbd5e1",
    }),
    pill(828, 246, 238, 46, `${XANAX_TARGET} Xanax to claim`, "#dcfce7", "#166534"),
    svgText(844, 334, "Take 100 Xanax this month.", {
      size: 20,
      weight: 800,
      fill: "#e5e7eb",
    }),
    svgText(844, 366, "First eligible claim gets the pot.", {
      size: 18,
      fill: "#94a3b8",
    }),
    svgText(844, 410, latestSnapshotDate ? `Latest stats: ${latestSnapshotDate}` : "Stats are still filling.", {
      size: 17,
      fill: "#cbd5e1",
    }),
    `<rect x="80" y="488" width="1042" height="108" rx="22" fill="#ffffff" stroke="#dbe4ee"/>`,
    svgText(114, 532, leader ? "Current pace" : "Current pace unavailable", {
      size: 20,
      weight: 800,
      fill: "#0f172a",
    }),
    leader
      ? [
          svgText(114, 566, `${leader.member_name ?? `#${leader.member_id}`} leads with ${leader.monthly_xanax} Xanax`, {
            size: 18,
            fill: "#334155",
            maxLength: 52,
          }),
          progressBar(474, 525, 330, 26, leaderProgress),
          svgText(824, 545, `${Math.max(0, XANAX_TARGET - leader.monthly_xanax)} left`, {
            size: 18,
            weight: 800,
            fill: leader.eligible ? "#15803d" : "#334155",
          }),
        ].join("")
      : svgText(114, 566, "No leaderboard data yet.", { size: 18, fill: "#334155" }),
    leaders.length > 0 ? renderLeaderChips(leaders, 940, 516) : "",
    "</svg>",
  ].join("");
}

function renderCapsules(): string {
  const capsules = [
    { x: 1002, y: 70, rotation: -14, fill: "#93c5fd" },
    { x: 1056, y: 174, rotation: 18, fill: "#5eead4" },
    { x: 130, y: 606, rotation: 16, fill: "#fde68a" },
    { x: 224, y: 584, rotation: -18, fill: "#67e8f9" },
  ];

  return capsules
    .map(
      (capsule) =>
        `<g transform="translate(${capsule.x} ${capsule.y}) rotate(${capsule.rotation})">` +
        `<rect x="-32" y="-11" width="64" height="22" rx="11" fill="${capsule.fill}" opacity="0.4"/>` +
        `<line x1="0" y1="-10" x2="0" y2="10" stroke="#f8fafc" stroke-width="2" opacity="0.7"/>` +
        "</g>",
    )
    .join("");
}

function renderLeaderChips(leaders: XanaxCompetitionProgress[], x: number, y: number): string {
  return leaders
    .slice(0, 3)
    .map((row, index) => {
      const chipY = y + index * 24;
      return [
        `<rect x="${x}" y="${chipY}" width="146" height="18" rx="9" fill="${row.eligible ? "#dcfce7" : "#e0f2fe"}"/>`,
        svgText(x + 14, chipY + 13, `#${row.rank} ${row.monthly_xanax}`, {
          size: 12,
          weight: 800,
          fill: row.eligible ? "#166534" : "#075985",
        }),
        svgText(x + 72, chipY + 13, row.member_name ?? `#${row.member_id}`, {
          size: 12,
          fill: "#0f172a",
          maxLength: 11,
        }),
      ].join("");
    })
    .join("");
}

function progressBar(x: number, y: number, width: number, height: number, progress: number): string {
  const fillWidth = Math.max(height, Math.round(width * progress));
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#e2e8f0"/>`,
    `<rect x="${x}" y="${y}" width="${Math.min(width, fillWidth)}" height="${height}" rx="${height / 2}" fill="url(#bar)"/>`,
  ].join("");
}

function pill(x: number, y: number, width: number, height: number, text: string, fill: string, textFill: string): string {
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"/>`,
    svgText(x + width / 2, y + 27, text, {
      size: 15,
      weight: 800,
      fill: textFill,
      anchor: "middle",
      maxLength: 24,
    }),
  ].join("");
}

function svgText(
  x: number,
  y: number,
  text: string,
  options: {
    size: number;
    fill: string;
    weight?: number;
    anchor?: "start" | "middle" | "end";
    maxLength?: number;
  },
): string {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${options.size}" font-weight="${options.weight ?? 400}" fill="${options.fill}" text-anchor="${options.anchor ?? "start"}">${escapeXml(truncateText(text, options.maxLength))}</text>`;
}

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
}

function truncateText(text: string, maxLength?: number): string {
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
