// The matching model: it turns a phrase into a list of numbers (a vector), so phrases can be compared.
// It's Xenova/all-MiniLM-L6-v2, run by transformers.js. The first time, the browser downloads it (about
// 29 MB: the model, the ONNX runtime and the tokenizer) and keeps it for later visits.
// model-download.js gets it before Find my mentor needs it.
//
// On a page, the model loads and runs in a worker (embed.worker.js), because loading it is close to a
// second of solid work that froze Home when it ran on the page. The page only sends text and gets the
// numbers back. In Node (the checks) and inside that worker, it runs right here. If the worker can't
// run, the page runs the model itself, as it used to.

/** The model on Hugging Face. */
export const MATCHING_MODEL = 'Xenova/all-MiniLM-L6-v2';

// ---------- The model itself: in Node, in the worker, or on the page if the worker can't run ----------

/** The model, once it's loading or loaded, so every call shares one download. */
/** @type {Promise<any> | undefined} */
let extractorPromise;
/** Whether it's loaded and held in memory now. */
let loaded = false;
/** Whether matching wants it kept in memory (it's about to use it), not just downloaded for later. */
let keep = false;

function getExtractor() {
  if (!extractorPromise) {
    const loading = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline('feature-extraction', MATCHING_MODEL))
      .then((extractor) => {
        if (extractorPromise === loading) loaded = true;
        return extractor;
      })
      .catch((err) => {
        // A failed promise stays failed, so forget it: the next call then starts a fresh download
        // instead of getting this same failure back until the page is reloaded.
        if (extractorPromise === loading) extractorPromise = undefined;
        throw err;
      });
    extractorPromise = loading;
  }
  return extractorPromise;
}

/** @param {string} text @returns {Promise<number[]>} */
async function embedHere(text) {
  keep = true;
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function loadHere() {
  keep = true;
  await getExtractor();
}

async function downloadHere() {
  const loading = getExtractor();
  const extractor = await loading;
  if (keep || extractorPromise !== loading) return;
  extractorPromise = undefined;
  loaded = false;
  await extractor.dispose?.();
}

// ---------- On a page: the worker ----------

/** Whether this is a page (not Node, and not the worker itself), so the model runs in a worker. */
const onPage = typeof window !== 'undefined' && typeof Worker === 'function';

/** @typedef {'download' | 'load' | 'embed'} CallType */
/** @typedef {{ type: CallType, text: string, resolve: (value: any) => void, reject: (err: Error) => void }} Call */

/** The worker, while it's running. @type {Worker | null} */
let worker = null;
/** Calls waiting for the worker's answer, by id. @type {Map<number, Call>} */
const waiting = new Map();
let lastId = 0;
/** Whether the worker has the model loaded. */
let workerLoaded = false;
/** Whether the page wants the worker kept (matching has started), not just the model downloaded. */
let keepWorker = false;
/** Set if the worker couldn't run: the page then runs the model itself from then on. */
let noWorker = false;

/** Runs a call on the page instead. @param {CallType} type @param {string} text */
const runHere = (type, text) => (type === 'embed' ? embedHere(text) : type === 'load' ? loadHere() : downloadHere());

function startWorker() {
  const started = new Worker(new URL('./embed.worker.js', import.meta.url), { type: 'module' });
  started.onmessage = ({ data }) => {
    const call = waiting.get(data.id);
    if (!call) return;
    waiting.delete(data.id);
    if (data.ok) {
      workerLoaded = true;
      call.resolve(data.vector);
    } else {
      call.reject(new Error(data.message));
    }
  };
  // The worker itself failed (it couldn't start, say): the page runs the model from now on,
  // including the calls that were waiting.
  started.onerror = (event) => {
    event.preventDefault();
    noWorker = true;
    stopWorker();
    const calls = [...waiting.values()];
    waiting.clear();
    for (const call of calls) runHere(call.type, call.text).then(call.resolve, call.reject);
  };
  return started;
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  workerLoaded = false;
}

/** Sends a call to the worker, starting it if needed, and waits for its answer. @param {CallType} type @param {string} [text] */
function inWorker(type, text = '') {
  if (noWorker) return runHere(type, text);
  const running = (worker ??= startWorker());
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { type, text, resolve, reject });
    running.postMessage({ id, type, text });
  });
}

// ---------- What the rest of the app uses ----------

/**
 * Turns a piece of text into a list of 384 numbers (a vector).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export function embed(text) {
  if (!onPage) return embedHere(text);
  keepWorker = true;
  return inWorker('embed', text);
}

/**
 * Loads the model now for a student who has started finding a mentor, so it's ready by Find my
 * mentor. It then stays loaded (about 75 MB of memory) until the tab closes. Downloads it the first
 * time, sharing the download with any other call.
 * @returns {Promise<void>}
 */
export async function loadModel() {
  if (!onPage) return loadHere();
  keepWorker = true;
  await inWorker('load');
}

/**
 * Downloads the model for later, then lets it go so it doesn't hold memory (about 75 MB) while the
 * student isn't matching: on a page, by stopping the worker. The browser keeps the files, so loading
 * it later takes a moment rather than a download. If matching asks for it meanwhile, it stays loaded.
 * @returns {Promise<void>}
 */
export async function downloadModel() {
  if (!onPage) return downloadHere();
  await inWorker('download');
  if (!keepWorker && !noWorker && waiting.size === 0) stopWorker();
}

/** Whether the model is loaded and held in memory now, so matching won't wait for it. */
export const modelLoaded = () => (onPage && !noWorker ? workerLoaded : loaded);
