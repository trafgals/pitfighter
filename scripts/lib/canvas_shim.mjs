// A minimal PNG encoder and a canvas shim, so three.js's GLTFExporter can
// embed textures when it runs in Node.
//
// GLTFExporter writes textures through the browser canvas API: it draws the
// texture's pixels into a canvas and then reads the canvas back as a PNG blob.
// Node has no canvas. Rather than give up on textures (which is what makes a
// prop look like leather and brass instead of flat plastic), this module
// provides the small slice of the DOM that the exporter actually touches:
//
//   document.createElement('canvas') -> a canvas that stores one ImageData
//   ImageData                       -> the pixel container the exporter builds
//   canvas.toBlob(cb, type)         -> encodes that ImageData as a real PNG
//
// The PNG is written here rather than taken from a library: the encoder is
// small, dependency-free and lets the build script control the bytes it puts
// in the .glb, which matters because the asset has a hard file-size budget.
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
 * Encode RGBA pixels as a PNG.
 * Rows are filtered with the Paeth predictor, which compresses the smooth
 * gradients in a leather grain far better than no filtering at all.
 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const out = y * (stride + 1);
    raw[out] = 4; // Paeth
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = rgba[row + x];
      const left = x >= 4 ? rgba[row + x - 4] : 0;
      const up = y > 0 ? rgba[prev + x] : 0;
      const upLeft = y > 0 && x >= 4 ? rgba[prev + x - 4] : 0;
      raw[out + 1 + x] = (value - paeth(left, up, upLeft)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
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
 * Install the small DOM surface GLTFExporter needs.
 * Safe to call more than once; a second call is a no-op.
 */
export function installCanvasShim() {
  if (globalThis.document?.__pitfighterShim) return;

  class ShimImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }

  class ShimCanvas {
    constructor() {
      this.width = 1;
      this.height = 1;
      this.pixels = null;
      this._flipY = false;
    }

    getContext() {
      const canvas = this;
      return {
        // The exporter only ever translates and mirrors vertically before it
        // hands over the pixels, so the transform is tracked as a flip flag.
        translate(_x, _y) {
          return this;
        },
        scale(x, y) {
          if (x === 1 && y === -1) canvas._flipY = !canvas._flipY;
          return this;
        },
        putImageData(imageData) {
          const { data, width, height } = imageData;
          const out = new Uint8ClampedArray(width * height * 4);
          if (canvas._flipY) {
            for (let y = 0; y < height; y++) {
              const src = (height - 1 - y) * width * 4;
              out.set(data.subarray(src, src + width * 4), y * width * 4);
            }
          } else {
            out.set(data);
          }
          canvas.pixels = { data: out, width, height };
        },
        drawImage() {
          return this;
        },
      };
    }

    toBlob(callback, type) {
      if (!this.pixels) {
        callback(new Blob([Buffer.alloc(0)], { type: type || "application/octet-stream" }));
        return;
      }
      const { data, width, height } = this.pixels;
      const png = encodePng(width, height, data);
      callback(new Blob([png], { type: type || "image/png" }));
    }

    toDataURL(type) {
      if (!this.pixels) return "data:,";
      const { data, width, height } = this.pixels;
      return `data:${type || "image/png"};base64,${encodePng(width, height, data).toString("base64")}`;
    }
  }

  globalThis.ImageData = ShimImageData;
  // GLTFExporter reads an embedded image back through FileReader.
  globalThis.FileReader = class ShimFileReader {
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          if (this.onloadend) this.onloadend({ target: this });
        })
        .catch((error) => {
          if (this.onerror) this.onerror(error);
        });
    }
  };
  globalThis.document = {
    __pitfighterShim: true,
    createElement(tag) {
      if (tag !== "canvas") throw new Error(`canvas shim: unsupported element "${tag}"`);
      return new ShimCanvas();
    },
  };
}
