// AG2 is for Northumbria students only, so accounts use a Northumbria email address. The same check
// runs on the log in, sign-up and forgot-password forms and in the sign-up code, and firestore.rules
// checks the verified address too (isNorthumbria), so it holds however someone signs up. No Firebase
// here, so the checks can test it in Node.

/** What the forms say about an address from anywhere else. */
export const UNI_EMAIL_MESSAGE = 'Please use your Northumbria email address (ending @northumbria.ac.uk).';

/** Error code for an address that isn't a Northumbria one. */
export const NOT_UNI_EMAIL = 'ag2/not-uni-email';

/**
 * True for an address at northumbria.ac.uk (ending "@northumbria.ac.uk"), in any case, with something
 * before the at sign. Exactly that domain: not a subdomain such as live.northumbria.ac.uk, and not a
 * lookalike such as northumbria.ac.uk.example.com.
 * @param {unknown} email
 */
export function isUniEmail(email) {
  return typeof email === 'string' && /^[^@\s]+@northumbria\.ac\.uk$/i.test(email.trim());
}

/** The error the log-in and sign-up code throws for any other address, with the forms' message. */
export function notUniEmail() {
  return Object.assign(new Error(UNI_EMAIL_MESSAGE), { code: NOT_UNI_EMAIL });
}
