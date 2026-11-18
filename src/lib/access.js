import { isUniEmail } from '#lib/uni-email.js';

// The access switch: whether AG2 takes only Northumbria addresses (as it will for students) or any
// email address, so the project group can test it while Northumbria's mail filter holds up the
// verification emails (IT ticket INC0456681). The switch is one Firestore document, config/access,
// with one boolean field, uniOnly, flipped in the Firebase console (Firestore Database, config,
// access): no deploy and no code change. firestore.rules read the same document (anyVerifiedAddress),
// so the forms and the rules always agree. Only the exact value false opens the app to any address: no
// document, no field, or any other value means Northumbria only, the safe side. Either way the address
// must be verified, so people still prove it's theirs, and flipping the switch back deletes nothing:
// accounts from elsewhere just see the Northumbria-only screen until it's flipped again.
// It's read with one plain request to Firestore's REST API rather than the Firestore SDK: the forms
// read it before anyone has logged in, and starting the SDK's streaming connection then (which every
// log-in afterwards restarts) is needless, and against the emulator it leaves channels open until the
// browser's checks stall. Where to ask is passed in (client.js knows: the emulator or Google), so the
// checks can run it against the emulator; access.svelte.js keeps the value for the pages.

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
 * A document's fields as plain values, from the way Firestore's REST API gives them
 * ({ uniOnly: { booleanValue: false } }). Booleans, strings, whole numbers and nulls; anything else is
 * left as it came, which is never false.
 * @param {Record<string, Record<string, unknown>> | undefined} fields
 * @returns {Record<string, unknown> | undefined}
 */
export function fieldsFrom(fields) {
  if (!fields) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      'booleanValue' in value ? value.booleanValue
        : 'stringValue' in value ? value.stringValue
          : 'integerValue' in value ? Number(value.integerValue)
            : 'nullValue' in value ? null
              : value
    ])
  );
}

/**
 * Reads the switch with one request to Firestore's REST API: the document's fields, or nothing when
 * there's no document (404). firestore.rules let anyone read it. If it can't be read (offline, refused,
 * or no answer within 4 seconds), Northumbria only, as for a missing document.
 * @param {{ documentsUrl: string, apiKey?: string }} where the project's documents on Firestore's REST
 *   API (firestoreRest in client.js: the emulator's in emulators mode, Google's otherwise), and the web
 *   API key, which Google's wants and the emulator doesn't
 * @returns {Promise<boolean>} true: Northumbria only
 */
export async function readUniOnly({ documentsUrl, apiKey }) {
  try {
    const url = `${documentsUrl}/${ACCESS_COLLECTION}/${ACCESS_DOCUMENT}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (response.status === 404) return true;
    if (!response.ok) throw new Error(`Firestore answered ${response.status}`);
    const { fields } = /** @type {{ fields?: Record<string, Record<string, unknown>> }} */ (await response.json());
    return uniOnlyFrom(fieldsFrom(fields));
  } catch (err) {
    console.error('Reading the access switch failed:', /** @type {{ message?: string }} */ (err)?.message ?? err);
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
