export type GifFrame = {
  width: number;
  height: number;
  pixels: Uint8Array;
  delayMs: number;
  matte?: {
    red: number;
    green: number;
    blue: number;
  };
};

const GIF_COLOR_DEPTH = 8;
const GIF_PALETTE_SIZE = 256;
const GIF_LZW_MIN_CODE_SIZE = 8;

export function encodeAnimatedGif(frames: GifFrame[], options: { loopCount?: number } = {}): Uint8Array {
  if (frames.length === 0) {
    throw new Error("Animated GIF requires at least one frame");
  }

  const width = frames[0].width;
  const height = frames[0].height;
  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("Animated GIF frames must all have the same dimensions");
    }
    if (frame.pixels.length !== width * height * 4) {
      throw new Error("Animated GIF frame pixels must be RGBA data");
    }
  }

  const writer = new ByteWriter();
  writer.ascii("GIF89a");
  writer.u16(width);
  writer.u16(height);
  writer.u8(0x80 | ((GIF_COLOR_DEPTH - 1) << 4) | (GIF_COLOR_DEPTH - 1));
  writer.u8(0);
  writer.u8(0);
  writer.bytes(buildWebSafeAndGrayscalePalette());
  writeLoopExtension(writer, options.loopCount ?? 0);

  for (const frame of frames) {
    writeGraphicControlExtension(writer, Math.max(1, Math.round(frame.delayMs / 10)));
    writer.u8(0x2c);
    writer.u16(0);
    writer.u16(0);
    writer.u16(width);
    writer.u16(height);
    writer.u8(0);
    writer.u8(GIF_LZW_MIN_CODE_SIZE);
    writeSubBlocks(writer, lzwEncode(indexFramePalette(frame), GIF_LZW_MIN_CODE_SIZE));
  }

  writer.u8(0x3b);
  return writer.toUint8Array();
}

function writeLoopExtension(writer: ByteWriter, loopCount: number): void {
  writer.u8(0x21);
  writer.u8(0xff);
  writer.u8(11);
  writer.ascii("NETSCAPE2.0");
  writer.u8(3);
  writer.u8(1);
  writer.u16(loopCount);
  writer.u8(0);
}

function writeGraphicControlExtension(writer: ByteWriter, delayCs: number): void {
  writer.u8(0x21);
  writer.u8(0xf9);
  writer.u8(4);
  writer.u8(0x04);
  writer.u16(delayCs);
  writer.u8(0);
  writer.u8(0);
}

function writeSubBlocks(writer: ByteWriter, data: Uint8Array): void {
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, Math.min(offset + 255, data.length));
    writer.u8(chunk.length);
    writer.bytes(chunk);
  }
  writer.u8(0);
}

function indexFramePalette(frame: GifFrame): Uint8Array {
  const pixels = frame.pixels;
  const matte = frame.matte ?? { red: 248, green: 250, blue: 252 };
  const indexed = new Uint8Array(pixels.length / 4);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    const alpha = pixels[source + 3];
    if (alpha === 255) {
      indexed[target] = paletteIndex(pixels[source], pixels[source + 1], pixels[source + 2]);
    } else {
      indexed[target] = paletteIndex(
        compositeChannel(pixels[source], matte.red, alpha),
        compositeChannel(pixels[source + 1], matte.green, alpha),
        compositeChannel(pixels[source + 2], matte.blue, alpha),
      );
    }
  }
  return indexed;
}

function compositeChannel(source: number, backdrop: number, alpha: number): number {
  return Math.round((source * alpha + backdrop * (255 - alpha)) / 255);
}

function paletteIndex(red: number, green: number, blue: number): number {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max - min <= 18) {
    return 216 + clamp(Math.round(((red + green + blue) / 3 / 255) * 39), 0, 39);
  }

  const redIndex = clamp(Math.round(red / 51), 0, 5);
  const greenIndex = clamp(Math.round(green / 51), 0, 5);
  const blueIndex = clamp(Math.round(blue / 51), 0, 5);
  return redIndex * 36 + greenIndex * 6 + blueIndex;
}

function buildWebSafeAndGrayscalePalette(): Uint8Array {
  const palette = new Uint8Array(GIF_PALETTE_SIZE * 3);
  let offset = 0;
  for (let red = 0; red < 6; red += 1) {
    for (let green = 0; green < 6; green += 1) {
      for (let blue = 0; blue < 6; blue += 1) {
        palette[offset] = red * 51;
        palette[offset + 1] = green * 51;
        palette[offset + 2] = blue * 51;
        offset += 3;
      }
    }
  }
  for (let gray = 0; gray < 40; gray += 1) {
    const value = Math.round((gray / 39) * 255);
    palette[offset] = value;
    palette[offset + 1] = value;
    palette[offset + 2] = value;
    offset += 3;
  }
  return palette;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lzwEncode(indexedPixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;
  let pendingCodeSizeIncrease = false;
  let dictionary = createLzwDictionary();
  const writer = new LzwBitWriter();

  writer.write(clearCode, codeSize);
  let prefix = indexedPixels[0];
  for (let index = 1; index < indexedPixels.length; index += 1) {
    const value = indexedPixels[index];
    const key = `${prefix},${value}`;
    const code = dictionary.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }

    writer.write(prefix, codeSize);
    if (pendingCodeSizeIncrease) {
      codeSize += 1;
      pendingCodeSizeIncrease = false;
    }
    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        pendingCodeSizeIncrease = true;
      }
    } else {
      writer.write(clearCode, codeSize);
      dictionary = createLzwDictionary();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
      pendingCodeSizeIncrease = false;
    }
    prefix = value;
  }

  writer.write(prefix, codeSize);
  if (pendingCodeSizeIncrease) {
    codeSize += 1;
  }
  writer.write(endCode, codeSize);
  return writer.finish();
}

function createLzwDictionary(): Map<string, number> {
  return new Map();
}

class LzwBitWriter {
  private bytes: number[] = [];
  private buffer = 0;
  private bitCount = 0;

  write(code: number, bitLength: number): void {
    this.buffer |= code << this.bitCount;
    this.bitCount += bitLength;
    while (this.bitCount >= 8) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer >>= 8;
      this.bitCount -= 8;
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.bytes.push(this.buffer & 0xff);
    }
    return Uint8Array.from(this.bytes);
  }
}

class ByteWriter {
  private output: number[] = [];

  u8(value: number): void {
    this.output.push(value & 0xff);
  }

  u16(value: number): void {
    this.u8(value);
    this.u8(value >> 8);
  }

  ascii(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      this.u8(value.charCodeAt(index));
    }
  }

  bytes(value: Uint8Array): void {
    for (const byte of value) {
      this.u8(byte);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.output);
  }
}
