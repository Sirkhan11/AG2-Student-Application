import { createUserWithEmailAndPassword } from 'firebase/auth';
import { sendVerification } from '#lib/firebase/verify.js';
import { isUniEmail, notUniEmail } from '#lib/uni-email.js';

// A new student's account and record, as the sign-up page (/signup) makes them. Only a Northumbria
// address is accepted, and the record waits until the address is verified (firestore.rules only let a
// verified Northumbria account write anything): see signup/waiting.js and signup/finish.js. Firebase
// Auth and the waiting store are passed in rather than taken from client.js (which only works in the
// browser), so the checks can run it against the Auth emulator.

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
 * account is made (code NOT_UNI_EMAIL in uni-email.js); other errors are Firebase's own, such as
 * 'auth/email-already-in-use'. If the email can't be sent, the check-your-inbox screen has Resend.
 * @param {{ auth: import('firebase/auth').Auth, waiting: import('#lib/signup/waiting.js').WaitingStore }} setup
 * @param {StudentDetails & { password: string }} details the password goes only to Firebase Auth, never into the record
 */
export async function signUpStudent({ auth, waiting }, { password, ...details }) {
  if (!isUniEmail(details.email)) throw notUniEmail();
  const email = details.email.trim();
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  waiting.save({ uid: user.uid, student: studentRecord({ ...details, email }) });
  await sendVerification(user).catch((err) => console.error('Sending the verification email failed:', err?.code ?? err));
  return user;
}
