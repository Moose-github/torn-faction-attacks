export type PngColor = number;

export type PngCanvas = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DEFLATE_BLOCK_SIZE = 65535;

export const SIMPLE_PNG_PALETTE = [
  [248, 250, 252],
  [15, 23, 42],
  [255, 255, 255],
  [203, 213, 225],
  [226, 232, 240],
  [71, 85, 105],
  [51, 65, 85],
  [219, 228, 238],
  [37, 99, 235],
  [220, 38, 38],
  [241, 245, 249],
  [30, 41, 59],
  [191, 219, 254],
  [254, 202, 202],
] as const;

export const SIMPLE_PNG_COLORS = {
  page: 0,
  dark: 1,
  white: 2,
  mutedOnDark: 3,
  soft: 4,
  muted: 5,
  text: 6,
  border: 7,
  blue: 8,
  red: 9,
  alternate: 10,
  header: 11,
  blueSoft: 12,
  redSoft: 13,
} as const;

export function createPngCanvas(width: number, height: number, background: PngColor): PngCanvas {
  const canvas = { width, height, pixels: new Uint8Array(width * height) };
  canvas.pixels.fill(background);
  return canvas;
}

export function fillRect(
  canvas: PngCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  color: PngColor,
): void {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(canvas.width, Math.ceil(x + width));
  const endY = Math.min(canvas.height, Math.ceil(y + height));
  for (let row = startY; row < endY; row += 1) {
    canvas.pixels.fill(color, row * canvas.width + startX, row * canvas.width + endX);
  }
}

export function strokeRect(
  canvas: PngCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  color: PngColor,
): void {
  fillRect(canvas, x, y, width, 1, color);
  fillRect(canvas, x, y + height - 1, width, 1, color);
  fillRect(canvas, x, y, 1, height, color);
  fillRect(canvas, x + width - 1, y, 1, height, color);
}

export function drawText(
  canvas: PngCanvas,
  x: number,
  y: number,
  text: string,
  color: PngColor,
  options: { scale?: number; maxWidth?: number } = {},
): void {
  const scale = options.scale ?? 2;
  const value = options.maxWidth ? truncateText(text, options.maxWidth, scale) : text;
  let cursorX = Math.floor(x);
  const cursorY = Math.floor(y);
  for (const char of normalizeText(value)) {
    const glyph = FONT[char] ?? FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") {
          continue;
        }
        fillRect(canvas, cursorX + col * scale, cursorY + row * scale, scale, scale, color);
      }
    }
    cursorX += 6 * scale;
  }
}

export function measureText(text: string, scale = 2): number {
  return normalizeText(text).length * 6 * scale;
}

export function truncateText(text: string, maxWidth: number, scale = 2): string {
  if (measureText(text, scale) <= maxWidth) {
    return text;
  }
  const ellipsis = "...";
  const maxChars = Math.max(0, Math.floor(maxWidth / (6 * scale)) - ellipsis.length);
  return `${text.slice(0, maxChars)}${ellipsis}`;
}

export function encodePng(canvas: PngCanvas): Uint8Array {
  const scanlineLength = canvas.width + 1;
  const filtered = new Uint8Array(scanlineLength * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const targetOffset = y * scanlineLength;
    filtered[targetOffset] = 0;
    filtered.set(canvas.pixels.subarray(y * canvas.width, (y + 1) * canvas.width), targetOffset + 1);
  }

  const idatData = zlibStore(filtered);
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr(canvas.width, canvas.height)),
    pngChunk("PLTE", paletteBytes()),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function normalizeText(text: string): string {
  return text.toUpperCase().replace(/[^\x20-\x7E]/g, " ");
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 3;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function paletteBytes(): Uint8Array {
  const data = new Uint8Array(SIMPLE_PNG_PALETTE.length * 3);
  SIMPLE_PNG_PALETTE.forEach((rgb, index) => {
    data[index * 3] = rgb[0];
    data[index * 3 + 1] = rgb[1];
    data[index * 3 + 2] = rgb[2];
  });
  return data;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockLength = Math.min(MAX_DEFLATE_BLOCK_SIZE, remaining);
    const isFinal = offset + blockLength >= data.length;
    const block = new Uint8Array(5 + blockLength);
    block[0] = isFinal ? 1 : 0;
    block[1] = blockLength & 0xff;
    block[2] = (blockLength >> 8) & 0xff;
    const nlen = blockLength ^ 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >> 8) & 0xff;
    block.set(data.subarray(offset, offset + blockLength), 5);
    blocks.push(block);
    offset += blockLength;
  }

  const adler = adler32(data);
  const checksum = new Uint8Array(4);
  writeUint32(checksum, 0, adler);
  blocks.push(checksum);
  return concatBytes(blocks);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return chunk;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function writeUint32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const FONT: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "01010"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00100", "01000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "11100"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01110"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  "J": ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};
