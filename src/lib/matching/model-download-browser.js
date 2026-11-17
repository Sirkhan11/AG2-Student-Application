// Getting the matching model before Find my mentor needs it, in the browser: the rules in
// model-download.js, with the phone's data saver, the page settling, the student's record in
// Firestore, and embed.js.

import { downloadModel, loadModel, MATCHING_MODEL, modelLoaded } from '#lib/matching/embed.js';
import { loadMyMatch } from '#lib/matching/matches.js';
import { hasMentorProfile } from '#lib/matching/mentor-account.js';
import { DOWNLOADED_KEY, downloadInBackground, modelIsReady, readyForMatching, SETTLE_MS } from '#lib/matching/model-download.js';

/** Whether the phone's data saver is on. Chrome on Android says; other browsers don't, so it's taken as off. */
const saveDataOn = () => /** @type {{ connection?: { saveData?: boolean } }} */ (navigator).connection?.saveData === true;

/** Whether this browser has downloaded the model before. */
function downloadedBefore() {
  try {
    return localStorage.getItem(DOWNLOADED_KEY) === MATCHING_MODEL;
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(DOWNLOADED_KEY, MATCHING_MODEL);
  } catch {
    // Storage is blocked (some private windows): the background download just runs again next time.
  }
}

/**
 * Resolves once the page has loaded and gone quiet: SETTLE_MS after the load event, at the
 * browser's next idle moment (Safari has no idle callback, so straight after the wait there).
 * @returns {Promise<void>}
 */
function whenSettled() {
  return new Promise((resolve) => {
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(() => resolve(), { timeout: 2000 }) : resolve());
    const afterLoad = () => setTimeout(idle, SETTLE_MS);
    if (document.readyState === 'complete') afterLoad();
    else addEventListener('load', afterLoad, { once: true });
  });
}

/** The accounts the background download has been tried for in this tab, so it's tried once each. */
const tried = new Set();

/**
 * After logging in, or coming back still logged in: a student without a mentor downloads the model
 * in the background (see model-download.js).
 * @param {string} uid the signed-in account
 */
export function downloadAfterLogin(uid) {
  if (tried.has(uid)) return;
  tried.add(uid);
  void downloadInBackground({
    saveData: saveDataOn(),
    downloadedBefore: downloadedBefore(),
    settled: whenSettled,
    mightMatch: async () => {
      const [isMentor, match] = await Promise.all([hasMentorProfile(), loadMyMatch()]);
      return !isMentor && !match;
    },
    download: downloadModel,
    remember
  });
}

/** A student has started finding a mentor (the Find a mentor page's questions, or Start in the chat). */
export function getReadyForMatching() {
  void readyForMatching({ saveData: saveDataOn(), settled: whenSettled, load: loadModel, remember });
}

/** Whether Find my mentor can say just "Finding your mentor…", without the note about the download. */
export const modelReady = () => modelIsReady({ loaded: modelLoaded(), downloadedBefore: downloadedBefore() });
