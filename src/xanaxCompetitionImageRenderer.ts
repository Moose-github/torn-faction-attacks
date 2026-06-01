import { renderSvgToPng, renderSvgToRgba } from "./discordImageRenderer";
import { encodeAnimatedGif, GifFrame } from "./gifEncoder";

const SVG_NS = "http://www.w3.org/2000/svg";
const XANAX_TARGET = 100;
const IMAGE_WIDTH = 1108;
const IMAGE_HEIGHT = 540;
const GIF_FRAME_COUNT = 12;
const GIF_DURATION_MS = 2400;

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

export async function renderXanaxCompetitionReminderGif(
  data: XanaxCompetitionImageData,
): Promise<Uint8Array> {
  const frames: GifFrame[] = [];
  for (let frameIndex = 0; frameIndex < GIF_FRAME_COUNT; frameIndex += 1) {
    const image = await renderSvgToRgba(buildXanaxCompetitionReminderSvg(data, {
      rainProgress: frameIndex / GIF_FRAME_COUNT,
    }));
    frames.push({
      width: image.width,
      height: image.height,
      pixels: image.pixels,
      delayMs: GIF_DURATION_MS / GIF_FRAME_COUNT,
    });
  }
  return encodeAnimatedGif(frames);
}

function buildXanaxCompetitionReminderSvg({
  monthKey,
  currentPrize,
  xanaxImageDataUri,
}: XanaxCompetitionImageData, options: { rainProgress?: number } = {}): string {
  const width = IMAGE_WIDTH;
  const height = IMAGE_HEIGHT;
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
    options.rainProgress === undefined
      ? renderXanaxSprinkles(xanaxImageDataUri)
      : renderXanaxRain(xanaxImageDataUri, options.rainProgress),
    `<rect x="64" y="32" width="980" height="96" rx="20" fill="#0f172a"/>`,
    svgText(94, 89, "Xanax Competition", {
      size: 42,
      weight: 800,
      fill: "#ffffff",
    }),
    svgText(568, 89, monthLabel, {
      size: 20,
      weight: 800,
      fill: "#cbd5e1",
    }),
    `<rect x="64" y="158" width="980" height="222" rx="24" fill="#111827"/>`,
    `<rect x="64" y="318" width="980" height="62" rx="24" fill="#020617" opacity="0.22"/>`,
    `<rect x="64" y="318" width="980" height="31" fill="#020617" opacity="0.22"/>`,
    svgText(108, 214, "This month's prize", { size: 30, weight: 800, fill: "#e5e7eb" }),
    svgText(108, 318, formatMoney(currentPrize), {
      size: 100,
      weight: 800,
      fill: "#fbbf24",
      maxLength: 18,
    }),
    `<rect x="64" y="410" width="980" height="86" rx="18" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>`,
    svgText(98, 446, `Monthly challenge: take ${XANAX_TARGET} Xanax during the month.`, {
      size: 18,
      weight: 800,
      fill: "#0f172a",
    }),
    svgText(98, 474, "If unclaimed, the prize rolls over by $10,000,000 every month until it is claimed.", {
      size: 17,
      fill: "#475569",
    }),
    "</svg>",
  ].join("");
}

function renderXanaxRain(xanaxImageDataUri: string | null | undefined, progress: number): string {
  const fallSpan = IMAGE_HEIGHT + 180;
  const pills = [
    { x: 44, size: 58, offset: 0.03, drift: 18, rotation: -18, turns: 1.3, opacity: 0.52 },
    { x: 128, size: 68, offset: 0.38, drift: -18, rotation: 12, turns: -1.1, opacity: 0.58 },
    { x: 202, size: 50, offset: 0.14, drift: 26, rotation: -26, turns: 1.4, opacity: 0.45 },
    { x: 286, size: 72, offset: 0.72, drift: -22, rotation: 24, turns: -1.3, opacity: 0.56 },
    { x: 358, size: 56, offset: 0.29, drift: 16, rotation: -8, turns: 1.0, opacity: 0.46 },
    { x: 438, size: 76, offset: 0.56, drift: -26, rotation: 18, turns: -1.5, opacity: 0.54 },
    { x: 522, size: 62, offset: 0.08, drift: 24, rotation: -22, turns: 1.2, opacity: 0.5 },
    { x: 596, size: 50, offset: 0.84, drift: -18, rotation: 10, turns: -1.0, opacity: 0.44 },
    { x: 680, size: 70, offset: 0.23, drift: 20, rotation: -14, turns: 1.5, opacity: 0.57 },
    { x: 758, size: 58, offset: 0.63, drift: -24, rotation: 26, turns: -1.2, opacity: 0.48 },
    { x: 840, size: 74, offset: 0.46, drift: 18, rotation: -10, turns: 1.4, opacity: 0.55 },
    { x: 918, size: 52, offset: 0.94, drift: -20, rotation: 16, turns: -1.1, opacity: 0.45 },
    { x: 998, size: 66, offset: 0.18, drift: 26, rotation: -24, turns: 1.3, opacity: 0.53 },
    { x: 1070, size: 56, offset: 0.78, drift: -16, rotation: 20, turns: -1.0, opacity: 0.49 },
  ];

  return pills
    .map((pill) => {
      const cycle = (progress + pill.offset) % 1;
      const wave = Math.sin(cycle * Math.PI * 2);
      const x = pill.x + wave * pill.drift;
      const y = -90 + cycle * fallSpan;
      const rotation = pill.rotation + cycle * 360 * pill.turns;
      const transform = `translate(${round(x)} ${round(y)}) rotate(${round(rotation)})`;
      if (xanaxImageDataUri) {
        return [
          `<g transform="${transform}" opacity="${pill.opacity}">`,
          `<image href="${escapeXml(xanaxImageDataUri)}" x="${-pill.size / 2}" y="${-pill.size / 2}" width="${pill.size}" height="${pill.size}" preserveAspectRatio="xMidYMid meet"/>`,
          "</g>",
        ].join("");
      }
      return renderFallbackPill(transform, pill.size, pill.opacity);
    })
    .join("");
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
      return renderFallbackPill(transform, sprinkle.size, sprinkle.opacity);
    })
    .join("");
}

function renderFallbackPill(transform: string, size: number, opacity: number): string {
  return [
    `<g transform="${transform}" opacity="${opacity}">`,
    `<rect x="${-size / 2}" y="${-size / 6}" width="${size}" height="${size / 3}" rx="${size / 6}" fill="#22c55e"/>`,
    `<line x1="0" y1="${-size / 6}" x2="0" y2="${size / 6}" stroke="#f8fafc" stroke-width="2"/>`,
    "</g>",
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

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
