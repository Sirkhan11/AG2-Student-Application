import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

// Saving what a sign-up made, once the account is allowed to write: the student's record, or the
// mentor's two documents. Firestore is passed in, so check-uni-rules.mjs runs this against the
// emulator with the real rules.

/**
 * Saves a mentor's two documents together: either both are written or neither is. mentors/{uid} is
 * public (only what matching needs) and mentorDetails/{uid} is private (see registerMentor).
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {{ profile: Record<string, unknown>, details: Record<string, unknown> }} mentor
 */
export async function saveMentor(db, uid, mentor) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'mentors', uid), mentor.profile);
  batch.set(doc(db, 'mentorDetails', uid), { ...mentor.details, createdAt: serverTimestamp() });
  await batch.commit();
}

/**
 * Saves the sign-up that waited for this account's email to be verified, if there is one, then
 * forgets it. The student's record is merged, so a checklist saved meanwhile (on another device) is
 * kept. If saving fails, Firebase's error is thrown and the sign-up keeps waiting, to try again.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid the signed-in account, now verified
 * @param {import('./waiting.js').WaitingStore} waiting
 * @returns {Promise<'student' | 'mentor' | null>} what was saved (null: nothing waited for this account)
 */
export async function finishSignUp(db, uid, waiting) {
  const entry = waiting.load();
  if (!entry || entry.uid !== uid) return null;
  if (entry.student) await setDoc(doc(db, 'students', uid), entry.student, { merge: true });
  if (entry.mentor) await saveMentor(db, uid, entry.mentor);
  waiting.clear();
  return entry.mentor ? 'mentor' : 'student';
}
