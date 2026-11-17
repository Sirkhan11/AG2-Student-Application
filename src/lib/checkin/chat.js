import { getGeminiModel } from '#lib/firebase/ai.js';
import { CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { chatWith } from '#lib/checkin/chat-turns.js';

/**
 * Starts a check-in chat with Gemini. The instructions are in chat-prompt.js; how each message is
 * sent and answered (including when Gemini's credit has run out) is in chat-turns.js.
 * @param {string} about from describeForGemini() in opener.js
 * @param {string[]} opener the first messages, without any names
 */
export function startCheckinChat(about, opener) {
  /** @param {string} facts */
  const modelFor = (facts) => getGeminiModel({ model: CHAT_MODEL, systemInstruction: chatInstructions(facts, opener) });
  const chat = chatWith(modelFor(about));
  return {
    send: chat.send,
    /**
     * Tells Gemini what the app knows now (for example after finding a mentor in the chat), keeping
     * the conversation so far.
     * @param {string} newAbout from describeForGemini() in opener.js
     */
    retell(newAbout) {
      chat.useModel(modelFor(newAbout));
    }
  };
}
