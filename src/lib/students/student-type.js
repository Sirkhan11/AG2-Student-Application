// Whether a student is a home student (from the UK) or an international one (here on a student visa,
// usually): the one answer from the sign-up page's about-you step (signup.js) that the app uses to put
// the right information first. The NHS guide's order (nhs/guide.js), the checklist's visa-only lines
// and its pointer to Arriving late (checklist/how-to.js), and one word for the check-in chat
// (checkin/about-you.js) all follow it. No Firebase here, so the checks can test it in Node.

/**
 * The two answers, as the record stores them (students/{uid}.studentType). firestore.rules allow only
 * these two values.
 */
export const STUDENT_TYPES = Object.freeze(/** @type {const} */ (['home', 'international']));

/** @typedef {(typeof STUDENT_TYPES)[number]} StudentType */

/**
 * The answer if it's one of the two, else null: a record from before the question, or anything odd.
 * @param {unknown} value
 * @returns {StudentType | null}
 */
export function studentTypeFrom(value) {
  return value === 'home' || value === 'international' ? value : null;
}

/**
 * The answer in words, for the "What the chat knows about you" page: "a home student" or "an
 * international student"; null when they haven't said.
 * @param {StudentType | null} type
 */
export function studentTypeInWords(type) {
  return type === 'home' ? 'a home student' : type === 'international' ? 'an international student' : null;
}
