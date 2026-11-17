import { isUniEmail } from '#lib/uni-email.js';

// Which screen the app shows, for every page, in one place (the root layout). AG2 is for verified
// Northumbria accounts: a logged-out visitor can open only the public pages below, and is sent to log
// in (and back) from anywhere else; an account that isn't a Northumbria one is told why; one that isn't
// verified yet sees only the check-your-inbox screen. firestore.rules refuse all of them anyway. Need
// help now always opens. No Firebase here, so the checks can test it in Node.

/** Pages a logged-out visitor can open: log in, sign up, forgot password, mentor sign-up and Need help. */
export const PUBLIC_PAGES = Object.freeze(['/', '/signup', '/forgot-password', '/mentor-signup', '/need-help']);

/** Pages every account can open, whatever its state: urgent support. */
export const ALWAYS_OPEN = Object.freeze(['/need-help']);

/** @param {string} path */
export const isPublic = (path) => PUBLIC_PAGES.includes(path);

/**
 * @param {{ email: string, verified: boolean } | null | undefined} account null when nobody is
 *   signed in, undefined while Firebase is still checking for a saved login
 * @param {string} path the page asked for
 * @param {boolean} [finishing] a sign-up that waited for verification is being saved
 * @param {boolean} [publicPage] the page says it's public in its data (publicPage: true): only the
 *   pretend Blackboard's pages (dev only, never on the live site), which stand in for Northumbria's
 *   own site, so the app's login doesn't apply to them
 * @returns {'app' | 'checking' | 'login' | 'northumbria-only' | 'verify' | 'finishing'}
 *   'checking': show nothing yet (so nothing flashes before it's known); 'login': send them to log in
 */
export function gateFor(account, path, finishing = false, publicPage = false) {
  if (ALWAYS_OPEN.includes(path)) return 'app';
  const open = publicPage || isPublic(path);
  if (account === undefined) return open ? 'app' : 'checking';
  if (account === null) return open ? 'app' : 'login';
  if (!isUniEmail(account.email)) return 'northumbria-only';
  if (!account.verified) return 'verify';
  return finishing ? 'finishing' : 'app';
}
