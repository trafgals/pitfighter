// A minimal PNG codec.
//
// Two halves of the format live here, and neither needs a dependency:
//
//   encodePng - writes the textures a .glb carries. GLTFExporter writes them
//     through the browser canvas API, and Node has no canvas, so the bytes
//     are produced here instead.
//
//   decodePng + resizePng - read a PNG back and resize it. This is what lets
//     the verification renders be put into the repository at the size a
//     reviewer opens them at, using the repo's own code rather than a tool
//     outside the repo.
//
// The encoder used to live in canvas_shim.mjs, next to the DOM shim it serves.
// It lives here now because a codec is a codec: the shim borrows the encoder,
// and the publish step borrows the decoder.
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/**
 * Encode 8-bit pixels as a PNG.
 *
 * `pixels` holds `channels` bytes per pixel: four for RGBA, three for RGB.
 * Rows are filtered with the Paeth predictor, which compresses the smooth
 * gradients in a leather grain far better than no filtering at all.
 */
export function encodePng(width, height, pixels, channels = 4) {
  if (channels !== 3 && channels !== 4) throw new Error(`encodePng: ${channels} channels is not supported`);
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const out = y * (stride + 1);
    raw[out] = 4; // Paeth
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = pixels[row + x];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[prev + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[prev + x - channels] : 0;
      raw[out + 1 + x] = (value - paeth(left, up, upLeft)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type: RGBA or RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Read a PNG back as RGBA pixels.
 *
 * The colour types a browser screenshot actually comes in - grey, RGB, grey
 * with alpha, RGBA - are all handled, at 8 and 16 bits per sample. A palette
 * is handled at 8 bits. Anything else is refused with a message rather than
 * decoded wrongly.
 */
export function decodePng(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) throw new Error("decodePng: not a PNG");
  }

  let offset = 8;
  let header = null;
  let palette = null;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
  }
  if (!header) throw new Error("decodePng: the PNG has no header");
  if (header.interlace !== 0) throw new Error("decodePng: interlaced PNGs are not supported");

  const { width, height, bitDepth, colourType } = header;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`decodePng: colour type ${colourType} is not supported`);
  if (colourType === 3 && bitDepth !== 8) throw new Error("decodePng: only 8-bit palettes are supported");
  if (colourType !== 3 && bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`decodePng: ${bitDepth} bits per sample is not supported`);
  }

  const sampleBytes = bitDepth / 8;
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const bpp = Math.max(1, channels * sampleBytes);
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // Undo the per-row filters into one flat image.
  const flat = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[pos + x];
      const a = x >= bpp ? flat[row + x - bpp] : 0;
      const b = y > 0 ? flat[prev + x] : 0;
      const c = x >= bpp && y > 0 ? flat[prev + x - bpp] : 0;
      let result;
      switch (filter) {
        case 0: result = value; break;
        case 1: result = value + a; break;
        case 2: result = value + b; break;
        case 3: result = value + ((a + b) >> 1); break;
        case 4: result = value + paeth(a, b, c); break;
        default: throw new Error(`decodePng: unknown row filter ${filter}`);
      }
      flat[row + x] = result & 0xff;
    }
    pos += stride;
  }

  // Flatten whatever the file had into RGBA, which is what the resampler
  // works in.
  const data = new Uint8Array(width * height * 4);
  let opaque = true;
  for (let i = 0; i < width * height; i++) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colourType === 0 || colourType === 4) {
      const grey = flat[i * channels * sampleBytes];
      r = grey;
      g = grey;
      b = grey;
      if (colourType === 4) a = flat[i * channels * sampleBytes + sampleBytes];
    } else if (colourType === 2 || colourType === 6) {
      const o = i * channels * sampleBytes;
      r = flat[o];
      g = flat[o + sampleBytes];
      b = flat[o + sampleBytes * 2];
      if (colourType === 6) a = flat[o + sampleBytes * 3];
    } else {
      const index = flat[i];
      if (!palette) throw new Error("decodePng: the PNG has a palette it does not carry");
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
    }
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = a;
    if (a !== 255) opaque = false;
  }
  return { width, height, data, opaque };
}

/**
 * The Lanczos-3 kernel.
 *
 * Three lobes either side of the centre: the kernel is zero at 3 and has the
 * ringing a sharp downscale needs to keep an edge from turning to mush.
 */
function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (Math.sin(px) / px) * (Math.sin(px / 3) / (px / 3));
}

/**
 * The weights one output pixel is made of.
 *
 * The kernel is stretched by the scale factor, so a downscale averages over a
 * wider part of the source and an upscale does not blur. The centre of an
 * output pixel maps to the middle of the source pixel it covers, which is what
 * keeps a half-pixel shift out of the result.
 */
function contributions(srcSize, dstSize) {
  const scale = dstSize / srcSize;
  const filterScale = Math.max(1, 1 / scale);
  const support = 3 * filterScale;
  const table = [];
  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const indices = [];
    const weights = [];
    let total = 0;
    for (let j = Math.ceil(center - support); j <= Math.floor(center + support); j++) {
      const weight = lanczos((j - center) / filterScale);
      if (weight === 0) continue;
      indices.push(Math.min(srcSize - 1, Math.max(0, j)));
      weights.push(weight);
      total += weight;
    }
    if (!indices.length) {
      const clamped = Math.min(srcSize - 1, Math.max(0, Math.round(center)));
      indices.push(clamped);
      weights.push(1);
      total = 1;
    }
    for (let k = 0; k < weights.length; k++) weights[k] /= total;
    table.push({ indices, weights });
  }
  return table;
}

/**
 * Resize RGBA pixels with a separable Lanczos-3 resample.
 *
 * The two passes keep the cost at O(pixels) rather than O(pixels * kernel),
 * and the intermediate is kept in floating point: an 8-bit intermediate would
 * round twice and the second rounding is the one that shows.
 */
export function resizeRgba(source, srcWidth, srcHeight, dstWidth, dstHeight) {
  const horizontal = contributions(srcWidth, dstWidth);
  const vertical = contributions(srcHeight, dstHeight);

  const intermediate = new Float32Array(dstWidth * srcHeight * 4);
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const { indices, weights } = horizontal[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < indices.length; k++) {
        const weight = weights[k];
        const o = (y * srcWidth + indices[k]) * 4;
        r += weight * source[o];
        g += weight * source[o + 1];
        b += weight * source[o + 2];
        a += weight * source[o + 3];
      }
      const o = (y * dstWidth + x) * 4;
      intermediate[o] = r;
      intermediate[o + 1] = g;
      intermediate[o + 2] = b;
      intermediate[o + 3] = a;
    }
  }

  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  for (let y = 0; y < dstHeight; y++) {
    const { indices, weights } = vertical[y];
    for (let x = 0; x < dstWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < indices.length; k++) {
        const weight = weights[k];
        const o = (indices[k] * dstWidth + x) * 4;
        r += weight * intermediate[o];
        g += weight * intermediate[o + 1];
        b += weight * intermediate[o + 2];
        a += weight * intermediate[o + 3];
      }
      const o = (y * dstWidth + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/**
 * Read a PNG, resize it and write it back out.
 *
 * An image with no alpha of its own is written as RGB, because that is what
 * the renders in the repository are and a reviewer should not see the format
 * change in the file they open.
 */
export function resizePng(buffer, width, height) {
  const image = decodePng(buffer);
  const pixels = resizeRgba(image.data, image.width, image.height, width, height);
  const rgb = new Uint8Array(width * height * 3);
  let alpha = 255;
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = pixels[i * 4];
    rgb[i * 3 + 1] = pixels[i * 4 + 1];
    rgb[i * 3 + 2] = pixels[i * 4 + 2];
    if (pixels[i * 4 + 3] !== 255) alpha = 0;
  }
  return encodePng(width, height, rgb, alpha === 255 ? 3 : 4);
}
