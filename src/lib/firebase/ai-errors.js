// What Gemini's errors mean for the app. Kept apart from ai.js, which starts Firebase as soon as it's
// imported, so the checks can use it in Node.

/**
 * True if Gemini refused because the project's prepaid credit has run out (HTTP 402). Trying again
 * won't help until someone tops the credit up, so the app says the feature isn't available (not "try
 * again in a minute") and sends nothing more. Firebase AI Logic puts the HTTP status of a failed
 * request in the error's customErrorData.
 * @param {unknown} err
 */
export function isOutOfCredit(err) {
  return /** @type {{ customErrorData?: { status?: number } } | null | undefined} */ (err)?.customErrorData?.status === 402;
}
