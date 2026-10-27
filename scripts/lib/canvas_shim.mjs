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
// The PNG is written by the repo's own codec rather than taken from a library:
// the encoder is small, dependency-free and lets the build script control the
// bytes it puts in the .glb, which matters because the asset has a hard
// file-size budget. It lives in png.mjs now, next to the decoder the publish
// step uses, and is re-exported here so the build scripts keep their import.
import { encodePng } from "./png.mjs";

export { encodePng };

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
