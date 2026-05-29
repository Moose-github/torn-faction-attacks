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
  const width = 1108;
  const height = 591;
  const monthLabel = formatMonthLabel(monthKey);

  return [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    "<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
    "<stop offset=\"0%\" stop-color=\"#fde68a\"/>",
    "<stop offset=\"100%\" stop-color=\"#f59e0b\"/>",
    "</linearGradient>",
    "</defs>",
    `<rect width="${width}" height="${height}" rx="28" fill="#f8fafc"/>`,
    `<rect x="32" y="34" width="1044" height="96" rx="20" fill="#0f172a"/>`,
    svgText(62, 78, "Xanax Competition", {
      size: 42,
      weight: 800,
      fill: "#ffffff",
    }),
    svgText(64, 108, monthLabel, {
      size: 20,
      weight: 800,
      fill: "#cbd5e1",
    }),
    `<rect x="34" y="164" width="1042" height="250" rx="24" fill="#111827"/>`,
    `<path d="M34 340 H1076 V414 H34 Z" fill="#020617" opacity="0.28"/>`,
    svgText(78, 222, "Prize if won this month", { size: 30, weight: 800, fill: "#e5e7eb" }),
    svgText(78, 332, formatMoney(currentPrize), {
      size: 104,
      weight: 800,
      fill: "#fbbf24",
      maxLength: 18,
    }),
    `<rect x="34" y="446" width="1042" height="86" rx="18" fill="#ffffff" stroke="#dbe4ee"/>`,
    svgText(68, 482, `Monthly challenge: take ${XANAX_TARGET} Xanax during the month.`, {
      size: 18,
      weight: 800,
      fill: "#0f172a",
    }),
    svgText(68, 510, "If unclaimed, the prize rolls over by $10,000,000 every month until it is claimed.", {
      size: 17,
      fill: "#475569",
    }),
    "</svg>",
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
