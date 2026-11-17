import { isCrisis, SAFETY_MESSAGE } from '#lib/checkin/safety.js';
import { APP_NOTE_START, CHAT_CAMPUS } from '#lib/checkin/chat-prompt.js';
import { linksInReply } from '#lib/checkin/reply-links.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import { tasksInReply } from '#lib/checkin/task-suggestions.js';
import { offersInReply } from '#lib/checkin/chat-actions.js';
import { notesInReply } from '#lib/checkin/remember-notes.js';

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

/** A reply that's only {{skip}}: after the app's note, Gemini chose to say nothing. */
const SKIP = /\{\{\s*skip\s*\}\}/i;

/**
 * A student's message, changed so it can't pass for one of the app's notes (see APP_NOTE_START).
 * @param {string} text
 */
const notFromApp = (text) => text.replace(/\[(\s*from the app)/gi, '($1');

/**
 * A reply for the page to show: 'reply' from Gemini, 'safety' (the fixed support message), 'error'
 * (try again in a minute), 'unavailable' (the credit has run out, so the chat stops), or, after one
 * of the app's own notes, 'skip' (Gemini chose to say nothing, so nothing is shown).
 * links are the real societies, clubs and NSU services Gemini suggested (see reply-links.js); tasks
 * is a checklist task it suggested, for the page's Add / No thanks card (see task-suggestions.js);
 * offers are the chat's own actions it offered, such as 'mentor', for the page's Start / Not now
 * card (see chat-actions.js); notes is something it offered to remember, for the page's Remember /
 * Not now card (see remember-notes.js).
 * @typedef {{ kind: 'reply' | 'safety' | 'error' | 'unavailable' | 'skip', text: string,
 *   links?: import('#lib/checkin/reply-links.js').ReplyLink[], tasks?: string[], offers?: string[],
 *   notes?: string[] }} ChatReply
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

  /**
   * Sends a message (the student's, or one of the app's notes) with the conversation so far, and turns
   * the answer into what the page shows.
   * @param {import('firebase/ai').Content} message
   * @param {boolean} [fromApp]
   * @returns {Promise<ChatReply>}
   */
  async function exchange(message, fromApp = false) {
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
      if (fromApp && SKIP.test(reply)) return { kind: 'skip', text: '' };
      // Gemini keeps seeing its own [[Name]], {{task: }}, {{remember: }} and {{mentor}} markers;
      // the student sees plain names and the task in quotes, plus links and the cards. Offers and
      // notes come out first, as tasksInReply takes out any marker it doesn't know.
      history.push(message, { role: 'model', parts: [{ type: 'text', text: reply }] });
      const { text: withoutOffers, offers } = offersInReply(reply);
      const { text: withoutNotes, notes } = notesInReply(withoutOffers);
      const { text: withoutTasks, tasks } = tasksInReply(withoutNotes);
      const { text: shown, links } = linksInReply(withoutTasks, CHAT_CAMPUS);
      return { kind: 'reply', text: shown, links, tasks, offers, notes };
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

  return {
    /**
     * Swaps in a model with new instructions (what the app knows has changed, such as a mentor match
     * made in the chat), keeping the conversation so far.
     * @param {Pick<import('firebase/ai').GenerativeModel, 'generateContent'>} next
     */
    useModel(next) {
      model = next;
    },

    /**
     * Sends the student's message and returns what to show back.
     * @param {string} text
     * @returns {Promise<ChatReply>}
     */
    async send(text) {
      // Layer 1: checked here, and not sent to Gemini (see safety.js).
      if (isCrisis(text)) return { kind: 'safety', text: SAFETY_MESSAGE };
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      return exchange({
        role: 'user',
        // Emails and phone numbers are blanked first, so they're never sent to Google.
        parts: [{ type: 'text', text: blankContactDetails(notFromApp(text)) }]
      });
    },

    /**
     * Sends one of the app's own notes, which the student never sees, so Gemini writes the next
     * message itself: for now, straight after they find a mentor (afterMentorNote in chat-prompt.js).
     * Gemini may answer {{skip}} to say nothing (while they seem worried or upset): that comes back
     * as 'skip', and the exchange is dropped, as if it never happened.
     * @param {string} note
     * @returns {Promise<ChatReply>}
     */
    async sendFromApp(note) {
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      return exchange({ role: 'user', parts: [{ type: 'text', text: note }] }, true);
    }
  };
}
