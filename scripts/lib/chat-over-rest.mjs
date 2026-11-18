// The check-in chat's own code (chat-turns.js: the modes, the short list, the instructions, the reply
// shapes and the checks on each reply) run in Node, with Gemini over REST in place of the Firebase
// SDK, so the measurements ask exactly what the app asks. Every request goes through gemini-rest.mjs,
// which keeps to the scripts' daily Gemini budget and stops on a 402.

import { CHAT_MODEL } from '#lib/checkin/chat-prompt.js';
import { chatWith } from '#lib/checkin/chat-turns.js';

/**
 * A stand-in for the SDK's model that sends each request over REST, shaped as the SDK sends it (a
 * string systemInstruction becomes a system Content; parts are sent as plain text parts).
 * @param {{ generate: (model: string, body: object) => Promise<string> }} gemini from geminiFromEnv()
 * @param {{ requests?: object[] }} [log] every request sent is added to log.requests, for the checks
 */
export function restModel(gemini, log = {}) {
  return {
    /** @param {any} request */
    async generateContent(request) {
      const body = {
        contents: request.contents.map((/** @type {any} */ content) => ({
          role: content.role,
          parts: content.parts.map((/** @type {any} */ part) => ({ text: part.text }))
        })),
        ...(request.systemInstruction ? { systemInstruction: { role: 'system', parts: [{ text: request.systemInstruction }] } } : {}),
        ...(request.generationConfig ? { generationConfig: request.generationConfig } : {})
      };
      log.requests?.push(body);
      const text = await gemini.generate(CHAT_MODEL, body);
      return { response: { text: () => text, candidates: [{ finishReason: 'STOP' }] } };
    }
  };
}

/**
 * A check-in chat over REST, as the app starts one (startCheckinChat in chat.js).
 * @param {{ generate: (model: string, body: object) => Promise<string> }} gemini
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts
 * @param {string[]} opener
 * @param {{ requests?: object[] }} [log]
 * @param {[string, string][]} [seed] a conversation so far: the student's message and the chat's words
 */
export function chatOverRest(gemini, facts, opener, log, seed = []) {
  return chatWith(restModel(gemini, log), { facts, opener, seed });
}
