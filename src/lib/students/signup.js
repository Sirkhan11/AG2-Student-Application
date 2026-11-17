import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

// A new student's account and record, as the sign-up page (/signup) makes them. Firebase Auth and
// Firestore are passed in rather than taken from client.js (which only works in the browser), so a
// script run in Node can make a test student with exactly the record a new student gets.

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
 * Creates the student's Firebase Auth account (which also signs them in) and saves their record at
 * students/{uid}. Errors are Firebase's own, such as 'auth/email-already-in-use'.
 * @param {{ auth: import('firebase/auth').Auth, db: import('firebase/firestore').Firestore }} firebase
 * @param {StudentDetails & { password: string }} details the password goes only to Firebase Auth, never into the record
 */
export async function signUpStudent({ auth, db }, { password, ...details }) {
  const result = await createUserWithEmailAndPassword(auth, details.email, password);
  await setDoc(doc(db, 'students', result.user.uid), studentRecord(details));
  return result.user;
}
