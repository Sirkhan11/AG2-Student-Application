/** @type {Promise<any> | undefined} */
let extractorPromise;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    );
  }
  return extractorPromise;
}

/**
 * Turns a piece of text into a list of 384 numbers (a vector).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}