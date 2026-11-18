// The check-in chat's own code (chat-turns.js: the modes, the short list, the instructions, the reply
// shapes and the checks on each reply) run in Node for the measurements, with Gemini asked through
// the Firebase AI Logic SDK itself: the same code the app runs, which makes the same request body.
// The SDK is pointed at a relay on this computer, which passes each body on exactly as the SDK made
// it, through gemini-rest.mjs (the scripts' daily Gemini budget, App Check's debug token, the stop on
// a 402), and hands back Gemini's answer exactly as it came, refusals included.
//
// Until 18 November this built its own request from two fields, so it never sent what the app sent:
// the app sent two fields Gemini refuses, every typed message on the live site failed, and the
// measurements said 5 out of 5.

import { createServer } from 'node:http';
import { CHAT_MODEL } from '#lib/checkin/chat-prompt.js';
import { chatWith } from '#lib/checkin/chat-turns.js';

/**
 * Gemini's side, as the measurements use it.
 * @typedef {{ config: { apiKey: string, projectId: string, appId: string },
 *   send: (model: string, body: string) => Promise<{ status: number, text: string }> }} Relayed
 */

/** The one SDK model for this run, made the first time it's needed. @type {Promise<any> | null} */
let shared = null;

/**
 * Starts the relay and the Firebase SDK's model, once.
 * @param {Relayed} gemini from geminiFromEnv()
 */
function sdkModel(gemini) {
  shared ??= (async () => {
    const server = createServer(async (request, response) => {
      /** @type {Buffer[]} */
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const model = /\/models\/([^/:]+):generateContent$/.exec(new URL(request.url ?? '/', 'http://relay').pathname)?.[1];
      if (request.method !== 'POST' || !model) {
        response.writeHead(404).end();
        return;
      }
      try {
        const answer = await gemini.send(model, Buffer.concat(chunks).toString('utf8'));
        response.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.text);
      } catch (err) {
        response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 500, message: String(err) } }));
      }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
    // The relay never keeps the measurement running on its own.
    server.unref();
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    const { initializeApp } = await import('firebase/app');
    const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
    const app = initializeApp(gemini.config, `measure-chat-${address.port}`);
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    return getGenerativeModel(ai, { model: CHAT_MODEL }, { baseUrl: `http://127.0.0.1:${address.port}` });
  })();
  return shared;
}

/**
 * The model the chat's code is given, as the app gives it one (getGeminiModel in ai.js): every
 * request goes through the Firebase SDK, and on to Gemini exactly as the SDK made it.
 * @param {Relayed} gemini from geminiFromEnv()
 */
export function restModel(gemini) {
  return {
    /** @param {import('firebase/ai').GenerateContentRequest} request */
    async generateContent(request) {
      return (await sdkModel(gemini)).generateContent(request);
    }
  };
}

/**
 * A check-in chat, as the app starts one (startCheckinChat in chat.js), asking Gemini through the SDK.
 * @param {Relayed} gemini
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts
 * @param {string[]} opener
 * @param {unknown} [_log] no longer used: kept so callers don't change
 * @param {[string, string][]} [seed] a conversation so far: the student's message and the chat's words
 */
export function chatOverRest(gemini, facts, opener, _log, seed = []) {
  return chatWith(restModel(gemini), { facts, opener, seed });
}
