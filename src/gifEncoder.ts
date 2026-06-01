export type GifFrame = {
  width: number;
  height: number;
  pixels: Uint8Array;
  delayMs: number;
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
  writer.bytes(buildRgb332Palette());
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
    writeSubBlocks(writer, lzwEncode(indexFrameRgb332(frame.pixels), GIF_LZW_MIN_CODE_SIZE));
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

function indexFrameRgb332(pixels: Uint8Array): Uint8Array {
  const indexed = new Uint8Array(pixels.length / 4);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    indexed[target] = rgb332Index(pixels[source], pixels[source + 1], pixels[source + 2]);
  }
  return indexed;
}

function rgb332Index(red: number, green: number, blue: number): number {
  return ((red >> 5) << 5) | ((green >> 5) << 2) | (blue >> 6);
}

function buildRgb332Palette(): Uint8Array {
  const palette = new Uint8Array(GIF_PALETTE_SIZE * 3);
  for (let index = 0; index < GIF_PALETTE_SIZE; index += 1) {
    const red = (index >> 5) & 0x07;
    const green = (index >> 2) & 0x07;
    const blue = index & 0x03;
    palette[index * 3] = Math.round((red / 7) * 255);
    palette[index * 3 + 1] = Math.round((green / 7) * 255);
    palette[index * 3 + 2] = Math.round((blue / 3) * 255);
  }
  return palette;
}

function lzwEncode(indexedPixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;
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
    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      writer.write(clearCode, codeSize);
      dictionary = createLzwDictionary();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = value;
  }

  writer.write(prefix, codeSize);
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
