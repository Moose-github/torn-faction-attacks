import { renderSvgToPng } from "./discordImageRenderer";

const SVG_NS = "http://www.w3.org/2000/svg";
const XANAX_TARGET = 100;

export type XanaxCompetitionImageData = {
  monthKey: string;
  currentPrize: number;
};

export async function renderXanaxCompetitionReminderPng(
  data: XanaxCompetitionImageData,
): Promise<Uint8Array> {
  return renderSvgToPng(buildXanaxCompetitionReminderSvg(data));
}

function buildXanaxCompetitionReminderSvg({
  monthKey,
  currentPrize,
}: XanaxCompetitionImageData): string {
  const width = 1200;
  const height = 675;
  const monthLabel = formatMonthLabel(monthKey);

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
    svgText(110, 150, monthLabel, {
      size: 20,
      weight: 800,
      fill: "#cbd5e1",
    }),
    `<rect x="80" y="206" width="1042" height="286" rx="24" fill="#111827"/>`,
    `<path d="M80 400 H1122 V492 H80 Z" fill="#020617" opacity="0.28"/>`,
    svgText(124, 270, "Prize if won this month", { size: 30, weight: 800, fill: "#e5e7eb" }),
    svgText(124, 388, formatMoney(currentPrize), {
      size: 108,
      weight: 800,
      fill: "#fbbf24",
      maxLength: 18,
    }),
    `<rect x="80" y="526" width="1042" height="70" rx="18" fill="#ffffff" stroke="#dbe4ee"/>`,
    svgText(114, 554, `Monthly challenge: take ${XANAX_TARGET} Xanax during the month.`, {
      size: 18,
      weight: 800,
      fill: "#0f172a",
    }),
    svgText(114, 580, "If unclaimed, the prize rolls over by $10,000,000 every month until it is claimed.", {
      size: 17,
      fill: "#475569",
    }),
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

function formatMonthLabel(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }
  return date.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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
