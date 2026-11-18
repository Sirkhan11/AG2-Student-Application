// Who may call the app's function: the same gate as firestore.rules' hasAccess(), so the function
// lets in exactly who the database does. A signed-in account whose email address is verified and is a
// Northumbria one (ending @northumbria.ac.uk, in any case: isUniEmail in src/lib/uni-email.js and
// isNorthumbria in the rules say the same), or one of the three test accounts the check scripts sign
// in as (by uid, as in the rules), or, while the access switch is off (config/access, uniOnly exactly
// false: src/lib/access.js), any verified address. The switch is read only when it's needed, as the
// rules do (a Northumbria account never reads it). No Firebase here: the function passes in how to
// read the switch, so check-deadlines.mjs can test every case in Node.

/** The check scripts' three accounts, as listed in firestore.rules (isTestAccount): two students and a mentor. */
export const TEST_ACCOUNT_UIDS = Object.freeze(['Zn9BqgxGdocNVUNyzK29sCYQKSG2', 'BN5AnnatLhWw6JDgS9NmEXuXf4b2', 'bzvM0WCSLRXYjSTA1dRHHhfrTro2']);

/**
 * True for an address at northumbria.ac.uk, in any case, with something before the at sign: exactly
 * that domain, not a subdomain and not a lookalike (the same as isUniEmail).
 * @param {unknown} email
 */
export const isNorthumbriaAddress = (email) => typeof email === 'string' && /^[^@\s]+@northumbria\.ac\.uk$/i.test(email.trim());

/**
 * @typedef {{ uid: string, email?: string | undefined, emailVerified?: boolean | undefined }} Caller
 *   the signed-in account, from the ID token Firebase verified
 */

/**
 * Why a caller is refused, or null when they're let in.
 * @param {Caller | null} caller null when nobody is signed in
 * @param {() => Promise<boolean>} uniOnly reads the switch (true: Northumbria only), only when needed
 * @returns {Promise<'unauthenticated' | 'unverified' | 'northumbria-only' | null>}
 */
export async function accessProblem(caller, uniOnly) {
  if (!caller) return 'unauthenticated';
  if (TEST_ACCOUNT_UIDS.includes(caller.uid)) return null;
  if (caller.emailVerified !== true) return 'unverified';
  if (isNorthumbriaAddress(caller.email)) return null;
  return (await uniOnly()) ? 'northumbria-only' : null;
}
