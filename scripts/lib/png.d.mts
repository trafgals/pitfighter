// The repo's minimal PNG codec, as the TypeScript side sees it.
//
// The codec itself is JavaScript, because the build scripts are; this file
// exists so the test can import it with types instead of reaching into it
// blind.
export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel. */
  data: Uint8Array;
  /** True when every pixel is fully opaque. */
  opaque: boolean;
}

/** Encode 8-bit pixels as a PNG. Four channels is RGBA, three is RGB. */
export declare function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array | Uint8ClampedArray,
  channels?: number,
): Buffer;

/** Read a PNG back as RGBA pixels. */
export declare function decodePng(buffer: Buffer | Uint8Array): DecodedPng;

/** Resize RGBA pixels with a separable Lanczos-3 resample. */
export declare function resizeRgba(
  source: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8ClampedArray;

/** Read a PNG, resize it and write it back out. */
export declare function resizePng(buffer: Buffer | Uint8Array, width: number, height: number): Buffer;
