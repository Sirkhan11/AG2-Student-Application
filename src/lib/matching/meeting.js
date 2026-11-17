// How often a student would like to meet, and when they're free: the choices and the limit the Find a
// mentor page, the chat and firestore.rules all use. No Firebase here, so the checks can use it in Node.

/** How often a student would like to meet: the same choices as the mentor sign-up form. */
export const MEETING_FREQUENCIES = Object.freeze(['weekly', 'every two weeks', 'monthly']);

/** The longest availability text a match can store (firestore.rules checks the same number). */
export const MAX_AVAILABILITY_LENGTH = 200;
