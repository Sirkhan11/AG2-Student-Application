import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirebaseAuth } from '#lib/firebase/client.js';

/**
 * Tells the page whether someone is signed in: once Firebase has checked for a saved login, and again
 * whenever someone signs in or out. Returns a function that stops listening.
 * @param {(signedIn: boolean) => void} callback
 * @returns {() => void}
 */
export function watchSignedIn(callback) {
  return onAuthStateChanged(getFirebaseAuth(), (user) => callback(user !== null));
}

/** The signed-in user's uid, or null if nobody is signed in. */
export function currentUid() {
  return getFirebaseAuth().currentUser?.uid ?? null;
}

/**
 * The signed-in user's Firebase ID token, for the app's own server routes (which check it), or null.
 * Firebase renews it when it's about to run out.
 * @returns {Promise<string | null>}
 */
export async function idToken() {
  return (await getFirebaseAuth().currentUser?.getIdToken()) ?? null;
}

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
