import { doc, getDoc } from 'firebase/firestore';
import { isUniEmail } from '#lib/uni-email.js';

// The access switch: whether AG2 takes only Northumbria addresses (as it will for students) or any
// email address, so the project group can test it while Northumbria's mail filter holds up the
// verification emails (IT ticket INC0456681). The switch is one Firestore document, config/access,
// with one boolean field, uniOnly, flipped in the Firebase console (Firestore Database, config,
// access): no deploy and no code change. firestore.rules read the same document (anyVerifiedAddress),
// so the forms and the rules always agree. Only the exact value false opens the app to any address: no
// document, no field, or any other value means Northumbria only, the safe side. Either way the address
// must be verified, so people still prove it's theirs, and flipping the switch back deletes nothing:
// accounts from elsewhere just see the Northumbria-only screen until it's flipped again. Firestore is
// passed in to readUniOnly, so the checks can run it against the emulator; access.svelte.js keeps the
// value for the pages.

/** The switch's document: its collection, id and field. */
export const ACCESS_COLLECTION = 'config';
export const ACCESS_DOCUMENT = 'access';
export const UNI_ONLY_FIELD = 'uniOnly';

/**
 * The switch's position from the document's fields: Northumbria only (true) unless uniOnly is exactly
 * false.
 * @param {Record<string, unknown> | undefined} data config/access's fields, or undefined when there's no document
 */
export function uniOnlyFrom(data) {
  return data?.[UNI_ONLY_FIELD] !== false;
}

/**
 * Reads the switch. If it can't be read (offline, say), Northumbria only, as for a missing document.
 * @param {import('firebase/firestore').Firestore} db
 * @returns {Promise<boolean>} true: Northumbria only
 */
export async function readUniOnly(db) {
  try {
    return uniOnlyFrom((await getDoc(doc(db, ACCESS_COLLECTION, ACCESS_DOCUMENT))).data());
  } catch (err) {
    console.error('Reading the access switch failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
    return true;
  }
}

/**
 * Whether the forms and the sign-up code take this address. With the switch off, any address (the
 * browser's own check of the box, and Firebase, catch one that isn't an address); otherwise, as when
 * it hasn't been read yet, only a Northumbria one (isUniEmail).
 * @param {unknown} email
 * @param {boolean | null | undefined} uniOnly the switch's position (null: not read yet)
 */
export function isAllowedEmail(email, uniOnly) {
  return uniOnly === false ? typeof email === 'string' : isUniEmail(email);
}

/**
 * The words that follow the switch, on the forms and the check-your-inbox screen. With it on (or not
 * read yet), today's wording; with it off, plain "Email address", and a line on the sign-up page so
 * testers know.
 * @param {boolean | null | undefined} uniOnly
 */
export function wordingFor(uniOnly) {
  const any = uniOnly === false;
  return {
    /** The label on the email box. */
    emailLabel: any ? 'Email address' : 'Northumbria email address',
    /** The email box's placeholder on the sign-up forms (none with the switch off). */
    emailPlaceholder: any ? undefined : 'ending @northumbria.ac.uk',
    /** The check-your-inbox screen's heading. */
    inboxHeading: any ? 'Check your inbox' : 'Check your uni inbox',
    /** Its line for someone who typed the wrong address. */
    wrongAddress: any
      ? 'Wrong address? Log out, then sign up again with the right one.'
      : 'Wrong address? Log out, then sign up again with your Northumbria email.',
    /** The sign-up page's line that the app is open to any address (nothing with the switch on). */
    testingNote: any ? 'Testing: open to any email address' : ''
  };
}
