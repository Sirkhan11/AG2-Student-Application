// When to get the matching model (embed.js) before Find my mentor needs it, so students don't wait
// the minute it can take to download the first time:
// - After logging in, or coming back still logged in, a student without a mentor downloads it in the
//   background once the page has settled. It's then let go from memory and kept only in the
//   browser's cache, so a student who isn't matching today doesn't carry it. Once this browser has
//   it, later visits don't download it again.
// - Opening the Find a mentor page, or starting the questions in the chat, loads it, so it's ready
//   by the time they finish.
// None of this happens while the phone's data saver is on. If it fails, nothing is said: Find my
// mentor downloads it then, as before, and only then says the first time can take a minute.
// The first download is about 29 MB (the model 23 MB, the ONNX runtime 5.6 MB and the tokenizer),
// from Hugging Face and jsDelivr.
// These are the rules, with everything they need passed in, so the checks can run them in Node. The
// browser's side (data saver, the page settling, Firestore) is in model-download-browser.js.

/** Remembers, in this browser, that it has downloaded the model, so the background download isn't repeated. */
export const DOWNLOADED_KEY = 'ag2-matching-model';

/** How long after the page has loaded before the background download starts (then at the browser's next idle moment). */
export const SETTLE_MS = 3000;

/**
 * The background download after logging in. Returns what happened, for the checks: the student
 * never sees any of it.
 * @param {{ saveData: boolean, downloadedBefore: boolean, settled: () => Promise<void>,
 *   mightMatch: () => Promise<boolean>, download: () => Promise<void>, remember: () => void }} env
 *   saveData: the phone's data saver is on; downloadedBefore: this browser has the model already;
 *   settled: waits for the page to settle; mightMatch: they're a student with no mentor and no
 *   request with the coordinator; download: downloads it for later; remember: notes that this
 *   browser has it
 * @returns {Promise<'data-saver' | 'downloaded-before' | 'has-mentor' | 'downloaded' | 'failed'>}
 */
export async function downloadInBackground({ saveData, downloadedBefore, settled, mightMatch, download, remember }) {
  if (saveData) return 'data-saver';
  if (downloadedBefore) return 'downloaded-before';
  await settled();
  try {
    if (!(await mightMatch())) return 'has-mentor';
    await download();
    remember();
    return 'downloaded';
  } catch {
    // Nothing is said: Find my mentor downloads it instead.
    return 'failed';
  }
}

/**
 * Getting it ready as a student starts finding a mentor (the Find a mentor page's questions, or
 * Start in the chat): it's loaded and kept, so it's ready by Find my mentor.
 * @param {{ saveData: boolean, settled: () => Promise<void>, load: () => Promise<void>, remember: () => void }} env
 * @returns {Promise<'data-saver' | 'loaded' | 'failed'>}
 */
export async function readyForMatching({ saveData, settled, load, remember }) {
  if (saveData) return 'data-saver';
  await settled();
  try {
    await load();
    remember();
    return 'loaded';
  } catch {
    return 'failed';
  }
}

/**
 * Whether Find my mentor can leave out the note that the first time can take a minute: the model
 * is loaded, or this browser has downloaded it before.
 * @param {{ loaded: boolean, downloadedBefore: boolean }} model
 */
export const modelIsReady = ({ loaded, downloadedBefore }) => loaded || downloadedBefore;
