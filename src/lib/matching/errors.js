// Error codes the matching code throws, kept apart from summarise.js (which needs the browser) so the
// checks can use them in Node.

/** Error code for when Gemini couldn't summarise the answers. Pages check err.code, as with Firebase errors. */
export const SUMMARISE_FAILED = 'matching/summarise-failed';
