import { isCrisis, SAFETY_MESSAGE, seemsWorried } from '#lib/checkin/safety.js';
import { APP_NOTE_START, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { CHAT_PAGES, cardsFor, chatTools, FINDERS, howTo, linkFor, MAX_QUICK, searchCatalogue, standardTask } from '#lib/checkin/chat-tools.js';
import { saidIt } from '#lib/checkin/chat-do.js';
import { screenNote } from '#lib/checkin/remember-notes.js';
import { talkFor } from '#lib/checklist/how-to.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import { chatOptions, describeForGemini } from '#lib/checkin/opener.js';

// The check-in chat's conversation with Gemini. Every message goes with the conversation so far and
// one set of instructions (chat-prompt.js); Gemini writes the reply in its own words, and when it needs
// to look something up or do something it calls one of the app's tools (chat-tools.js). The app
// carries out each call (lookups here; changes through chat-do.js, which the page or a script passes
// in as act), tells Gemini how it went, and Gemini carries on until it has its reply. chat.js gives it
// the Gemini model; it's kept apart so the checks run it in Node with a made-up model, and the scripts
// with the real one through the Firebase SDK.

/** Only the last this-many exchanges are sent each time, so a long chat can't grow without limit. */
const MAX_EXCHANGES = 12;
/** Gemini may look things up or do things this many times for one message; then it has to reply. */
const MAX_ROUNDS = 4;

/** For a failure that may pass (a blip, or too many requests at once). */
export const ERROR_MESSAGE =
  'Sorry, I can’t reply right now. Please try again in a minute. If you need support now, use the Need help now page.';
/** For when Gemini's prepaid credit has run out: trying again won't help until it's topped up. */
export const UNAVAILABLE_MESSAGE =
  'Sorry, the chat isn’t available right now. If you need support now, use the Need help now page.';

/**
 * A student's message, changed so it can't pass for one of the app's notes (see APP_NOTE_START).
 * @param {string} text
 */
const notFromApp = (text) => text.replace(/\[(\s*from the app)/gi, '($1');

/**
 * Saying it has done something itself: kept only when the app really did something this turn.
 * Without, the sentence goes, so the chat never says something is done that isn't.
 */
const CLAIMS = [
  /\bI(?:'|’)ve (?:just )?(?:ticked|unticked|added|removed|renamed|remembered|saved|forgotten|set (?:up )?(?:a |the )?reminder)\b/i,
  /\bI (?:have )?(?:just )?(?:ticked|unticked|added|removed|renamed|remembered|forgot)\b/i,
  /\b(?:has|have) been (?:ticked|added|removed|saved|remembered)\b/i
];

/**
 * A reply for the page to show: 'reply' from Gemini; 'safety' (the fixed support message); 'error'
 * (try again in a minute); 'unavailable' (the credit has run out, so the chat stops).
 * - links: cards for the societies, clubs and services it named (from its searches), then buttons
 *   (a task's link, such as the Student Portal, or an app page)
 * - changes: the changes the app made for it, each a line with Undo (chat-do.js)
 * - quick: quick replies under the reply
 * - tool: the GP finder, the dentist search or the key contacts card; ask4help: the Ask4Help card;
 *   calendar: a calendar card for this
 * - tasks: a reminder it suggested (they didn't ask), for the Add / No thanks card; notes: something
 *   it offered to remember, for the Remember / Not now card
 * - offers: the chat's own cards (chat-actions.js): 'mentor' (offer to find one), 'your-mentor' (their
 *   mentor), 'change-mentor' (the form to ask for a different one)
 * - start: an action to start straight after the reply: 'mentor' (the six questions, here)
 * @typedef {{ kind: 'reply' | 'safety' | 'error' | 'unavailable', text: string,
 *   links?: import('#lib/suggestions/catalogue.js').ReplyLink[],
 *   changes?: { text: string, undo: import('#lib/checkin/chat-do.js').Undo }[],
 *   quick?: { label: string, value: string }[], tool?: 'gp-finder' | 'dentist-finder' | 'contacts', ask4help?: boolean,
 *   calendar?: { title: string }, tasks?: string[], notes?: string[], offers?: string[], start?: 'mentor' }} ChatReply
 */

/**
 * What the chat is told about the student: describeForGemini's input (opener.js), kept so it can be
 * told again when it changes, such as a mentor found in the chat.
 * @typedef {Parameters<typeof describeForGemini>[0]} ChatFacts
 */

/**
 * The changes the app makes for Gemini's tools (chat-do.js's createChatDo, with the page's stores).
 * @typedef {ReturnType<typeof import('#lib/checkin/chat-do.js').createChatDo>} Act
 */

/**
 * The chat's turns with the given model. The conversation is kept here only: it isn't saved
 * anywhere, and nobody else can see it.
 *
 * It keeps its own list of exchanges (each the student's message, any tool calls and their results,
 * and the reply), and sends the latest each time, rather than using the SDK's chat session: a chat
 * session keeps a failed send and throws the same error for every later message, so one blip would
 * break the chat until the page reloads. Here a failed message is simply never added. Gemini's own
 * parts are kept exactly as it sent them (Gemini 3 checks the signatures on its tool calls).
 *
 * Once Gemini says the prepaid credit has run out (HTTP 402), nothing more is sent: every later
 * message gets the "isn't available" reply straight away, apart from the crisis check, which never
 * needs Gemini.
 * @param {Pick<import('firebase/ai').GenerativeModel, 'generateContent'>} model
 * @param {{ facts: ChatFacts, act?: Act, seed?: [string, string][] }} start what the app knows; act:
 *   how the app makes changes (without it, Gemini is told it can't); seed: a conversation so far, as
 *   pairs of the student's message and the chat's words, for the scripts (the app always starts afresh)
 */
export function chatWith(model, { facts, act, seed = [] }) {
  /** @type {import('firebase/ai').Content[][]} each exchange: the student's message (or the app's note), tool calls and results, the reply */
  const exchanges = seed.map(([student, chat]) => [
    { role: 'user', parts: [textPart(student)] },
    { role: 'model', parts: [textPart(chat)] }
  ]);
  /** The student's messages, newest first, to check words Gemini says are theirs (chat-do.js saidIt). */
  const typed = seed.map(([student]) => student).reverse();
  /** Every name a search has returned in this conversation: only these can become cards. */
  const found = new Set(/** @type {string[]} */ ([]));
  /** Things the app tells Gemini with the next message (such as an Undo). */
  let pending = /** @type {string[]} */ ([]);
  let unavailable = false;

  /**
   * Carries out one of Gemini's tool calls, adding what it shows to the reply, and returns what
   * Gemini is told.
   * @param {{ name: string, args?: Record<string, any> }} call
   * @param {ChatReply} reply
   * @returns {Promise<Record<string, unknown>>}
   */
  async function run(call, reply) {
    const args = call.args ?? {};
    switch (call.name) {
      case 'search_societies_clubs_services': {
        const results = searchCatalogue(String(args.query ?? ''));
        for (const result of results) found.add(result.name);
        return results.length ? { results } : { results: [], note: 'Nothing the app has fits that. Say so plainly, and suggest the nearest thing if a search for it finds one.' };
      }
      case 'how_to': {
        const id = standardTask(String(args.task ?? ''));
        if (!id) return { error: 'Not one of the standard tasks.' };
        const tool = talkFor(id)?.tool;
        if (tool === 'gp-finder' || tool === 'dentist-finder' || tool === 'contacts') reply.tool = tool;
        const link = linkFor(id);
        if (link && !reply.links?.some((shown) => shown.href === link.href)) reply.links = [...(reply.links ?? []), link];
        return howTo(String(args.task));
      }
      case 'change_checklist': {
        if (!act) return { done: false, why: "The app can't change the checklist from here." };
        const done = await act.checklist(/** @type {any} */ (args), typed);
        if (done.line) reply.changes = [...(reply.changes ?? []), done.line];
        if (done.quick) reply.quick = done.quick;
        if (done.tasks) facts = { ...facts, tasks: done.tasks, checklistSaved: true };
        return done.forGemini;
      }
      case 'remember':
      case 'forget': {
        if (!act) return { done: false, why: "The app can't do that from here." };
        const done = call.name === 'remember' ? await act.remember(String(args.note ?? '')) : await act.forget(String(args.note ?? ''));
        if (done.line) reply.changes = [...(reply.changes ?? []), done.line];
        if (done.notes) facts = { ...facts, profile: { ...facts.profile, notes: done.notes } };
        return done.forGemini;
      }
      case 'offer_to_remember': {
        const note = String(args.note ?? '').trim();
        if (!note || screenNote(note) !== null) return { shown: false, why: 'The app never remembers anything about health, money, worries, safety, other people or contact details.' };
        reply.notes = [note];
        return { shown: true };
      }
      case 'suggest_reminder': {
        const task = String(args.task ?? '').trim();
        if (!task) return { shown: false };
        reply.tasks = [task];
        return { shown: true, note: 'The card has Add and No thanks: only their tap adds it.' };
      }
      case 'show_finder': {
        const which = args.which === 'dentist' ? 'dentist' : 'gp';
        reply.tool = which === 'gp' ? 'gp-finder' : 'dentist-finder';
        return { shown: true, how_it_works: FINDERS[which] };
      }
      case 'show_key_contacts':
        reply.tool = 'contacts';
        return { shown: true };
      case 'show_ask4help':
        reply.ask4help = true;
        return { shown: true };
      case 'show_calendar':
        reply.calendar = { title: String(args.title ?? '').slice(0, 80) };
        return { shown: true, note: 'They save it in their own calendar: the app keeps nothing.' };
      case 'show_page': {
        const page = CHAT_PAGES[/** @type {keyof typeof CHAT_PAGES} */ (args.page)];
        if (!page) return { shown: false };
        reply.links = [...(reply.links ?? []), { ...page, external: false }];
        return { shown: true };
      }
      case 'mentor': {
        const options = chatOptions(facts);
        const action = String(args.action ?? '');
        if (action === 'show') reply.offers = ['your-mentor'];
        else if (action === 'change' && options.hasMentor) reply.offers = ['change-mentor'];
        else if (action === 'offer' && options.mentor !== 'no') reply.offers = ['mentor'];
        else if (action === 'find' && options.mentor !== 'no') reply.start = 'mentor';
        else return { done: false, why: 'Not for this student (see what the app knows about their mentor).' };
        return action === 'find' ? { started: true, note: 'The app asks the six questions next, here in the chat.' } : { shown: true };
      }
      case 'suggest_replies': {
        const replies = Array.isArray(args.replies) ? args.replies.map((text) => String(text).trim()).filter((text) => text && text.length <= 40).slice(0, MAX_QUICK) : [];
        if (replies.length) reply.quick = replies.map((text) => ({ label: text, value: text }));
        return { shown: replies.length > 0 };
      }
      default:
        return { error: 'No such tool.' };
    }
  }

  /**
   * One exchange: sends the message (with the conversation so far), carries out Gemini's tool calls,
   * and returns its reply, keeping the exchange only if it worked.
   * @param {string} text the student's message, or one of the app's notes
   * @returns {Promise<ChatReply>}
   */
  async function exchange(text) {
    const notes = pending.length ? `${APP_NOTE_START} ${pending.join('; ')}.]\n` : '';
    /** @type {import('firebase/ai').Content[]} */
    const turn = [{ role: 'user', parts: [textPart(`${notes}${text}`)] }];
    /** @type {ChatReply} */
    const reply = { kind: 'reply', text: '' };
    try {
      for (let round = 0; ; round++) {
        const last = round === MAX_ROUNDS;
        const result = await model.generateContent(
          /** @type {any} */ ({
            contents: [...exchanges.slice(-MAX_EXCHANGES).flat(), ...turn],
            systemInstruction: chatInstructions(describeForGemini(facts)),
            tools: chatTools(facts),
            // Out of rounds: it has to reply now.
            ...(last ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } } : {})
          })
        );
        const response = result.response;
        // If Gemini's own safety filters stop the reply, the student still gets the support message.
        if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
          return { kind: 'safety', text: SAFETY_MESSAGE };
        }
        const content = response.candidates?.[0]?.content;
        const calls = (content?.parts ?? []).filter((part) => 'functionCall' in part && part.functionCall);
        if (calls.length === 0 || last) {
          reply.text = (content?.parts ?? []).map((part) => ('text' in part && !('thought' in part && part.thought) ? part.text ?? '' : '')).join('').trim();
          if (content) turn.push(content);
          break;
        }
        if (content) turn.push(content);
        /** @type {import('firebase/ai').Part[]} */
        const results = [];
        for (const part of calls) {
          const call = /** @type {{ name: string, args?: Record<string, any> }} */ (/** @type {any} */ (part).functionCall);
          results.push(/** @type {import('firebase/ai').Part} */ ({ type: 'functionResponse', functionResponse: { name: call.name, response: await run(call, reply) } }));
        }
        turn.push({ role: 'user', parts: results });
      }
    } catch (err) {
      if (isOutOfCredit(err)) {
        unavailable = true;
        console.error('The check-in chat is unavailable: Gemini’s prepaid credit has run out (HTTP 402).');
        return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      }
      console.error('The check-in chat could not reply:', err);
      return { kind: 'error', text: ERROR_MESSAGE };
    }
    // Nothing said and nothing shown: try again in a minute, rather than an empty bubble.
    const shows = Boolean(reply.changes?.length || reply.tool || reply.ask4help || reply.calendar || reply.tasks?.length || reply.notes?.length || reply.offers?.length || reply.start || reply.links?.length);
    if (!reply.text && !shows) {
      console.error('The check-in chat could not reply: Gemini said nothing.');
      return { kind: 'error', text: ERROR_MESSAGE };
    }
    const said = reply.changes?.length ? reply.text : withoutClaims(reply.text);
    if (said !== reply.text) {
      reply.text = said;
      // What the student saw is what Gemini remembers saying.
      turn[turn.length - 1] = { role: 'model', parts: [textPart(said)] };
    }
    reply.links = [...cardsFor(reply.text, found), ...(reply.links ?? [])];
    pending = [];
    exchanges.push(turn);
    return reply;
  }

  return {
    /**
     * Tells the chat what the app knows now (for example after finding a mentor in the chat),
     * keeping the conversation so far.
     * @param {ChatFacts} next
     */
    retell(next) {
      facts = next;
    },

    /** What the app knows now. */
    facts: () => facts,

    /** Whether anything they've said lately seems worried or upset (safety.js), so nothing upbeat is sent unasked. */
    seemedWorried: () => typed.some(seemsWorried),

    /**
     * Something the app tells Gemini with the student's next message, such as an Undo they tapped.
     * @param {string} note
     */
    tell(note) {
      pending = [...pending, note].slice(-4);
    },

    /**
     * Sends the student's message and returns what to show back.
     * @param {string} text
     * @returns {Promise<ChatReply>}
     */
    async send(text) {
      // Checked here, and not sent to Gemini (see safety.js).
      if (isCrisis(text)) return { kind: 'safety', text: SAFETY_MESSAGE };
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      // Emails, phone numbers and postcodes are blanked first, so they're never sent to Google.
      const clean = blankContactDetails(notFromApp(text));
      typed.unshift(clean);
      typed.length = Math.min(typed.length, 3);
      return exchange(clean);
    },

    /**
     * One of the app's notes, for Gemini to answer itself: the first message when they open the chat,
     * or the message straight after they find a mentor (chat-prompt.js).
     * @param {string} note
     * @returns {Promise<ChatReply>}
     */
    async prompt(note) {
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      return exchange(note);
    }
  };
}

/**
 * A text part, as the Firebase SDK types it (it strips the type before sending).
 * @param {string} text
 * @returns {import('firebase/ai').Part}
 */
const textPart = (text) => /** @type {import('firebase/ai').Part} */ ({ type: 'text', text });

/**
 * The reply without sentences saying it has done something (CLAIMS), for a turn where the app did
 * nothing.
 * @param {string} text
 */
export function withoutClaims(text) {
  if (!CLAIMS.some((claim) => claim.test(text))) return text;
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  return sentences.filter((sentence) => !CLAIMS.some((claim) => claim.test(sentence))).join('').trim();
}

export { saidIt };
