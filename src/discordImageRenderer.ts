import { Resvg, initWasm } from "@resvg/resvg-wasm";
import dejavuSansBoldFont from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf";
import dejavuSansFont from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import {
  SCOUTING_BATTLE_STATS_BUCKETS,
  SCOUTING_NETWORTH_BUCKETS,
  ScoutingBucket,
  ScoutingComparisonMetric,
} from "../shared/scoutingBuckets";
import type { EnemyFactionMemberRow } from "./enemyScouting";

const HOME_STATS_LABEL = "Buttgrass";
const SVG_NS = "http://www.w3.org/2000/svg";

let resvgInitPromise: Promise<void> | null = null;

export async function renderStatsComparisonPng({
  enemyName,
  homeMembers,
  enemyMembers,
}: {
  enemyName: string;
  homeMembers: EnemyFactionMemberRow[];
  enemyMembers: EnemyFactionMemberRow[];
}): Promise<Uint8Array> {
  return renderSvgToPng(buildStatsComparisonSvg({ enemyName, homeMembers, enemyMembers }));
}

export async function renderEnemyMemberStatsTablePng({
  enemyName,
  enemyMembers,
}: {
  enemyName: string;
  enemyMembers: EnemyFactionMemberRow[];
}): Promise<Uint8Array> {
  return renderSvgToPng(buildEnemyMemberStatsTableSvg({ enemyName, enemyMembers }));
}

async function renderSvgToPng(svg: string): Promise<Uint8Array> {
  if (!resvgInitPromise) {
    resvgInitPromise = initWasm(resvgWasm);
  }
  await resvgInitPromise;

  const renderer = new Resvg(svg, {
    font: {
      fontBuffers: [new Uint8Array(dejavuSansFont), new Uint8Array(dejavuSansBoldFont)],
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans",
    },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
    fitTo: { mode: "original" },
  });
  try {
    const image = renderer.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}

function buildStatsComparisonSvg({
  enemyName,
  homeMembers,
  enemyMembers,
}: {
  enemyName: string;
  homeMembers: EnemyFactionMemberRow[];
  enemyMembers: EnemyFactionMemberRow[];
}): string {
  const width = 1200;
  const headerHeight = 100;
  const panelGap = 18;
  const panelHeight = 276;
  const footerHeight = 26;
  const panels = [
    {
      title: "FF stats",
      metric: "ff_battlestats" as const,
      buckets: SCOUTING_BATTLE_STATS_BUCKETS,
    },
    {
      title: "BSP stats",
      metric: "bsp_battlestats" as const,
      buckets: SCOUTING_BATTLE_STATS_BUCKETS,
    },
    {
      title: "Networth",
      metric: "networth" as const,
      buckets: SCOUTING_NETWORTH_BUCKETS,
    },
  ];
  const height = headerHeight + panels.length * panelHeight + (panels.length - 1) * panelGap + footerHeight;
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);

  let panelY = headerHeight;
  const panelSvg = panels
    .map((panel) => {
      const svg = renderStatsPanelSvg({
        ...panel,
        y: panelY,
        height: panelHeight,
        homeMembers,
        enemyMembers,
        enemyName,
      });
      panelY += panelHeight + panelGap;
      return svg;
    })
    .join("");

  return [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    "<linearGradient id=\"homeFill\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">",
    "<stop offset=\"0%\" stop-color=\"#2563eb\" stop-opacity=\"0.32\"/>",
    "<stop offset=\"100%\" stop-color=\"#2563eb\" stop-opacity=\"0.05\"/>",
    "</linearGradient>",
    "<linearGradient id=\"enemyFill\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">",
    "<stop offset=\"0%\" stop-color=\"#ef4444\" stop-opacity=\"0.32\"/>",
    "<stop offset=\"100%\" stop-color=\"#ef4444\" stop-opacity=\"0.05\"/>",
    "</linearGradient>",
    "</defs>",
    `<rect width="${width}" height="${height}" fill="#f8fafc"/>`,
    "<rect x=\"24\" y=\"20\" width=\"1152\" height=\"64\" rx=\"10\" fill=\"#0f172a\"/>",
    svgText(48, 48, `${enemyName} stats comparison`, {
      size: 25,
      weight: 800,
      fill: "#ffffff",
    }),
    svgText(48, 70, `Generated ${generatedAt} UTC after FF, BSP, and networth fills completed`, {
      size: 12,
      fill: "#cbd5e1",
    }),
    "<rect x=\"872\" y=\"37\" width=\"14\" height=\"14\" rx=\"3\" fill=\"#2563eb\"/>",
    svgText(896, 49, HOME_STATS_LABEL, { size: 12, fill: "#e2e8f0" }),
    "<rect x=\"1012\" y=\"37\" width=\"14\" height=\"14\" rx=\"3\" fill=\"#ef4444\"/>",
    svgText(1036, 49, enemyName, { size: 12, fill: "#e2e8f0", maxLength: 16 }),
    panelSvg,
    "</svg>",
  ].join("");
}

function renderStatsPanelSvg({
  y,
  height,
  title,
  metric,
  buckets,
  homeMembers,
  enemyMembers,
  enemyName,
}: {
  y: number;
  height: number;
  title: string;
  metric: ScoutingComparisonMetric;
  buckets: ScoutingBucket[];
  homeMembers: EnemyFactionMemberRow[];
  enemyMembers: EnemyFactionMemberRow[];
  enemyName: string;
}): string {
  const chartLeft = 104;
  const chartRight = 1096;
  const chartTop = y + 78;
  const chartBottom = y + height - 58;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const homeValues = buildBucketCounts(homeMembers, buckets, metric);
  const enemyValues = buildBucketCounts(enemyMembers, buckets, metric);
  const maxValue = niceChartMax(Math.max(1, ...homeValues, ...enemyValues));
  const homeCoverage = metricCoverage(homeMembers, metric);
  const enemyCoverage = metricCoverage(enemyMembers, metric);
  const homeAverage = metricAverage(homeMembers, metric);
  const enemyAverage = metricAverage(enemyMembers, metric);
  const step = buckets.length > 1 ? chartWidth / (buckets.length - 1) : chartWidth;
  const homePoints = homeValues.map((value, index) =>
    chartPoint(chartLeft, chartBottom, chartHeight, step, index, value, maxValue),
  );
  const enemyPoints = enemyValues.map((value, index) =>
    chartPoint(chartLeft, chartBottom, chartHeight, step, index, value, maxValue),
  );

  return [
    `<rect x="24" y="${y}" width="1152" height="${height}" rx="10" fill="#ffffff" stroke="#dbe4ee"/>`,
    `<rect x="24" y="${y}" width="1152" height="36" rx="10" fill="#f1f5f9"/>`,
    `<rect x="24" y="${y + 24}" width="1152" height="12" fill="#f1f5f9"/>`,
    svgText(48, y + 24, title, { size: 18, weight: 800, fill: "#0f172a" }),
    svgText(
      420,
      y + 25,
      `${HOME_STATS_LABEL} ${homeCoverage.available}/${homeCoverage.total} avg ${formatCompactNumber(homeAverage)}`,
      { size: 12, fill: "#475569", anchor: "middle" },
    ),
    svgText(
      730,
      y + 25,
      `${enemyName} ${enemyCoverage.available}/${enemyCoverage.total} avg ${formatCompactNumber(enemyAverage)}`,
      { size: 12, fill: "#475569", anchor: "middle", maxLength: 42 },
    ),
    renderGridSvg(chartLeft, chartTop, chartWidth, chartHeight, chartBottom, maxValue),
    `<path d="${areaPath(homePoints, chartBottom)}" fill="url(#homeFill)"/>`,
    `<path d="${areaPath(enemyPoints, chartBottom)}" fill="url(#enemyFill)"/>`,
    `<path d="${smoothLinePath(homePoints)}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${smoothLinePath(enemyPoints)}" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    homePoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>`).join(""),
    enemyPoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>`).join(""),
    buckets
      .map((bucket, index) =>
        svgText(chartLeft + index * step, chartBottom + 26, bucket.label, {
          size: 11,
          fill: "#475569",
          anchor: "middle",
        }),
      )
      .join(""),
  ].join("");
}

function renderGridSvg(
  chartLeft: number,
  chartTop: number,
  chartWidth: number,
  chartHeight: number,
  chartBottom: number,
  maxValue: number,
): string {
  const lines: string[] = [];
  for (let index = 0; index <= 4; index += 1) {
    const value = Math.round((maxValue / 4) * index);
    const gridY = chartBottom - Math.round((index / 4) * chartHeight);
    lines.push(`<line x1="${chartLeft}" y1="${gridY}" x2="${chartLeft + chartWidth}" y2="${gridY}" stroke="#e2e8f0" stroke-width="1"/>`);
    lines.push(svgText(chartLeft - 14, gridY + 4, String(value), {
      size: 11,
      fill: "#64748b",
      anchor: "end",
    }));
  }
  lines.push(`<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" stroke="#dbe4ee" stroke-width="1"/>`);
  lines.push(`<line x1="${chartLeft}" y1="${chartBottom}" x2="${chartLeft + chartWidth}" y2="${chartBottom}" stroke="#dbe4ee" stroke-width="1"/>`);
  return lines.join("");
}

function buildEnemyMemberStatsTableSvg({
  enemyName,
  enemyMembers,
}: {
  enemyName: string;
  enemyMembers: EnemyFactionMemberRow[];
}): string {
  const width = 920;
  const contentWidth = width - 48;
  const tableTop = 96;
  const tableHeaderHeight = 30;
  const rowHeight = 24;
  const footerHeight = 24;
  const nameX = 48;
  const levelX = 330;
  const ffStatsX = 590;
  const bspStatsX = 820;
  const members = [...enemyMembers].sort(compareEnemyMemberStatsRows);
  const bodyRows = Math.max(1, members.length);
  const tableHeight = tableHeaderHeight + bodyRows * rowHeight;
  const height = tableTop + tableHeight + footerHeight;
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);
  const rows = members.length === 0
    ? [
        `<rect x="24" y="${tableTop + tableHeaderHeight}" width="${contentWidth}" height="${rowHeight}" fill="#ffffff"/>`,
        svgText(nameX, tableTop + tableHeaderHeight + 17, "No enemy members cached", {
          size: 12,
          fill: "#64748b",
        }),
      ].join("")
    : members
        .map((member, index) => {
          const rowY = tableTop + tableHeaderHeight + index * rowHeight;
          return [
            `<rect x="24" y="${rowY}" width="${contentWidth}" height="${rowHeight}" fill="${index % 2 === 0 ? "#ffffff" : "#f1f5f9"}"/>`,
            svgText(nameX, rowY + 17, member.name ?? `#${member.member_id}`, {
              size: 12,
              fill: "#0f172a",
              maxLength: 26,
            }),
            svgText(levelX, rowY + 17, formatNullableInteger(member.level), {
              size: 12,
              fill: "#334155",
              anchor: "end",
            }),
            svgText(ffStatsX, rowY + 17, formatNullableInteger(member.ff_battlestats), {
              size: 12,
              fill: "#334155",
              anchor: "end",
            }),
            svgText(bspStatsX, rowY + 17, formatNullableInteger(member.bsp_battlestats), {
              size: 12,
              fill: "#334155",
              anchor: "end",
            }),
          ].join("");
        })
        .join("");

  return [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#f8fafc"/>`,
    `<rect x="24" y="20" width="${contentWidth}" height="62" rx="10" fill="#0f172a"/>`,
    svgText(48, 48, `${enemyName} member stats`, {
      size: 25,
      weight: 800,
      fill: "#ffffff",
      maxLength: 38,
    }),
    svgText(48, 70, `Generated ${generatedAt} UTC`, { size: 12, fill: "#cbd5e1" }),
    `<rect x="24" y="${tableTop}" width="${contentWidth}" height="${tableHeight}" rx="8" fill="#ffffff" stroke="#dbe4ee"/>`,
    `<rect x="24" y="${tableTop}" width="${contentWidth}" height="${tableHeaderHeight}" rx="8" fill="#e2e8f0"/>`,
    `<rect x="24" y="${tableTop + 20}" width="${contentWidth}" height="10" fill="#e2e8f0"/>`,
    svgText(nameX, tableTop + 20, "Name", { size: 11, weight: 700, fill: "#475569" }),
    svgText(levelX, tableTop + 20, "Level", {
      size: 11,
      weight: 700,
      fill: "#475569",
      anchor: "end",
    }),
    svgText(ffStatsX, tableTop + 20, "FF stats", {
      size: 11,
      weight: 700,
      fill: "#475569",
      anchor: "end",
    }),
    svgText(bspStatsX, tableTop + 20, "BSP stats", {
      size: 11,
      weight: 700,
      fill: "#475569",
      anchor: "end",
    }),
    rows,
    "</svg>",
  ].join("");
}

function chartPoint(
  chartLeft: number,
  chartBottom: number,
  chartHeight: number,
  step: number,
  index: number,
  value: number,
  maxValue: number,
): { x: number; y: number } {
  return {
    x: round(chartLeft + index * step),
    y: round(chartBottom - (value / maxValue) * chartHeight),
  };
}

function areaPath(points: Array<{ x: number; y: number }>, baseline: number): string {
  if (points.length === 0) {
    return "";
  }
  return [
    `M ${points[0].x} ${baseline}`,
    `L ${points[0].x} ${points[0].y}`,
    smoothLinePathSegments(points),
    `L ${points[points.length - 1].x} ${baseline}`,
    "Z",
  ].join(" ");
}

function smoothLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }
  return [`M ${points[0].x} ${points[0].y}`, smoothLinePathSegments(points)].join(" ");
}

function smoothLinePathSegments(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) {
    return "";
  }
  const commands: string[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    commands.push(`C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${p2.x} ${p2.y}`);
  }
  return commands.join(" ");
}

function buildBucketCounts(
  members: EnemyFactionMemberRow[],
  buckets: ScoutingBucket[],
  metric: ScoutingComparisonMetric,
): number[] {
  return buckets.map(
    (bucket) =>
      members.filter((member) => {
        if (!hasScoutingMetricValue(member, metric)) {
          return false;
        }
        const value = Number(member[metric] ?? 0);
        return Number.isFinite(value) && value >= bucket.min && value < bucket.max;
      }).length,
  );
}

function metricCoverage(
  members: EnemyFactionMemberRow[],
  metric: ScoutingComparisonMetric,
): { available: number; total: number } {
  return {
    available: members.filter((member) => hasScoutingMetricValue(member, metric)).length,
    total: members.length,
  };
}

function metricAverage(
  members: EnemyFactionMemberRow[],
  metric: ScoutingComparisonMetric,
): number | null {
  const values = members
    .map((member) => Number(member[metric] ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function hasScoutingMetricValue(
  member: EnemyFactionMemberRow,
  metric: ScoutingComparisonMetric,
): boolean {
  const value = Number(member[metric] ?? 0);
  return Number.isFinite(value) && value > 0;
}

function compareEnemyMemberStatsRows(a: EnemyFactionMemberRow, b: EnemyFactionMemberRow): number {
  const bFf = Number(b.ff_battlestats ?? 0);
  const aFf = Number(a.ff_battlestats ?? 0);
  if (bFf !== aFf) {
    return bFf - aFf;
  }

  const bBsp = Number(b.bsp_battlestats ?? 0);
  const aBsp = Number(a.bsp_battlestats ?? 0);
  if (bBsp !== aBsp) {
    return bBsp - aBsp;
  }

  return (b.level ?? 0) - (a.level ?? 0) || (a.name ?? "").localeCompare(b.name ?? "");
}

function formatNullableInteger(value: number | null | undefined): string {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.round(numberValue).toLocaleString("en-US")
    : "-";
}

function formatCompactNumber(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${trimNumber(value / 1_000_000_000_000)}t`;
  if (abs >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trimNumber(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${trimNumber(value / 1_000)}k`;
  return String(Math.round(value));
}

function trimNumber(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}

function niceChartMax(value: number): number {
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  return Math.ceil(value / 5) * 5;
}

function svgText(
  x: number,
  y: number,
  value: string,
  options: {
    size: number;
    fill: string;
    weight?: number;
    anchor?: "start" | "middle" | "end";
    maxLength?: number;
  },
): string {
  const trimmed = options.maxLength ? truncateText(value, options.maxLength) : value;
  return `<text x="${round(x)}" y="${round(y)}" font-family="Arial, Helvetica, sans-serif" font-size="${options.size}" font-weight="${options.weight ?? 500}" text-anchor="${options.anchor ?? "start"}" fill="${options.fill}">${escapeSvg(trimmed)}</text>`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
