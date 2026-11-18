import { getGeminiModel } from '#lib/firebase/ai.js';
import { CHAT_MODEL } from '#lib/checkin/chat-prompt.js';
import { chatWith } from '#lib/checkin/chat-turns.js';

/**
 * Starts a check-in chat with Gemini. Every request carries the instructions and the app's tools
 * (chat-prompt.js, chat-tools.js); how each message is sent and answered, and how the tools are
 * carried out (including when Gemini's credit has run out), is in chat-turns.js.
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts what the app knows about them
 * @param {import('#lib/checkin/chat-turns.js').Act} act how the app makes the changes Gemini asks for
 */
export function startCheckinChat(facts, act) {
  return chatWith(getGeminiModel({ model: CHAT_MODEL }), { facts, act });
}
