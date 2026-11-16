import { createUserWithEmailAndPassword, deleteUser, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';
import { questions } from './questions.js';
import { embedAnswers } from './match.js';

/** all-MiniLM-L6-v2 (see embed.js) turns each answer into 384 numbers. */
const VECTOR_LENGTH = 384;

/**
 * What a mentor fills in on the sign-up form, apart from their login.
 * @typedef {{ displayName: string, name: string, course: string, answers: string[],
 *   meetingFrequency: string, availability: string, maxStudents: number }} MentorProfile
 */

/**
 * Finds the first answer that's empty or only spaces, and returns its position (or -1 if every answer has text).
 * The browser's `required` check accepts "   ", so this is what actually stops blank answers.
 * @param {string[]} answers
 */
export function findBlankAnswer(answers) {
  return answers.findIndex((answer) => answer.trim() === '');
}

/**
 * Signs up a new mentor: embeds their answers, creates their login, then saves their profile in two parts:
 * - mentors/{uid} is public: only what matching needs. Signed-in users can read it once the mentor is approved.
 * - mentorDetails/{uid} is private: only the mentor can read it (the coordinator uses the Firebase console).
 * The email isn't saved in either, because Firebase Auth already has it.
 *
 * Embedding goes first because it's the slow step that's most likely to fail (the model downloads the
 * first time). If it fails, no account exists yet. If saving fails after the account is made, the account
 * is deleted again. Either way, the mentor can retry with the same email.
 * New mentors start unapproved, so the coordinator can check them before they're matched.
 * @param {MentorProfile} profile
 * @param {{ email: string, password: string }} login kept apart from the profile, so it can't be saved by mistake
 */
export async function registerMentor(profile, login) {
  const answers = profile.answers.map((answer) => answer.trim());
  // Safety net: the page checks this first, but blank answers must never be saved, whoever calls this.
  if (findBlankAnswer(answers) !== -1) throw new Error('Every answer needs some text.');

  const vectors = await embedAnswers(answers);
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), login.email, login.password);

  // A batch saves both documents together: either both are written or neither is.
  // Every field is named one by one (no ...profile), so nothing lands in the public document by accident.
  const batch = writeBatch(db);
  batch.set(doc(db, 'mentors', user.uid), {
    displayName: profile.displayName.trim(),
    // Firestore can't store a list of lists, so each answer's vector gets its own key (q1 to q6)
    vectors: Object.fromEntries(vectors.map((vector, i) => [`q${i + 1}`, vector])),
    approved: false,
    maxStudents: profile.maxStudents
  });
  batch.set(doc(db, 'mentorDetails', user.uid), {
    name: profile.name.trim(),
    course: profile.course.trim(),
    answers,
    meetingFrequency: profile.meetingFrequency,
    availability: profile.availability.trim(),
    createdAt: serverTimestamp()
  });

  try {
    await batch.commit();
  } catch (err) {
    // The account exists but its profile doesn't, so remove the account and let the mentor start again.
    // Deleting also signs them out. If the delete fails too, log that, but still report the original problem.
    await deleteUser(user).catch((deleteErr) =>
      console.error('Could not remove the account after the profile failed to save:', deleteErr)
    );
    throw err;
  }
}

/**
 * Loads every approved mentor, in the shape rankMentors expects: id, name to show, and one vector per question.
 * Only the public mentors/{uid} documents are read; students can't see anything in mentorDetails.
 * The vectors were worked out when the mentor signed up, so nothing is re-embedded here.
 * The query must ask for approved == true: the Firestore rules refuse any list of mentors without it.
 * Needs a signed-in user, because the rules don't let logged-out visitors read mentors.
 * @returns {Promise<{ id: string, name: string, vectors: number[][] }[]>}
 */
export async function loadApprovedMentors() {
  const snapshot = await getDocs(query(collection(db, 'mentors'), where('approved', '==', true)));

  // TODO(capacity): every mentor has maxStudents, but nothing stores matches yet, so there's no way to count
  // how many students they already have. Once matches are saved, leave out mentors who are full here.

  /** @type {{ id: string, name: string, vectors: number[][] }[]} */
  const mentors = [];
  for (const mentorDoc of snapshot.docs) {
    const data = mentorDoc.data();
    // Turn q1 to q6 back into a list in question order, so vectors[0] goes with questions[0], and so on.
    const vectors = questions.map((_, i) => data.vectors?.[`q${i + 1}`]);
    // A missing or wrong-sized vector would crash or skew rankMentors, so skip that mentor and say why.
    if (vectors.some((vector) => !Array.isArray(vector) || vector.length !== VECTOR_LENGTH)) {
      console.warn(`Skipping mentor ${mentorDoc.id}: their stored vectors don't match the questions.`);
      continue;
    }
    mentors.push({ id: mentorDoc.id, name: data.displayName, vectors });
  }
  return mentors;
}

/**
 * Tells the page whether someone is signed in: once Firebase has checked for a saved login, and again
 * whenever someone signs in or out. Returns a function that stops listening.
 * It's here because reading mentors is the thing that needs a signed-in user.
 * @param {(signedIn: boolean) => void} callback
 * @returns {() => void}
 */
export function watchSignedIn(callback) {
  return onAuthStateChanged(getFirebaseAuth(), (user) => callback(user !== null));
}
