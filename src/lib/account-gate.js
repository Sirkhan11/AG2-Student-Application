import { isUniEmail } from '#lib/uni-email.js';

// Which screen the app shows a signed-in account. AG2 is for verified Northumbria accounts, and
// firestore.rules refuse everything else anyway, so instead of pages that can't load: an account that
// isn't a Northumbria one is told why, and one that isn't verified yet sees only the check-your-inbox
// screen. Need help now is never hidden. No Firebase here, so the checks can test it in Node.

/** Pages every account can open, whatever its state: urgent support. */
export const ALWAYS_OPEN = ['/need-help'];

/**
 * @param {{ email: string, verified: boolean } | null | undefined} account null when nobody is
 *   signed in, undefined while Firebase is still checking for a saved login
 * @param {string} path the page asked for
 * @param {boolean} [finishing] a sign-up that waited for verification is being saved
 * @returns {'app' | 'northumbria-only' | 'verify' | 'finishing'}
 */
export function gateFor(account, path, finishing = false) {
  if (!account || ALWAYS_OPEN.includes(path)) return 'app';
  if (!isUniEmail(account.email)) return 'northumbria-only';
  if (!account.verified) return 'verify';
  return finishing ? 'finishing' : 'app';
}
