import { getGeminiModel } from '#lib/firebase/ai.js';
import { isCrisis, SAFETY_MESSAGE } from '#lib/checkin/safety.js';
import { CHAT_CAMPUS, CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { linksInReply } from '#lib/checkin/reply-links.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';

/** Only the last this-many messages are sent each time, so a long chat can't grow without limit. */
const MAX_HISTORY_MESSAGES = 20;

const ERROR_MESSAGE =
  'Sorry, I can’t reply right now. Please try again in a minute. If you need support now, use the Need help now page.';

/**
 * A reply for the page to show: 'reply' from Gemini, 'safety' (the fixed support message), or 'error'.
 * links are the real societies and NSU services Gemini suggested (see reply-links.js).
 * @typedef {{ kind: 'reply' | 'safety' | 'error', text: string,
 *   links?: import('#lib/checkin/reply-links.js').ReplyLink[] }} ChatReply
 */

/**
 * Starts a check-in chat. The conversation is kept in the page only: it isn't saved anywhere, and
 * nobody else can see it. The instructions are in chat-prompt.js.
 *
 * It keeps its own list of the messages that got a reply, and sends that list each time, rather than
 * using the SDK's chat session. A chat session keeps a failed send and throws the same error for every
 * later message, so one blip (or the 15-a-minute limit) would break the chat until the page reloads.
 * Here a failed message is simply never added, so the next one starts again from the last good point.
 * @param {string} about from describeForGemini() in opener.js
 * @param {string[]} opener the first messages, without any names
 */
export function startCheckinChat(about, opener) {
  const model = getGeminiModel({ model: CHAT_MODEL, systemInstruction: chatInstructions(about, opener) });
  /** @type {import('firebase/ai').Content[]} the student's messages and Gemini's replies, in order */
  const history = [];

  return {
    /**
     * Sends the student's message and returns what to show back.
     * @param {string} text
     * @returns {Promise<ChatReply>}
     */
    async send(text) {
      // Layer 1: checked here, and not sent to Gemini (see safety.js).
      if (isCrisis(text)) return { kind: 'safety', text: SAFETY_MESSAGE };

      /** @type {import('firebase/ai').Content} */
      const message = {
        role: 'user',
        // Emails and phone numbers are blanked first, as Google's free tier may keep what it's sent.
        parts: [{ type: 'text', text: blankContactDetails(text) }]
      };
      try {
        // Whole exchanges only, so what's sent always starts with one of the student's messages.
        const result = await model.generateContent({ contents: [...history.slice(-MAX_HISTORY_MESSAGES), message] });
        // Layer 3: if Gemini's own safety filters stop the reply, the student still gets the support message.
        const response = result.response;
        if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
          return { kind: 'safety', text: SAFETY_MESSAGE };
        }
        const reply = response.text().trim();
        if (reply === '') throw new Error('Gemini sent an empty reply.');
        // Gemini keeps seeing its own [[Name]] format; the student sees plain names plus links.
        history.push(message, { role: 'model', parts: [{ type: 'text', text: reply }] });
        const { text: shown, links } = linksInReply(reply, CHAT_CAMPUS);
        return { kind: 'reply', text: shown, links };
      } catch (err) {
        console.error('The check-in chat could not reply:', err);
        return { kind: 'error', text: ERROR_MESSAGE };
      }
    }
  };
}
