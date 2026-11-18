import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { sendVerification } from '#lib/firebase/verify.js';
import { isAllowedEmail } from '#lib/access.js';
import { notUniEmail } from '#lib/uni-email.js';

// A new student's account and record, as the sign-up page (/signup) makes them. Only a Northumbria
// address is accepted (any address while the access switch is off: access.js), and the record waits
// until the address is verified (firestore.rules only let a verified account the switch lets in write
// anything): see signup/waiting.js and signup/finish.js. If the
// details were lost (the tab closed before verifying), Home asks for them again and the sign-up page
// saves them to the signed-in account (needsDetails, saveStudentDetails). Firebase is passed in rather
// than taken from client.js (which only works in the browser), so the checks can run it against the
// emulators.

/**
 * What a student types on the sign-up page. interests is the box's text: a comma list, as typed.
 * @typedef {{ name: string, email: string, course: string, interests: string, arrivalDate: string }} StudentDetails
 */

/**
 * The record saved at students/{uid} when a student signs up. Only these fields are saved, whatever
 * else is passed in.
 * @param {StudentDetails} details
 */
export function studentRecord({ name, email, course, interests, arrivalDate }) {
  return {
    name,
    email,
    course,
    interests: interests
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    arrivalDate,
    role: 'student'
  };
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
 * True when a signed-in student's record is missing the details they give at sign-up (their name or
 * course), so Home asks for them. Never for a mentor: they sign up on the mentor page instead.
 * @param {Record<string, unknown> | undefined} record students/{uid}, or undefined if there's none
 * @param {boolean} isMentor whether they have a mentor profile (mentors/{uid})
 */
export function needsDetails(record, isMentor) {
  if (isMentor) return false;
  const filled = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';
  return !filled(record?.name) || !filled(record?.course);
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
