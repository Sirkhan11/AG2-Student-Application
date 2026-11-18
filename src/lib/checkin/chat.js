import { getGeminiModel } from '#lib/firebase/ai.js';
import { CHAT_MODEL } from '#lib/checkin/chat-prompt.js';
import { chatWith } from '#lib/checkin/chat-turns.js';

/**
 * Starts a check-in chat with Gemini. Each turn carries its own instructions and reply shape
 * (chat-prompt.js), so one model serves every mode; how each message is sent and answered (including
 * when Gemini's credit has run out) is in chat-turns.js.
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts what the app knows about them
 * @param {string[]} opener the first messages, without any names
 */
export function startCheckinChat(facts, opener) {
  return chatWith(getGeminiModel({ model: CHAT_MODEL }), { facts, opener });
}
