import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

// A mentor's email address, shared with the students matched with them only if the mentor agrees:
// when they sign up (Become a mentor), or later on their Your mentor page, where they can also stop
// sharing it. It's their own login address and nothing else (firestore.rules check it against their
// sign-in), kept at mentorContacts/{mentor uid} with when they agreed. Only the mentor, and the
// students whose match names them, can read it.
// Students see it on Your mentor, Home and the chat's mentor card (MentorContact.svelte); without it,
// the coordinator introduces them, as before. Gemini never sees it: none of the chat's own code reads
// it, and the card in the chat loads it itself (check-mentor-contact.mjs checks both).
// Firestore is passed in, so the checks can run these against the emulator with the real rules.

/** Where shared contacts are kept, one per mentor, under their uid. */
export const MENTOR_CONTACTS = 'mentorContacts';

/**
 * A mentor's shared contact, as the students matched with them see it.
 * @typedef {{ email: string }} MentorContact
 */

/**
 * The record that shares an address: the address, and when they agreed (the server's time).
 * @param {string} email the mentor's login address, as Firebase Authentication has it
 */
export function contactToSave(email) {
  return { email, agreedAt: serverTimestamp() };
}

/**
 * A new mentor's documents (mentorDocuments in mentors.js) with the address to share with their
 * students, only if they ticked the box at sign-up; saveMentor (signup/finish.js) saves it with them.
 * It's the account's own address, as Firebase Authentication has it, which is what the rules check.
 * @template {object} T
 * @param {T} mentor
 * @param {boolean | undefined} share
 * @param {string | null | undefined} email
 * @returns {T & { contact?: { email: string } }}
 */
export function withContact(mentor, share, email) {
  return share === true && email ? { ...mentor, contact: { email } } : mentor;
}

/**
 * Shares the signed-in mentor's login address with the students matched with them.
 * @param {import('firebase/firestore').Firestore} db
 * @param {{ uid: string, email: string | null }} user the signed-in mentor
 */
export async function shareMyEmail(db, user) {
  if (!user.email) throw new Error('This account has no email address to share.');
  await setDoc(doc(db, MENTOR_CONTACTS, user.uid), contactToSave(user.email));
}

/**
 * Stops sharing it: the record goes, so their students see "your coordinator will introduce you" again.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid the signed-in mentor's
 */
export async function stopSharing(db, uid) {
  await deleteDoc(doc(db, MENTOR_CONTACTS, uid));
}

/**
 * What the signed-in mentor shares now: the address and when they agreed, or null if nothing.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid the signed-in mentor's
 * @returns {Promise<{ email: string, agreedAt: Date | null } | null>}
 */
export async function loadMySharing(db, uid) {
  const data = (await getDoc(doc(db, MENTOR_CONTACTS, uid))).data();
  if (typeof data?.email !== 'string') return null;
  return { email: data.email, agreedAt: typeof data.agreedAt?.toDate === 'function' ? data.agreedAt.toDate() : null };
}

/**
 * How a matched student can reach their mentor: the address the mentor shared, or null when there's
 * none (the mentor didn't share one, the student isn't matched, or it can't be read just now), and
 * then the coordinator introduces them. A failure is logged, not thrown: the card still shows the rest.
 * @param {import('firebase/firestore').Firestore} db
 * @param {import('#lib/matching/matches.js').Match | null | undefined} match the student's own
 * @returns {Promise<MentorContact | null>}
 */
export async function loadMentorContact(db, match) {
  if (match?.status !== 'matched' || !match.mentorId) return null;
  try {
    const email = (await getDoc(doc(db, MENTOR_CONTACTS, match.mentorId))).data()?.email;
    return typeof email === 'string' && email.includes('@') ? { email } : null;
  } catch (err) {
    console.error('Loading the mentor’s contact failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
    return null;
  }
}

/**
 * The link that opens their email app with the mentor's address filled in. The address is encoded
 * (all but its at sign), so nothing in it can add a subject, a copy or another address.
 * @param {string} email
 */
export const mailtoHref = (email) => `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`;
