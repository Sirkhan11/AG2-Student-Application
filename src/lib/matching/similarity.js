/**
 * Cosine similarity for two normalised vectors: 1 = same meaning, near 0 = unrelated.
 * @param {number[]} a
 * @param {number[]} b
 */
export function similarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}