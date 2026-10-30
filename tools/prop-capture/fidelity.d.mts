// The types of the fidelity module, so a test can import it and be checked.
//
// The module itself is plain JavaScript because the capture page runs it in
// the browser without a build step of its own.
export const SILHOUETTE_SIZE: number;

export function normalise(mask: Uint8Array, width: number, height: number): Uint8Array;

export function flipVertically(mask: Uint8Array): Uint8Array;

export function overlap(a: Uint8Array, b: Uint8Array): number;

export function score(model: Uint8Array, art: Uint8Array): { straight: number; flipped: number };
