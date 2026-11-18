import { reload, sendEmailVerification } from 'firebase/auth';

// Email verification: sending (and resending) the link, and checking whether it's been clicked.
// No continue address is passed, so after clicking the link they see Firebase's own "your email has
// been verified" page, then come back to the app's tab and tap "I've clicked it". No Firebase app
// here (the user is passed in), so the checks can run it against the Auth emulator.

/**
 * Sends the email with the link that verifies their address.
 * @param {import('firebase/auth').User} user
 */
export function sendVerification(user) {
  return sendEmailVerification(user);
}

/**
 * Whether the signed-in user has clicked the link. Gets a fresh ID token first: Firebase mints it from
 * the account as it is now, so it says verified as soon as the link has been clicked, and
 * firestore.rules read email_verified from the token. Only then is the user reloaded, which tells the
 * app's gate (watchAccount in auth.js) and so saves any sign-up that waited: by then every Firestore
 * write already carries the new token. (The other way round, the gate heard "verified" from the reload
 * before the new token existed, and the first save was refused.)
 * @param {import('firebase/auth').User} user
 */
export async function checkVerified(user) {
  const { claims } = await user.getIdTokenResult(true);
  if (claims.email_verified !== true) return false;
  await reload(user);
  return user.emailVerified;
}

/**
 * Makes sure the signed-in user's ID token says their address is verified, getting a fresh one if it
 * doesn't yet. firestore.rules read email_verified from the token, and the token Firebase saved in the
 * browser can be older than the account: after clicking the link in the email and opening the app
 * afresh, Firebase reloads the account and tells the gate it's verified while the saved token still
 * says it isn't, so the first save (finishSignUp) would be refused, and Try again with it. Nothing to
 * do when nobody is signed in or the token already says verified.
 * @param {import('firebase/auth').User | null} user
 */
export async function freshVerifiedToken(user) {
  if (!user) return;
  const { claims } = await user.getIdTokenResult();
  if (claims.email_verified !== true) await user.getIdToken(true);
}
