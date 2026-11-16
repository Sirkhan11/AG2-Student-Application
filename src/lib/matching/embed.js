/** The model, once it's loading or loaded, so every call shares one download. */
/** @type {Promise<any> | undefined} */
let extractorPromise;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'))
      .catch((err) => {
        // A failed promise stays failed, so forget it: the next call then starts a fresh download
        // instead of getting this same failure back until the page is reloaded.
        extractorPromise = undefined;
        throw err;
      });
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