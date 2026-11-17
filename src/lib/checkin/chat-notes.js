// Saving and deleting the things a student asked the check-in chat to remember (remember-notes.js).
// They're one document, chatNotes/{uid}: { notes: [{ text, savedAt }] }. Only that student can read,
// change or delete it, with at most MAX_NOTES notes of at most MAX_NOTE_LENGTH characters each
// (firestore.rules). Saving reads and writes in one transaction, so two tabs can't go over the limit.
// The database and the student's uid are passed in (the app passes its own), so the checks can run
// these against the Firestore emulator.

import { deleteDoc, doc, getDoc, runTransaction, Timestamp } from 'firebase/firestore';
import { withNote, withoutNote } from '#lib/checkin/remember-notes.js';

/** @typedef {import('#lib/checkin/remember-notes.js').SavedNote} SavedNote */
/** @typedef {import('firebase/firestore').Firestore} Firestore */

/** @param {Firestore} db @param {string} uid */
const notesOf = (db, uid) => doc(db, 'chatNotes', uid);

/**
 * The notes in a saved document, oldest first, ignoring anything that isn't one.
 * @param {unknown} data
 * @returns {SavedNote[]}
 */
function notesIn(data) {
  const notes = /** @type {{ notes?: unknown } | undefined} */ (data)?.notes;
  return Array.isArray(notes) ? notes.filter((note) => typeof note?.text === 'string') : [];
}

/**
 * The student's notes, oldest first.
 * @param {Firestore} db
 * @param {string} uid
 * @returns {Promise<SavedNote[]>}
 */
export async function loadMyNotes(db, uid) {
  return notesIn((await getDoc(notesOf(db, uid))).data());
}

/**
 * Saves a note from the chat's card (only ever after the student taps Remember). Returns 'saved', or
 * why it wasn't: already there, no room, or never remembered (see withNote).
 * @param {Firestore} db
 * @param {string} uid
 * @param {string} text
 * @returns {Promise<'saved' | 'exists' | 'full' | import('#lib/checkin/remember-notes.js').ScreenReason>}
 */
export async function rememberNote(db, uid, text) {
  const ref = notesOf(db, uid);
  return runTransaction(db, async (transaction) => {
    const result = withNote(notesIn((await transaction.get(ref)).data()), text, Timestamp.now());
    if ('refused' in result) return result.refused;
    transaction.set(ref, { notes: result.notes });
    return 'saved';
  });
}

/**
 * Deletes one note.
 * @param {Firestore} db
 * @param {string} uid
 * @param {SavedNote} note as loadMyNotes gave it
 */
export async function forgetNote(db, uid, note) {
  const ref = notesOf(db, uid);
  await runTransaction(db, async (transaction) => {
    const notes = notesIn((await transaction.get(ref)).data());
    const left = withoutNote(notes, note);
    if (left.length === notes.length) return;
    if (left.length === 0) transaction.delete(ref);
    else transaction.set(ref, { notes: left });
  });
}

/**
 * Deletes every note: the document goes.
 * @param {Firestore} db
 * @param {string} uid
 */
export async function forgetAllNotes(db, uid) {
  await deleteDoc(notesOf(db, uid));
}
