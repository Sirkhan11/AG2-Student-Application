// Asking the coordinator for a different mentor, on the Your Mentor page: the reasons a student can
// pick, and the checks before anything is sent. The request goes only to the coordinator (Firestore,
// read in the console): never to the mentor, never to Gemini, and the chat never reads it. No
// Firebase here, so the checks can test it in Node.

/** The reasons offered, in order. firestore.rules (validChangeRequest) accepts exactly these ids. */
export const CHANGE_REASONS = Object.freeze([
  { id: 'not-a-good-fit', label: 'We’re not a good fit' },
  { id: 'times-dont-work', label: 'Our times don’t work' },
  { id: 'not-replying', label: 'They don’t reply' },
  { id: 'uncomfortable', label: 'I don’t feel comfortable with them' },
  { id: 'something-else', label: 'Something else' }
]);

/** Reasons where the form points to Need help now more strongly. */
export const URGENT_REASONS = Object.freeze(['uncomfortable']);

/** The most a student can write in their own words (firestore.rules checks the same number). */
export const MAX_DETAILS_LENGTH = 500;

/**
 * Checks a request before it's sent, and returns what's saved. A reason must be picked; their own
 * words are optional, except for "Something else". Throws an Error whose message can be shown.
 * @param {string} reason one of the CHANGE_REASONS ids
 * @param {unknown} details their own words
 * @returns {{ reason: string, details: string }}
 */
export function checkedChangeRequest(reason, details) {
  if (!CHANGE_REASONS.some((option) => option.id === reason)) throw new Error('Please choose a reason.');
  const words = typeof details === 'string' ? details.trim() : '';
  if (words.length > MAX_DETAILS_LENGTH) throw new Error(`Please keep it to ${MAX_DETAILS_LENGTH} characters.`);
  if (reason === 'something-else' && words === '') throw new Error('Please say a little about it in your own words.');
  return { reason, details: words };
}
