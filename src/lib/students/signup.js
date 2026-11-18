import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { sendVerification } from '#lib/firebase/verify.js';
import { isAllowedEmail } from '#lib/access.js';
import { studentTypeFrom } from '#lib/students/student-type.js';
import { notUniEmail } from '#lib/uni-email.js';

// A new student's account and record, as the sign-up page (/signup) makes them in two steps, like the
// group's wireframe: the account (email and password), then about you (name, home or international,
// arrival date, course, interests, and whether they'd like a mentor). Only a Northumbria address is
// accepted (any address while the access switch is off: access.js), and the record waits until the
// address is verified (firestore.rules only let a verified account the switch lets in write anything):
// see signup/waiting.js and signup/finish.js. If the details were lost (the tab closed before
// verifying), or the account is from before the about-you questions, Home asks for them (needsDetails)
// and the sign-up page saves them to the signed-in account (loadStudentDetails, saveStudentDetails).
// Firebase is passed in rather than taken from client.js (which only works in the browser), so the
// checks can run it against the emulators.

/** A password must be at least this long. The rule is shown before they type. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Interests to pick from on the sign-up page ("What are you into? Pick a few"), with a box to add
 * their own. Each is an everyday word the chat's suggestions understand (suggestions/everyday-words.js),
 * so picking it gives the chat societies, clubs and services to suggest: check-sign-up.mjs checks.
 */
export const INTEREST_CHOICES = Object.freeze(['Football', 'Gym', 'Running', 'Climbing', 'Gaming', 'Music', 'Films', 'Dance', 'Art', 'Reading', 'Volunteering', 'Nights out']);

/** At most this many interests, each at most this long: what the chat is told (tidyProfile in checkin/about-you.js). */
export const MAX_INTERESTS = 10;
export const MAX_INTEREST_LENGTH = 40;
/** The longest name and course the page takes. */
export const MAX_NAME_LENGTH = 100;
export const MAX_COURSE_LENGTH = 80;

/**
 * What a student gives on the sign-up page. interests: the words they picked or added (or, from the
 * old one-page form, a comma list as typed); studentType: 'home' or 'international'; wantsMentor:
 * whether they ticked "Match me with a mentor".
 * @typedef {{ name: string, email: string, course: string, interests: string[] | string, arrivalDate: string,
 *   studentType?: string, wantsMentor?: boolean }} StudentDetails
 */

/**
 * Interests as the record keeps them: trimmed words, with blanks and repeats (in any capitals) dropped,
 * at most MAX_INTERESTS of at most MAX_INTEREST_LENGTH characters each.
 * @param {string[] | string | null | undefined} given
 * @returns {string[]}
 */
export function tidyInterests(given) {
  const raw = Array.isArray(given) ? given : typeof given === 'string' ? given.split(',') : [];
  /** @type {string[]} */
  const kept = [];
  for (const item of raw) {
    const word = String(item ?? '').trim().slice(0, MAX_INTEREST_LENGTH).trim();
    if (word && !kept.some((known) => known.toLowerCase() === word.toLowerCase())) kept.push(word);
  }
  return kept.slice(0, MAX_INTERESTS);
}

/**
 * The record saved at students/{uid} when a student signs up. Only these fields are saved, whatever
 * else is passed in: studentType only when it's one of the two answers, and wantsMentor as true or
 * false.
 * @param {StudentDetails} details
 */
export function studentRecord({ name, email, course, interests, arrivalDate, studentType, wantsMentor }) {
  const type = studentTypeFrom(studentType);
  return {
    name,
    email,
    course,
    interests: tidyInterests(interests),
    arrivalDate,
    role: 'student',
    ...(type ? { studentType: type } : {}),
    wantsMentor: wantsMentor === true
  };
}

/**
 * What's wrong with the account step, or null: the password rule, and the two passwords matching.
 * (The page checks the address against the access switch itself, with the forms' message.)
 * @param {{ password: string, confirm: string }} account
 */
export function accountProblem({ password, confirm }) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password !== confirm) return 'The two passwords don’t match.';
  return null;
}

/**
 * What's wrong with the about-you step, or null: a name, home or international, a course, none too
 * long, and not too many interests. The browser checks the required boxes first; this is the safety
 * net, and the message for anything it lets through.
 * @param {{ name: string, studentType: string, course: string, interests: string[] }} about
 */
export function aboutYouProblem({ name, studentType, course, interests }) {
  if (!name.trim()) return 'Please tell us your name.';
  if (name.trim().length > MAX_NAME_LENGTH) return `Your name can be at most ${MAX_NAME_LENGTH} characters.`;
  if (!studentTypeFrom(studentType)) return 'Please say whether you’re a home or international student.';
  if (!course.trim()) return 'Please tell us your course.';
  if (course.trim().length > MAX_COURSE_LENGTH) return `Your course can be at most ${MAX_COURSE_LENGTH} characters.`;
  if (interests.length > MAX_INTERESTS) return `Pick at most ${MAX_INTERESTS} interests.`;
  return null;
}

/**
 * Creates the student's Firebase Auth account (which also signs them in) and sends the email that
 * verifies their address. Their record (studentRecord) waits in this tab until they've clicked the
 * link; finishSignUp then saves it. An address that isn't a Northumbria one is refused before any
 * account is made (code NOT_UNI_EMAIL in uni-email.js), unless the access switch is off; other errors
 * are Firebase's own, such as 'auth/email-already-in-use'. If the email can't be sent, the
 * check-your-inbox screen has Resend.
 * @param {{ auth: import('firebase/auth').Auth, waiting: import('#lib/signup/waiting.js').WaitingStore,
 *   uniOnly?: boolean | null }} setup uniOnly: the switch's position, as the page read it (left out:
 *   Northumbria only)
 * @param {StudentDetails & { password: string }} details the password goes only to Firebase Auth, never into the record
 */
export async function signUpStudent({ auth, waiting, uniOnly = true }, { password, ...details }) {
  if (!isAllowedEmail(details.email, uniOnly)) throw notUniEmail();
  const email = details.email.trim();
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  waiting.save({ uid: user.uid, student: studentRecord({ ...details, email }) });
  await sendVerification(user).catch((err) => console.error('Sending the verification email failed:', err?.code ?? err));
  return user;
}

/**
 * True when a signed-in student's record is missing something the sign-up page asks for: their name
 * or course, or whether they're a home or international student (an account from before the
 * question), so Home asks for them. Never for a mentor: they sign up on the mentor page instead.
 * @param {Record<string, unknown> | undefined} record students/{uid}, or undefined if there's none
 * @param {boolean} isMentor whether they have a mentor profile (mentors/{uid})
 */
export function needsDetails(record, isMentor) {
  if (isMentor) return false;
  const filled = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';
  return !filled(record?.name) || !filled(record?.course) || !studentTypeFrom(record?.studentType);
}

/**
 * Whether the signed-in account needs to give its details again (see needsDetails).
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 */
export async function loadDetailsNeeded(db, uid) {
  const [student, mentor] = await Promise.all([getDoc(doc(db, 'students', uid)), getDoc(doc(db, 'mentors', uid))]);
  return needsDetails(student.data(), mentor.exists());
}

/**
 * A signed-in student's own answers, to fill in the sign-up page's about-you step: what their record
 * has, with blanks for the rest.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @returns {Promise<{ name: string, studentType: string, course: string, interests: string[], arrivalDate: string, wantsMentor: boolean }>}
 */
export async function loadStudentDetails(db, uid) {
  const data = (await getDoc(doc(db, 'students', uid))).data() ?? {};
  const text = (/** @type {unknown} */ value) => (typeof value === 'string' ? value : '');
  return {
    name: text(data.name),
    studentType: studentTypeFrom(data.studentType) ?? '',
    course: text(data.course),
    interests: tidyInterests(/** @type {string[] | string | undefined} */ (data.interests)),
    arrivalDate: text(data.arrivalDate),
    wantsMentor: data.wantsMentor === true
  };
}

/**
 * Saves a signed-in student's details as sign-up would have (studentRecord), merged into their
 * record, so a checklist they've saved meanwhile is kept. The email is their account's, not typed.
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} uid
 * @param {string} email
 * @param {Omit<StudentDetails, 'email'>} details
 */
export async function saveStudentDetails(db, uid, email, details) {
  await setDoc(doc(db, 'students', uid), studentRecord({ ...details, email }), { merge: true });
}
