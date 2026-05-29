import { renderSvgToPng } from "./discordImageRenderer";

const SVG_NS = "http://www.w3.org/2000/svg";
const XANAX_TARGET = 100;

export type XanaxCompetitionImageData = {
  monthKey: string;
  currentPrize: number;
  xanaxImageDataUri?: string | null;
};

export async function renderXanaxCompetitionReminderPng(
  data: XanaxCompetitionImageData,
): Promise<Uint8Array> {
  return renderSvgToPng(buildXanaxCompetitionReminderSvg(data));
}

function buildXanaxCompetitionReminderSvg({
  monthKey,
  currentPrize,
  xanaxImageDataUri,
}: XanaxCompetitionImageData): string {
  const width = 1108;
  const height = 540;
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
    renderXanaxSprinkles(xanaxImageDataUri),
    `<rect x="32" y="32" width="1044" height="96" rx="20" fill="#0f172a"/>`,
    svgText(258, 86, "Xanax Competition", {
      size: 42,
      weight: 800,
      fill: "#ffffff",
    }),
    svgText(762, 86, monthLabel, {
      size: 20,
      weight: 800,
      fill: "#cbd5e1",
    }),
    `<rect x="34" y="158" width="1042" height="222" rx="24" fill="#111827"/>`,
    `<rect x="34" y="318" width="1042" height="62" rx="24" fill="#020617" opacity="0.22"/>`,
    `<rect x="34" y="318" width="1042" height="31" fill="#020617" opacity="0.22"/>`,
    svgText(78, 214, "This months prize", { size: 30, weight: 800, fill: "#e5e7eb" }),
    svgText(78, 318, formatMoney(currentPrize), {
      size: 100,
      weight: 800,
      fill: "#fbbf24",
      maxLength: 18,
    }),
    `<rect x="34" y="410" width="1042" height="86" rx="18" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>`,
    svgText(68, 446, `Monthly challenge: take ${XANAX_TARGET} Xanax during the month.`, {
      size: 18,
      weight: 800,
      fill: "#0f172a",
    }),
    svgText(68, 474, "If unclaimed, the prize rolls over by $10,000,000 every month until it is claimed.", {
      size: 17,
      fill: "#475569",
    }),
    "</svg>",
  ].join("");
}

function renderXanaxSprinkles(xanaxImageDataUri: string | null | undefined): string {
  const sprinkles = [
    { x: 18, y: 74, size: 76, rotation: -18, opacity: 0.5 },
    { x: 1090, y: 88, size: 74, rotation: 16, opacity: 0.48 },
    { x: 86, y: 144, size: 54, rotation: -12, opacity: 0.42 },
    { x: 166, y: 144, size: 62, rotation: 18, opacity: 0.44 },
    { x: 316, y: 144, size: 50, rotation: -18, opacity: 0.34 },
    { x: 782, y: 144, size: 52, rotation: 16, opacity: 0.34 },
    { x: 956, y: 146, size: 64, rotation: -14, opacity: 0.44 },
    { x: 1040, y: 144, size: 54, rotation: 18, opacity: 0.42 },
    { x: 18, y: 282, size: 68, rotation: 12, opacity: 0.36 },
    { x: 1090, y: 282, size: 70, rotation: -16, opacity: 0.36 },
    { x: 104, y: 398, size: 70, rotation: -16, opacity: 0.48 },
    { x: 244, y: 396, size: 54, rotation: 14, opacity: 0.34 },
    { x: 862, y: 396, size: 54, rotation: -18, opacity: 0.34 },
    { x: 1008, y: 398, size: 70, rotation: 14, opacity: 0.48 },
    { x: 78, y: 522, size: 54, rotation: -18, opacity: 0.34 },
    { x: 150, y: 522, size: 64, rotation: 20, opacity: 0.44 },
    { x: 326, y: 520, size: 48, rotation: -12, opacity: 0.3 },
    { x: 782, y: 520, size: 48, rotation: 12, opacity: 0.3 },
    { x: 958, y: 522, size: 66, rotation: -20, opacity: 0.44 },
    { x: 1032, y: 522, size: 54, rotation: 18, opacity: 0.34 },
  ];

  return sprinkles
    .map((sprinkle) => {
      const transform = `translate(${sprinkle.x} ${sprinkle.y}) rotate(${sprinkle.rotation})`;
      if (xanaxImageDataUri) {
        return [
          `<g transform="${transform}" opacity="${sprinkle.opacity}">`,
          `<image href="${escapeXml(xanaxImageDataUri)}" x="${-sprinkle.size / 2}" y="${-sprinkle.size / 2}" width="${sprinkle.size}" height="${sprinkle.size}" preserveAspectRatio="xMidYMid meet"/>`,
          "</g>",
        ].join("");
      }
      return [
        `<g transform="${transform}" opacity="${sprinkle.opacity}">`,
        `<rect x="${-sprinkle.size / 2}" y="${-sprinkle.size / 6}" width="${sprinkle.size}" height="${sprinkle.size / 3}" rx="${sprinkle.size / 6}" fill="#22c55e"/>`,
        `<line x1="0" y1="${-sprinkle.size / 6}" x2="0" y2="${sprinkle.size / 6}" stroke="#f8fafc" stroke-width="2"/>`,
        "</g>",
      ].join("");
    })
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
