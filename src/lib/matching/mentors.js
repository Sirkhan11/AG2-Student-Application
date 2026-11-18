import { createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';
import { sendVerification } from '#lib/firebase/verify.js';
import { saveMentor } from '#lib/signup/finish.js';
import { waitingSignUp } from '#lib/signup/waiting.js';
import { isAllowedEmail } from '#lib/access.js';
import { notUniEmail } from '#lib/uni-email.js';
import { questions } from '#lib/matching/questions.js';
import { findBlankAnswer } from '#lib/matching/answers.js';
import { hasMentorProfile } from '#lib/matching/mentor-account.js';
import { MAX_WANTS, summariseAnswers } from '#lib/matching/summarise.js';
import { summaryToSave } from '#lib/matching/summary-prompt.js';
import { embedSummaries } from '#lib/matching/compare-items.js';

/** all-MiniLM-L6-v2 (see embed.js) turns each phrase into 384 numbers. */
const VECTOR_LENGTH = 384;

/** Error code for when Gemini found nothing to match a mentor on in any of their answers. */
export const NOTHING_TO_MATCH = 'matching/nothing-to-match';

/**
 * What a mentor fills in on the sign-up form, apart from their login.
 * @typedef {{ displayName: string, name: string, course: string, answers: string[],
 *   meetingFrequency: string, availability: string, maxStudents: number }} MentorProfile
 */

/**
 * True for a whole number from 1 to 5, the only values firestore.rules accepts for maxStudents.
 * @param {unknown} value
 */
export function isValidMaxStudents(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 1 && /** @type {number} */ (value) <= 5;
}

// findBlankAnswer lives in answers.js (no Firebase there, so the checks can use it); kept here too.
export { findBlankAnswer };

/**
 * Puts one value per question under the keys q1 to q6, because Firestore can't store a list of lists.
 * @template T
 * @param {T[]} perQuestion
 * @returns {Record<string, T>}
 */
function byQuestion(perQuestion) {
  return Object.fromEntries(perQuestion.map((value, i) => [`q${i + 1}`, value]));
}

/*
 * How item vectors are stored in mentors/{uid}.itemVectors
 *
 * Each mentor has up to 30 vectors (up to 5 phrases for each of 6 questions), but Firestore can't
 * store a list of lists. So each question gets its own key, q1 to q6, holding that question's
 * vectors back to back in ONE flat list of numbers: the first phrase's 384 numbers, then the
 * second's, and so on. A question with 2 phrases holds 768 numbers; an empty summary holds [].
 *
 * Why this shape:
 * - firestore.rules can check it in one line per question: a whole number of 384-number vectors,
 *   and no more than 5 of them. That enforces the 5-phrase cap on the server, so a mentor can't
 *   store extra phrases to match more students.
 * - The nth vector goes with the nth phrase in mentorDetails/{uid}.summaries.likes, for explaining matches.
 * - The field is called itemVectors, not vectors, so a profile in the old format (one whole-answer
 *   vector per question) can never be mistaken for one phrase per question.
 */

/**
 * Packs one question's item vectors into a single flat list (see the note above).
 * @param {number[][]} items
 * @returns {number[]}
 */
function packItems(items) {
  return items.flat();
}

/**
 * Undoes packItems. Returns null if the list isn't a whole number of 384-number vectors, or holds
 * more than MAX_WANTS of them, so a damaged or old-format profile is skipped instead of mis-scored.
 * @param {unknown} list
 * @returns {number[][] | null}
 */
function unpackItems(list) {
  if (!Array.isArray(list) || list.length % VECTOR_LENGTH !== 0) return null;
  if (list.length > VECTOR_LENGTH * MAX_WANTS || !list.every((n) => typeof n === 'number')) return null;
  const items = [];
  for (let start = 0; start < list.length; start += VECTOR_LENGTH) {
    items.push(list.slice(start, start + VECTOR_LENGTH));
  }
  return items;
}

/**
 * A mentor's two documents, as they're saved (saveMentor in signup/finish.js adds createdAt):
 * - mentors/{uid} is public: only what matching needs (display name, item vectors, approval, capacity).
 *   Signed-in users can read it once the mentor is approved.
 * - mentorDetails/{uid} is private: only the mentor can read it (the coordinator uses the Firebase console).
 *   It keeps the written answers and Gemini's summaries, for explaining matches later.
 * The email isn't saved in either, because Firebase Auth already has it. Every field is named one by
 * one (no ...profile), so nothing lands in the public document by accident.
 * @param {MentorProfile} profile
 * @param {string[]} answers trimmed
 * @param {Awaited<ReturnType<typeof summariseAnswers>>} summary
 * @param {number[][][]} itemVectors
 */
export function mentorDocuments(profile, answers, summary, itemVectors) {
  return {
    profile: {
      displayName: profile.displayName.trim(),
      itemVectors: byQuestion(itemVectors.map(packItems)),
      approved: false,
      maxStudents: profile.maxStudents,
      // How many of their places are taken. Only a student taking a place can add to it (see
      // matches.js and firestore.rules); the coordinator corrects it in the console if a match ends.
      studentCount: 0
    },
    details: {
      name: profile.name.trim(),
      course: profile.course.trim(),
      answers,
      // What Gemini picked out: likes (in the same order as the vectors), avoids and styles. Private
      // for now: students only see a summary once the mentor has agreed to it (not built yet).
      summaries: summaryToSave(summary),
      meetingFrequency: profile.meetingFrequency,
      availability: profile.availability.trim()
    }
  };
}

/**
 * Signs up a mentor: summarises and embeds their answers, then
 * - with a login (a new account): makes the account, which signs them in, and sends the email that
 *   verifies their address. firestore.rules only let a verified Northumbria account write anything,
 *   so the profile waits in this tab (signup/waiting.js) until they've clicked the link, and
 *   finishSignUp then saves it. The address must be a Northumbria one (any address while the access
 *   switch is off: access.js), checked before Gemini runs.
 * - without one (login null): saves the profile to the signed-in, verified account straight away.
 *   That's for a mentor whose waiting profile was lost (they closed the tab before verifying).
 *
 * Gemini and the embedding model both run before the account exists, because they're the steps most
 * likely to fail (rate limits, the first model download). If either fails, there's no account to tidy
 * up and the mentor can simply try again. New mentors start unapproved, so the coordinator can check
 * them before they're matched.
 *
 * Errors to expect: code NOT_UNI_EMAIL (uni-email.js) for another address, SUMMARISE_FAILED (from
 * summarise.js) if Gemini fails, NOTHING_TO_MATCH if Gemini found nothing in any answer, and Firebase
 * Auth codes such as 'auth/email-already-in-use'.
 * @param {MentorProfile} profile
 * @param {{ email: string, password: string, uniOnly?: boolean | null } | null} login kept apart from
 *   the profile, so it can't be saved by mistake, with the access switch's position as the page read
 *   it (uniOnly left out: Northumbria only); null to use the signed-in account
 * @param {import('#lib/signup/waiting.js').WaitingStore} [waiting]
 * @returns {Promise<'verify-email' | 'saved'>} what happens next: check their inbox, or nothing (saved)
 */
export async function registerMentor(profile, login, waiting = waitingSignUp()) {
  if (login && !isAllowedEmail(login.email, login.uniOnly)) throw notUniEmail();
  const answers = profile.answers.map((answer) => answer.trim());
  // Safety nets: the page checks these first, but bad values must never be saved, whoever calls this.
  if (findBlankAnswer(answers) !== -1) throw new Error('Every answer needs some text.');
  if (!isValidMaxStudents(profile.maxStudents)) throw new Error('maxStudents must be a whole number from 1 to 5.');

  const summary = await summariseAnswers(answers);
  // Every question would be skipped, so this mentor could never be matched with anyone.
  if (summary.likes.every((items) => items.length === 0)) {
    throw Object.assign(new Error('Gemini found nothing to match on in any answer.'), { code: NOTHING_TO_MATCH });
  }
  // Only likes are embedded. Avoids and styles are saved but never turned into vectors.
  const itemVectors = await embedSummaries(summary.likes);
  const mentor = mentorDocuments(profile, answers, summary, itemVectors);

  if (!login) {
    const user = getFirebaseAuth().currentUser;
    if (!user?.emailVerified) throw new Error('Log in with your verified Northumbria account first.');
    await saveMentor(db, user.uid, mentor);
    return 'saved';
  }
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), login.email.trim(), login.password);
  waiting.save({ uid: user.uid, mentor });
  // If the email can't be sent, the check-your-inbox screen has Resend.
  await sendVerification(user).catch((err) => console.error('Sending the verification email failed:', err?.code ?? err));
  return 'verify-email';
}

/**
 * Loads every approved mentor with a place free, in the shape rankMentors expects: id, name to show,
 * and one list of item vectors per question. Only the public mentors/{uid} documents are read;
 * students can't see anything in mentorDetails. The vectors were worked out at sign-up, so nothing is
 * re-embedded here. The query must ask for approved == true: the Firestore rules refuse any list of
 * mentors without it. Needs a signed-in user, because the rules don't let logged-out visitors read mentors.
 *
 * Leaving full mentors out here keeps them out of the ranking, but it's the rules that actually stop
 * a full mentor being matched: a mentor can fill up between loading and saving (see takePlace).
 * @returns {Promise<import('#lib/matching/match.js').MatchableMentor[]>}
 */
export async function loadApprovedMentors() {
  const snapshot = await getDocs(query(collection(db, 'mentors'), where('approved', '==', true)));

  /** @type {import('#lib/matching/match.js').MatchableMentor[]} */
  const mentors = [];
  for (const mentorDoc of snapshot.docs) {
    const data = mentorDoc.data();
    // Without a studentCount the rules refuse every place, so a profile made before capacity existed
    // can't be matched until the coordinator adds one in the console.
    if (typeof data.studentCount !== 'number') {
      console.warn(`Skipping mentor ${mentorDoc.id}: no studentCount yet (add it in the console).`);
      continue;
    }
    if (data.studentCount >= data.maxStudents) continue; // full

    // Turn q1 to q6 back into a list in question order, so itemVectors[0] goes with questions[0], and so on.
    const itemVectors = questions.map((_, i) => unpackItems(data.itemVectors?.[`q${i + 1}`]));
    // A missing or damaged question would crash or skew rankMentors, so skip that mentor and say why.
    // Profiles saved in the old format (whole-answer `vectors`) end up here too.
    if (itemVectors.some((items) => items === null)) {
      console.warn(`Skipping mentor ${mentorDoc.id}: no item vectors in the current format (old sign-up?).`);
      continue;
    }
    mentors.push({
      id: mentorDoc.id,
      name: data.displayName,
      itemVectors: /** @type {number[][][]} */ (itemVectors)
    });
  }
  return mentors;
}

// hasMentorProfile lives in mentor-account.js (light, so the chat can use it); kept here too.
export { hasMentorProfile };
