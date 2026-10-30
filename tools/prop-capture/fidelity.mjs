// Does the model still look like the approved art?
//
// The comparison is between two silhouettes: the model's, as it is rendered,
// and the turnaround sheet's front tile, which is the prop seen from the
// front. The sheet is the art the model was built from, so a model that has
// drifted away from it - a bat that came back the wrong way up, a chair that
// lost its arms - scores badly here.
//
// The comparison is about the shape only. A model's material is lit and the
// art is painted, so their colours cannot be compared to a number, and a
// check that cried wolf over that would be turned off.
//
// It lives here rather than in the capture page so that it can be tested
// without a browser: a mask and the same mask turned over are the case that
// matters, and the case that is easy to get wrong.

export const SILHOUETTE_SIZE = 256;

/**
 * A mask cropped to its object and stretched to a square, so two silhouettes
 * can be compared whatever their size and aspect.
 */
export function normalise(mask, width, height) {
  const out = new Uint8Array(SILHOUETTE_SIZE * SILHOUETTE_SIZE);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return out;
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  for (let y = 0; y < SILHOUETTE_SIZE; y++) {
    const sourceY = minY + Math.floor((y * cropHeight) / SILHOUETTE_SIZE);
    for (let x = 0; x < SILHOUETTE_SIZE; x++) {
      const sourceX = minX + Math.floor((x * cropWidth) / SILHOUETTE_SIZE);
      out[y * SILHOUETTE_SIZE + x] = mask[sourceY * width + sourceX];
    }
  }
  return out;
}

/** A mask turned over, top to bottom. */
export function flipVertically(mask) {
  const side = SILHOUETTE_SIZE;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < side; y++) {
    const from = (side - 1 - y) * side;
    out.set(mask.subarray(from, from + side), y * side);
  }
  return out;
}

/** How much of the two silhouettes is the same. */
export function overlap(a, b) {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] | b[i]) union++;
    if (a[i] & b[i]) intersection++;
  }
  return union ? intersection / union : 0;
}

/**
 * The two scores the capture's check is made of.
 *
 * `straight` is the render against the sheet as the sheet has it, and
 * `flipped` is the render against the sheet turned over. A render that is the
 * art the wrong way up scores better the second time round, and that is the
 * failure the check is for.
 */
export function score(model, art) {
  const round = (value) => Math.round(value * 1000) / 1000;
  return {
    straight: round(overlap(model, art)),
    flipped: round(overlap(model, flipVertically(art))),
  };
}
