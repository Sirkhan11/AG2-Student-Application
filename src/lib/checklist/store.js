import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';
import { applyToLatest, CHECKLIST_FIELD, ChecklistError, defaultTasks, readSaved } from '#lib/checklist/tasks.js';

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/** @typedef {import('#lib/checklist/tasks.js').Change} Change */
/** @typedef {import('#lib/checklist/sync.js').SaveResult} SaveResult */

/** How long to wait for the server before treating a save as offline. */
const OFFLINE_AFTER_MS = 10_000;

/** The signed-in student's record, students/{uid}. Only they can read or write it (firestore.rules). */
function myRecord() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new ChecklistError('You need to be logged in.');
  return doc(db, 'students', user.uid);
}

/**
 * Loads the signed-in student's checklist. Someone who has never changed it gets the defaults, which
 * aren't saved until they change something.
 * @returns {Promise<Task[]>}
 */
export async function loadChecklist() {
  const saved = (await getDoc(myRecord())).data()?.[CHECKLIST_FIELD];
  return readSaved(saved) ?? defaultTasks();
}

/** True for errors that mean "couldn't reach the server" rather than "the server said no". */
function isOffline(/** @type {unknown} */ err) {
  const code = /** @type {{ code?: string }} */ (err).code;
  return code === 'unavailable' || code === 'deadline-exceeded' || code === 'offline-timeout';
}

/**
 * Saves one change.
 *
 * Online, it runs a transaction that applies the change to the LATEST saved list (applyToLatest in
 * tasks.js). So if this device's copy is out of date, a change made on another device is kept
 * rather than wiped.
 *
 * Offline, transactions can't run, so it falls back to queueing the whole list on screen, which
 * Firestore sends once the device is back online. That fallback can still overwrite a change made
 * on another device in the meantime, which is the one case where an edit can be lost.
 *
 * Other errors (for example the rules refusing the write) are thrown, so the page can offer Try again.
 * @param {Change} change
 * @param {Task[]} listOnScreen
 * @returns {Promise<SaveResult>}
 */
export async function saveChange(change, listOnScreen) {
  const ref = myRecord();
  try {
    const list = await withTimeout(runTransaction(db, (transaction) => applyToLatest(transaction, ref, change)));
    return { status: 'saved', list };
  } catch (err) {
    if (!isOffline(err)) throw err;
    // Queued in this browser until it's back online. The promise resolves once the server has it.
    const synced = setDoc(ref, { [CHECKLIST_FIELD]: listOnScreen }, { merge: true });
    synced.catch((syncErr) => console.error('The queued checklist save failed:', syncErr));
    return { status: 'queued', synced };
  }
}

/**
 * Gives up waiting after OFFLINE_AFTER_MS, as a transaction can hang rather than fail on a bad
 * connection. The transaction may still finish afterwards; it only ever applies the same change.
 * @template T
 * @param {Promise<T>} promise
 * @returns {Promise<T>}
 */
function withTimeout(promise) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('No reply from the server.'), { code: 'offline-timeout' })), OFFLINE_AFTER_MS);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout]).finally(() => clearTimeout(timer)));
}
