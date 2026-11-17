import { signInWithEmailAndPassword } from 'firebase/auth';
import { getFirebaseAuth } from '#lib/firebase/client.js';

/**
 * Logs in with an email and password. Firebase keeps the session in the browser, so the person stays
 * logged in across page loads until they log out.
 * A wrong email or password throws a FirebaseError with code 'auth/invalid-credential'.
 * @param {string} email
 * @param {string} password
 */
export function logIn(email, password) {
  return signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}
