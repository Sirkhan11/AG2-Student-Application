// A stand-in for Gemini in Chrome, for the browser checks. It answers the app's Gemini requests
// (Firebase AI Logic's generateContent) with made-up replies, using the DevTools protocol's Fetch
// domain, so the chat's cards can be checked against the emulators without Gemini, Google or the
// daily budget. Every request is kept, so a check can see exactly what the app sent: what Gemini
// was told about the student, and each message.

/** Where Firebase AI Logic sends Gemini requests. */
const GEMINI_HOSTS = ['firebasevertexai.googleapis.com', 'generativelanguage.googleapis.com', 'aiplatform.googleapis.com'];

/**
 * The fields Gemini's generateContent accepts, at the top of a request, in a message (Content) and in
 * a message's parts. Gemini refuses a whole request with any other field (HTTP 400, "Invalid JSON
 * payload received. Unknown name …"), so the stand-in does too: on 18 November the live chat sent two
 * extra fields with every ordinary message, and every reply failed while the stand-in answered them.
 */
const ACCEPTED = {
  request: ['contents', 'systemInstruction', 'generationConfig', 'tools', 'toolConfig', 'safetySettings', 'cachedContent', 'labels'],
  content: ['role', 'parts'],
  part: ['text', 'inlineData', 'fileData', 'functionCall', 'functionResponse', 'executableCode', 'codeExecutionResult', 'thought', 'thoughtSignature', 'videoMetadata']
};

/**
 * The fields in a request body that Gemini would refuse, as its error names them.
 * @param {any} body
 * @returns {string[]}
 */
export function unknownFields(body) {
  if (!body || typeof body !== 'object') return [];
  /** @param {any} object @param {string[]} accepted */
  const extra = (object, accepted) => (object && typeof object === 'object' ? Object.keys(object).filter((key) => !accepted.includes(key)) : []);
  /** @param {any} content */
  const inContent = (content) => [...extra(content, ACCEPTED.content), ...(content?.parts ?? []).flatMap((/** @type {any} */ part) => extra(part, ACCEPTED.part))];
  return [
    ...extra(body, ACCEPTED.request),
    ...(Array.isArray(body.contents) ? body.contents.flatMap(inContent) : []),
    ...(body.systemInstruction ? inContent(body.systemInstruction) : [])
  ];
}

/** The answer to the browser's own cross-origin checks. */
const CORS = [
  { name: 'access-control-allow-origin', value: '*' },
  { name: 'access-control-allow-headers', value: '*' },
  { name: 'access-control-allow-methods', value: 'POST, OPTIONS' }
];

/**
 * Starts answering the page's Gemini requests. Replies are used in the order they're queued: text, or
 * tool calls (function calling, as the chat's tools in chat-tools.js), one per request; with none
 * queued, it says "Thanks for telling me.".
 * @param {(method: string, params?: object) => Promise<any>} send the page's DevTools session
 * @param {(handler: (message: any) => void) => void} listen adds a handler for every DevTools message
 */
export async function standInGemini(send, listen) {
  /** @type {({ text: string } | { calls: { name: string, args?: Record<string, unknown> }[] })[]} */
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
    const unknown = unknownFields(body);
    requests.push({ url: request.url, body, ...(unknown.length ? { refused: unknown } : {}) });
    if (unknown.length) {
      // Refused as Gemini refuses it, so the app shows what a student would see.
      const error = {
        error: {
          code: 400,
          message: unknown.map((name) => `Invalid JSON payload received. Unknown name "${name}": Cannot find field.`).join('\n'),
          status: 'INVALID_ARGUMENT'
        }
      };
      void send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 400,
        responseHeaders: [...CORS, { name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(error)).toString('base64')
      }).catch(() => {});
      return;
    }
    const next = replies.shift() ?? { text: 'Thanks for telling me.' };
    const parts = 'calls' in next ? next.calls.map((call) => ({ functionCall: { name: call.name, args: call.args ?? {} } })) : [{ text: next.text }];
    const answer = {
      candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
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
     * Queues answers, one per request, in order: text as it is (a chat reply, or a summary's JSON), or
     * { calls: [{ name, args }] } for tool calls.
     * @param {...(string | { calls: { name: string, args?: Record<string, unknown> }[] })} answers
     */
    replyWith: (...answers) => void replies.push(...answers.map((answer) => (typeof answer === 'string' ? { text: answer } : answer))),
    /** Every request the app has sent to Gemini (refused: the fields Gemini wouldn't accept, if any). */
    requests,
    /** The requests Gemini would have refused for fields it doesn't accept, with those fields. */
    refused: () => requests.filter((request) => request.refused).map((request) => /** @type {string[]} */ (request.refused)),
    /** What the last request told Gemini (its system instruction), or ''. */
    lastInstructions: () => {
      const body = requests.at(-1)?.body;
      return (body?.systemInstruction?.parts ?? []).map((/** @type {{ text?: string }} */ part) => part.text ?? '').join('\n');
    },
    /** The student's messages (and the app's notes) in the last request, as sent: not the tools' results. */
    lastMessages: () =>
      (requests.at(-1)?.body?.contents ?? [])
        .filter((/** @type {any} */ c) => c.role === 'user' && c.parts.some((/** @type {any} */ p) => typeof p.text === 'string'))
        .map((/** @type {any} */ c) => c.parts.map((/** @type {any} */ p) => p.text ?? '').join(''))
  };
}
