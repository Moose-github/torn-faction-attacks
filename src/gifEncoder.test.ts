import { describe, expect, it } from "vitest";
import { encodeAnimatedGif, GifFrame } from "./gifEncoder";

describe("encodeAnimatedGif", () => {
  it("writes LZW streams that stay valid across code-size boundaries", () => {
    const frame = patternedFrame(64, 12);
    const gif = encodeAnimatedGif([frame]);

    expect(decodeGifFramePixelCounts(gif)).toEqual([frame.width * frame.height]);
  });
});

function patternedFrame(width: number, height: number): GifFrame {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = (index * 47) & 0xff;
    pixels[offset + 1] = (index * 91) & 0xff;
    pixels[offset + 2] = (index * 137) & 0xff;
    pixels[offset + 3] = 255;
  }
  return { width, height, pixels, delayMs: 200 };
}

function decodeGifFramePixelCounts(gif: Uint8Array): number[] {
  let offset = 0;
  const readByte = () => gif[offset++];
  const readShort = () => {
    const value = gif[offset] | (gif[offset + 1] << 8);
    offset += 2;
    return value;
  };
  const readSubBlocks = () => {
    const chunks: number[] = [];
    let length = readByte();
    while (length > 0) {
      chunks.push(...gif.subarray(offset, offset + length));
      offset += length;
      length = readByte();
    }
    return Uint8Array.from(chunks);
  };
  const skipSubBlocks = () => {
    let length = readByte();
    while (length > 0) {
      offset += length;
      length = readByte();
    }
  };

  expect(String.fromCharCode(...gif.subarray(0, 6))).toBe("GIF89a");
  offset = 6;
  readShort();
  readShort();
  const packed = readByte();
  readByte();
  readByte();
  if ((packed & 0x80) !== 0) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
  }

  const framePixelCounts: number[] = [];
  while (offset < gif.length) {
    const marker = readByte();
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      readByte();
      skipSubBlocks();
      continue;
    }
    expect(marker).toBe(0x2c);
    readShort();
    readShort();
    const width = readShort();
    const height = readShort();
    const imagePacked = readByte();
    if ((imagePacked & 0x80) !== 0) {
      offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    }
    const minCodeSize = readByte();
    framePixelCounts.push(decodeLzwPixelCount(readSubBlocks(), minCodeSize, width * height));
  }
  return framePixelCounts;
}

function decodeLzwPixelCount(data: Uint8Array, minCodeSize: number, expectedPixels: number): number {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let bitOffset = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = createInitialDictionary(clearCode);
  let previousCode: number | null = null;
  let pixelCount = 0;

  const readCode = () => {
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      code |= (((data[bitOffset >> 3] ?? 0) >> (bitOffset & 7)) & 1) << bit;
      bitOffset += 1;
    }
    return code;
  };

  while (true) {
    const code = readCode();
    if (code === clearCode) {
      dictionary = createInitialDictionary(clearCode);
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
      previousCode = null;
      continue;
    }
    if (code === endCode) {
      return pixelCount;
    }

    const entry = dictionary[code] ?? (
      code === nextCode && previousCode !== null
        ? [...dictionary[previousCode], dictionary[previousCode][0]]
        : null
    );
    if (!entry) {
      throw new Error(`Invalid GIF LZW code ${code} with next code ${nextCode}`);
    }
    pixelCount += entry.length;
    expect(pixelCount).toBeLessThanOrEqual(expectedPixels);

    if (previousCode !== null) {
      dictionary[nextCode] = [...dictionary[previousCode], entry[0]];
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    }
    previousCode = code;
  }
}

function createInitialDictionary(clearCode: number): number[][] {
  const dictionary: number[][] = [];
  for (let code = 0; code < clearCode; code += 1) {
    dictionary[code] = [code];
  }
  return dictionary;
}
