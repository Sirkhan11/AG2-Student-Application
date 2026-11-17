import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { checkedChangeRequest } from '#lib/matching/change-reasons.js';

// A student's request for a different mentor, at mentorChangeRequests/{their uid}: one open request
// each. firestore.rules lets only that student send, read and cancel (delete) it, and only while they
// have a mentor; the coordinator reads it in the Firebase console and deletes it once they've moved
// the student. Nothing else in the app reads it (not the chat, not the mentor's side). Firestore is
// passed in, so check-mentor-change.mjs runs these against the emulator with the real rules.

/** The collection the requests live in. */
export const CHANGE_REQUESTS = 'mentorChangeRequests';

/** @typedef {{ reason: string, details: string, sentAt: Date | null }} ChangeRequest */

/**
 * Sends the request. Throws an Error with a message to show if it isn't filled in properly, or
 * Firebase's error ('permission-denied' if one is already open, or they have no mentor).
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid the signed-in student
 * @param {string} reason
 * @param {string} details
 */
export async function sendChangeRequest(db, uid, reason, details) {
  await setDoc(doc(db, CHANGE_REQUESTS, uid), { ...checkedChangeRequest(reason, details), createdAt: serverTimestamp() });
}

/**
 * The student's open request, or null.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @returns {Promise<ChangeRequest | null>}
 */
export async function loadChangeRequest(db, uid) {
  const snapshot = await getDoc(doc(db, CHANGE_REQUESTS, uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    reason: typeof data.reason === 'string' ? data.reason : '',
    details: typeof data.details === 'string' ? data.details : '',
    sentAt: typeof data.createdAt?.toDate === 'function' ? data.createdAt.toDate() : null
  };
}

/**
 * Cancels the student's open request (it's deleted, so they can send another later).
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 */
export function cancelChangeRequest(db, uid) {
  return deleteDoc(doc(db, CHANGE_REQUESTS, uid));
}
