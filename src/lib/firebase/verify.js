import { reload, sendEmailVerification } from 'firebase/auth';

// Email verification: sending (and resending) the link, and checking whether it's been clicked.
// No continue address is passed, so after clicking the link they see Firebase's own "your email has
// been verified" page, then come back to the app's tab and tap "I've clicked it". No Firebase app
// here (the user is passed in), so the checks can run it against the Auth emulator.

// The tab notes when it sent an account a link (sessionStorage: this tab only, gone when it closes),
// so the check-your-inbox screen says a link was sent only when one was. An account that logs in
// unverified, such as one made before verification existed, is offered the link instead
// (VerifyEmail.svelte). Signing up sends the link while that screen is already showing, so the screen
// also hears about each one as it goes (SENT_EVENT).

/** Where this tab keeps which account it last sent a link to, and when. */
const SENT_KEY = 'ag2.verificationSent';
/** The page's event for a link just sent; its detail is { uid, at }. */
export const SENT_EVENT = 'ag2:verification-sent';

/**
 * Sends the email with the link that verifies their address, then notes in this tab that it did
 * (sentThisVisit) and tells the page (SENT_EVENT).
 * @param {import('firebase/auth').User} user
 */
export async function sendVerification(user) {
  await sendEmailVerification(user);
  const sent = { uid: user.uid, at: Date.now() };
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch {
    // No storage (Node, or a browser that refuses it): the screen still hears the event below.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SENT_EVENT, { detail: sent }));
}

/**
 * When this tab last sent this account a link (milliseconds since 1970), or null if it hasn't.
 * @param {string | null | undefined} uid
 * @returns {number | null}
 */
export function sentThisVisit(uid) {
  try {
    const sent = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? 'null');
    return uid && sent?.uid === uid && typeof sent.at === 'number' ? sent.at : null;
  } catch {
    return null;
  }
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
