// Calls Gemini through Firebase AI Logic from Node, for the scripts that make or measure Gemini
// output. The Firebase SDK's App Check needs a browser, so instead this swaps the dev App Check debug
// token (VITE_APPCHECK_DEBUG_TOKEN in .env.development.local) for an App Check token, as the SDK does
// on localhost, and sends requests to the same endpoint with the same headers. Secrets are never printed.
//
// Requests are spaced at least 5 seconds apart: 12 a minute, under the free tier's 15. "Too many
// requests" (429) waits a minute; "busy" (500 or 503, such as "experiencing high demand") waits a
// little longer each time, and so does a request with no answer within a minute (or no connection),
// instead of hanging until Node gives up after 5 minutes. Run scripts with
// --env-file=.env --env-file=.env.development.local.

const SPACING_MS = 5_000;
/** How long one request may take before it counts as no answer and is tried again. */
const TIMEOUT_MS = 60_000;
const NEEDED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_APPCHECK_DEBUG_TOKEN'];

const wait = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sets up Gemini calls from the environment, or exits with a message saying what's missing.
 * @param {NodeJS.ProcessEnv} env
 */
export function geminiFromEnv(env) {
  for (const name of NEEDED) {
    if (!env[name]) {
      console.log(`Missing ${name}. Run with --env-file=.env --env-file=.env.development.local from the project folder.`);
      process.exit(2);
    }
  }
  const apiKey = /** @type {string} */ (env.VITE_FIREBASE_API_KEY);
  const projectId = /** @type {string} */ (env.VITE_FIREBASE_PROJECT_ID);
  const appId = /** @type {string} */ (env.VITE_FIREBASE_APP_ID);
  /** @type {string | null} */
  let token = null;
  let tokenTime = 0;
  let last = 0;

  /** Swaps the debug token for an App Check token, which lasts about an hour; refreshed every 30 minutes. */
  async function appCheckToken() {
    if (token && Date.now() - tokenTime < 30 * 60_000) return token;
    const response = await fetch(
      `https://content-firebaseappcheck.googleapis.com/v1/projects/${projectId}/apps/${appId}:exchangeDebugToken?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debug_token: env.VITE_APPCHECK_DEBUG_TOKEN }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      }
    );
    if (!response.ok) throw new Error(`App Check refused the debug token (HTTP ${response.status}). Is it registered in the console?`);
    token = (await response.json()).token;
    tokenTime = Date.now();
    return /** @type {string} */ (token);
  }

  return {
    /**
     * Sends one generateContent request, shaped as the Firebase SDK sends it, and returns the reply text.
     * @param {string} model
     * @param {object} body { contents, systemInstruction, generationConfig? }
     * @returns {Promise<string>}
     */
    async generate(model, body) {
      for (let attempt = 1; ; attempt++) {
        await wait(Math.max(0, last + SPACING_MS - Date.now()));
        last = Date.now();
        let status;
        let text;
        try {
          const response = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${projectId}/models/${model}:generateContent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
              'X-Firebase-AppCheck': await appCheckToken(),
              'X-Firebase-Appid': appId
            },
            body: JSON.stringify(body),
            // Covers reading the reply too, so a reply that stops halfway also counts as no answer.
            signal: AbortSignal.timeout(TIMEOUT_MS)
          });
          status = response.status;
          text = await response.text();
        } catch (err) {
          // No answer in time, or no connection: try again like a busy answer. Anything else (such
          // as App Check refusing the debug token) is a real problem, so it's thrown straight away.
          const name = /** @type {Error} */ (err).name;
          if ((name === 'TimeoutError' || name === 'TypeError') && attempt <= 4) {
            const why = name === 'TimeoutError' ? `didn't answer within ${TIMEOUT_MS / 1000} seconds` : "couldn't be reached";
            console.log(`      Gemini ${why}: waiting ${20 * attempt} seconds, then trying again.`);
            await wait(20_000 * attempt);
            continue;
          }
          throw err;
        }
        if (status === 429 && attempt <= 3) {
          console.log('      Too many requests: waiting a minute, then trying again.');
          await wait(65_000);
          continue;
        }
        if ((status === 500 || status === 503) && attempt <= 4) {
          console.log(`      Gemini is busy (HTTP ${status}): waiting ${20 * attempt} seconds, then trying again.`);
          await wait(20_000 * attempt);
          continue;
        }
        if (status < 200 || status >= 300) throw new Error(`Gemini returned HTTP ${status}: ${text.slice(0, 200)}`);
        const reply = JSON.parse(text);
        return reply.candidates?.[0]?.content?.parts?.map((/** @type {{ text?: string }} */ part) => part.text ?? '').join('') ?? '';
      }
    }
  };
}
