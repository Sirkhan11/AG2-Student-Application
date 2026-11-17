import { isCrisis, SAFETY_MESSAGE } from '#lib/checkin/safety.js';
import { CHAT_CAMPUS } from '#lib/checkin/chat-prompt.js';
import { linksInReply } from '#lib/checkin/reply-links.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';

// How the check-in chat sends each message and turns Gemini's answer into what the page shows.
// chat.js gives it the Gemini model; it's kept apart so the checks can run it in Node with a made-up
// model (check-checkin.mjs).

/** Only the last this-many messages are sent each time, so a long chat can't grow without limit. */
const MAX_HISTORY_MESSAGES = 20;

/** For a failure that may pass (a blip, or too many requests at once). */
export const ERROR_MESSAGE =
  'Sorry, I can’t reply right now. Please try again in a minute. If you need support now, use the Need help now page.';
/** For when Gemini's prepaid credit has run out: trying again won't help until it's topped up. */
export const UNAVAILABLE_MESSAGE =
  'Sorry, the chat isn’t available right now. If you need support now, use the Need help now page.';

/**
 * A reply for the page to show: 'reply' from Gemini, 'safety' (the fixed support message), 'error'
 * (try again in a minute) or 'unavailable' (the credit has run out, so the chat stops).
 * links are the real societies, clubs and NSU services Gemini suggested (see reply-links.js).
 * @typedef {{ kind: 'reply' | 'safety' | 'error' | 'unavailable', text: string,
 *   links?: import('#lib/checkin/reply-links.js').ReplyLink[] }} ChatReply
 */

/**
 * The chat's turns with the given model. The conversation is kept here only: it isn't saved
 * anywhere, and nobody else can see it.
 *
 * It keeps its own list of the messages that got a reply, and sends that list each time, rather than
 * using the SDK's chat session. A chat session keeps a failed send and throws the same error for every
 * later message, so one blip would break the chat until the page reloads. Here a failed message is
 * simply never added, so the next one starts again from the last good point.
 *
 * Once Gemini says the prepaid credit has run out (HTTP 402), nothing more is sent: every later
 * message gets the "isn't available" reply straight away, apart from the crisis check, which never
 * needs Gemini.
 * @param {Pick<import('firebase/ai').GenerativeModel, 'generateContent'>} model
 */
export function chatWith(model) {
  /** @type {import('firebase/ai').Content[]} the student's messages and Gemini's replies, in order */
  const history = [];
  let unavailable = false;

  return {
    /**
     * Sends the student's message and returns what to show back.
     * @param {string} text
     * @returns {Promise<ChatReply>}
     */
    async send(text) {
      // Layer 1: checked here, and not sent to Gemini (see safety.js).
      if (isCrisis(text)) return { kind: 'safety', text: SAFETY_MESSAGE };
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };

      /** @type {import('firebase/ai').Content} */
      const message = {
        role: 'user',
        // Emails and phone numbers are blanked first, so they're never sent to Google.
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
        if (isOutOfCredit(err)) {
          unavailable = true;
          console.error('The check-in chat is unavailable: Gemini’s prepaid credit has run out (HTTP 402).');
          return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
        }
        console.error('The check-in chat could not reply:', err);
        return { kind: 'error', text: ERROR_MESSAGE };
      }
    }
  };
}
