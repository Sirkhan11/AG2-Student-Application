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
  return chatWith(getGeminiModel({ model: CHAT_MODEL, systemInstruction: chatInstructions(about, opener) }));
}
