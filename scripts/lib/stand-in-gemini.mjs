// A stand-in for Gemini in Chrome, for the browser checks. It answers the app's Gemini requests
// (Firebase AI Logic's generateContent) with made-up replies, using the DevTools protocol's Fetch
// domain, so the chat's cards can be checked against the emulators without Gemini, Google or the
// daily budget. Every request is kept, so a check can see exactly what the app sent: what Gemini
// was told about the student, and each message.

/** Where Firebase AI Logic sends Gemini requests. */
const GEMINI_HOSTS = ['firebasevertexai.googleapis.com', 'generativelanguage.googleapis.com', 'aiplatform.googleapis.com'];

/** The answer to the browser's own cross-origin checks. */
const CORS = [
  { name: 'access-control-allow-origin', value: '*' },
  { name: 'access-control-allow-headers', value: '*' },
  { name: 'access-control-allow-methods', value: 'POST, OPTIONS' }
];

/**
 * Starts answering the page's Gemini requests. Replies are used in the order they're queued; with
 * none queued, it says "Thanks for telling me." (as a check-in chat reply: JSON, see chat-prompt.js).
 * @param {(method: string, params?: object) => Promise<any>} send the page's DevTools session
 * @param {(handler: (message: any) => void) => void} listen adds a handler for every DevTools message
 */
export async function standInGemini(send, listen) {
  /** @type {string[]} */
  const replies = [];
  /** @type {{ url: string, body: any }[]} */
  const requests = [];
  listen((message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (request.method === 'OPTIONS') {
      void send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }).catch(() => {});
      return;
    }
    let body = null;
    try {
      body = JSON.parse(request.postData ?? 'null');
    } catch {
      // Not JSON: kept as nothing.
    }
    requests.push({ url: request.url, body });
    const text = replies.shift() ?? JSON.stringify({ action: 'none', page: 'none', say: 'Thanks for telling me.' });
    const answer = {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
    };
    void send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [...CORS, { name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(answer)).toString('base64')
    }).catch(() => {});
  });
  await send('Fetch.enable', { patterns: GEMINI_HOSTS.map((host) => ({ urlPattern: `*${host}*` })) });
  return {
    /**
     * Queues a reply: text as it is (such as a summary's JSON), or a check-in chat reply's fields,
     * sent as the JSON the chat asks for (no action or page unless given).
     * @param {string | Record<string, unknown>} reply
     */
    replyWith: (reply) => void replies.push(typeof reply === 'string' ? reply : JSON.stringify({ action: 'none', page: 'none', ...reply })),
    /** Every request the app has sent to Gemini. */
    requests,
    /** What the last request told Gemini (its system instruction), or ''. */
    lastInstructions: () => {
      const body = requests.at(-1)?.body;
      return (body?.systemInstruction?.parts ?? []).map((/** @type {{ text?: string }} */ part) => part.text ?? '').join('\n');
    },
    /** The student's messages in the last request, as sent. */
    lastMessages: () => (requests.at(-1)?.body?.contents ?? []).filter((/** @type {any} */ c) => c.role === 'user').map((/** @type {any} */ c) => c.parts.map((/** @type {any} */ p) => p.text).join(''))
  };
}
