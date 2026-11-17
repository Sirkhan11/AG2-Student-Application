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
 * Whether the signed-in user has clicked the link. Reloads them from Firebase, and if they're
 * verified now, gets a fresh ID token: firestore.rules read email_verified from the token, and the
 * new token also tells the app's gate (watchAccount in auth.js) straight away.
 * @param {import('firebase/auth').User} user
 */
export async function checkVerified(user) {
  await reload(user);
  if (!user.emailVerified) return false;
  await user.getIdToken(true);
  return true;
}
