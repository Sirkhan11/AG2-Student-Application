import { isCrisis, SAFETY_MESSAGE, seemsWorried } from '#lib/checkin/safety.js';
import { afterMatchRequest, afterMentorNote, APP_NOTE_START, chatRequest, checklistAnswerRequest, checklistHelpRequest } from '#lib/checkin/chat-prompt.js';
import { readAfterMatchReply, readChatReply, readChecklistAnswer, readChecklistHelp } from '#lib/checkin/chat-replies.js';
import { howToFor, howToLine, talkFor } from '#lib/checklist/how-to.js';
import { MAX_LINKS } from '#lib/checkin/chat-replies.js';
import { suggestionNamed } from '#lib/suggestions/catalogue.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import { aboutYou } from '#lib/checkin/about-you.js';
import { chatOptions, describeForGemini } from '#lib/checkin/opener.js';
import { shortlist } from '#lib/suggestions/shortlist.js';

// How the check-in chat sends each message and turns Gemini's answer into what the page shows. For
// each turn the app decides the mode (an ordinary chat message, or the message straight after finding
// a mentor), picks the short list of societies, clubs and services Gemini may suggest (shortlist.js),
// and sends that mode's instructions and reply shape (chat-prompt.js); chat-replies.js checks the
// reply. chat.js gives it the Gemini model; it's kept apart so the checks can run it in Node with a
// made-up model (check-checkin.mjs), and the measurements with Gemini over REST.

/** Only the last this-many messages are sent each time, so a long chat can't grow without limit. */
const MAX_HISTORY_MESSAGES = 20;

/** What the chat says after how to do a task outside the app (enrolling, joining a society…). */
export const TICK_OFF_LINE = 'Tell me when you’ve done it and I’ll tick it off.';

/** The checklist edit for each of Gemini's checklist actions. */
const EDITS = /** @type {const} */ ({ tick: 'tick', untick: 'untick', 'add-task': 'add', 'remove-task': 'remove', 'rename-task': 'rename' });

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
 * A reply for the page to show: 'reply' from Gemini, 'safety' (the fixed support message), 'error'
 * (try again in a minute), 'unavailable' (the credit has run out, so the chat stops), or, after one
 * of the app's own notes, 'skip' (Gemini chose to say nothing, so nothing is shown).
 * links are the real societies, clubs and NSU services Gemini suggested from the short list, and any
 * app page (see chat-replies.js); tasks is a checklist reminder it suggested, for the page's Add / No
 * thanks card; offers are the chat's own actions it chose, such as 'mentor', for the page's cards (see
 * chat-actions.js); notes is something it offered to remember, for the page's Remember / Not now card.
 * startAt: with the checklist action, the task they named, to start going through it there.
 * tool: a card the app shows under the reply (the GP finder, a dentist search, the key contacts);
 * ask4help: the Ask4Help card; calendar: a calendar card for this (Outlook on the web, or a file);
 * awaitDone: a task the chat has said it'll tick off when they say they've done it;
 * act: a change the app makes straight away, after showing the reply (a checklist edit, with what
 * they typed, for matching their own tasks; or remembering or forgetting something), confirmed in a
 * line of its own with Undo.
 * @typedef {{ kind: 'reply' | 'safety' | 'error' | 'unavailable' | 'skip', text: string,
 *   links?: import('#lib/suggestions/catalogue.js').ReplyLink[], tasks?: string[], offers?: string[],
 *   notes?: string[], startAt?: string, tool?: 'gp-finder' | 'dentist-finder' | 'contacts', ask4help?: boolean,
 *   calendar?: { title: string }, awaitDone?: string,
 *   act?: { edit: import('#lib/checkin/checklist-edits.js').EditRequest, said: string } | { remember: string } | { forget: string } }} ChatReply
 */

/**
 * What the chat is told about the student: describeForGemini's input (opener.js), kept so it can be
 * told again when it changes, such as a mentor found in the chat.
 * @typedef {Parameters<typeof describeForGemini>[0]} ChatFacts
 */

/**
 * The chat's turns with the given model. The conversation is kept here only: it isn't saved
 * anywhere, and nobody else can see it.
 *
 * It keeps its own list of the messages that got a reply, and sends that list each time, rather than
 * using the SDK's chat session. A chat session keeps a failed send and throws the same error for every
 * later message, so one blip would break the chat until the page reloads. Here a failed message is
 * simply never added, so the next one starts again from the last good point. Gemini's side of the
 * conversation is kept as the words it said, not its JSON.
 *
 * Once Gemini says the prepaid credit has run out (HTTP 402), nothing more is sent: every later
 * message gets the "isn't available" reply straight away, apart from the crisis check, which never
 * needs Gemini.
 * @param {Pick<import('firebase/ai').GenerativeModel, 'generateContent'>} model
 * @param {{ facts: ChatFacts, opener: string[], seed?: [string, string][] }} start what the app knows,
 *   and the first messages (without any names); seed is a conversation so far, as pairs of the
 *   student's message and the chat's words, for the measurements (the app always starts afresh)
 */
export function chatWith(model, { facts, opener, seed = [] }) {
  /** @type {import('firebase/ai').Content[]} the student's messages and Gemini's replies, in order */
  const history = seed.flatMap(([student, chat]) => [
    { role: 'user', parts: [{ type: 'text', text: student }] },
    { role: 'model', parts: [{ type: 'text', text: chat }] }
  ]);
  /** The student's messages, newest first, for the short list. */
  const said = seed.map(([student]) => student).reverse();
  /** The names suggested so far, newest first, so "How do I join?" can show the same card again. */
  let suggestedBefore = /** @type {string[]} */ ([]);
  let unavailable = false;

  /** The short list for a message, from it and what the app knows. @param {string} message */
  function shortlistFor(message) {
    const about = aboutYou(facts.profile);
    return shortlist({
      message,
      earlier: said.slice(0, 3),
      interests: about.interests,
      likes: about.summary?.likes ?? [],
      avoids: about.summary?.avoids ?? [],
      course: about.course,
      before: suggestedBefore
    });
  }

  /**
   * Sends one turn (the student's message, or one of the app's notes) with the conversation so far,
   * in the given mode, and reads the answer.
   * @template T
   * @param {import('firebase/ai').Content} message
   * @param {{ systemInstruction: string, generationConfig: import('firebase/ai').GenerationConfig }} request
   * @param {(text: string) => T | null} read
   * @returns {Promise<{ ok: true, reply: NonNullable<T> } | { ok: false, reply: ChatReply }>}
   */
  async function ask(message, request, read) {
    try {
      // Whole exchanges only, so what's sent always starts with one of the student's messages. Only
      // the fields Gemini accepts are sent, whatever the request builder returned: anything else
      // (such as the checklist chatRequest keeps for the app) makes Gemini refuse the whole request.
      const result = await model.generateContent({
        contents: [...history.slice(-MAX_HISTORY_MESSAGES), message],
        systemInstruction: request.systemInstruction,
        generationConfig: request.generationConfig
      });
      // Layer 3: if Gemini's own safety filters stop the reply, the student still gets the support message.
      const response = result.response;
      if (response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason === 'SAFETY') {
        return { ok: false, reply: { kind: 'safety', text: SAFETY_MESSAGE } };
      }
      const reply = read(response.text().trim());
      if (reply === null || reply === undefined) throw new Error('Gemini sent a reply the app couldn’t read.');
      return { ok: true, reply };
    } catch (err) {
      if (isOutOfCredit(err)) {
        unavailable = true;
        console.error('The check-in chat is unavailable: Gemini’s prepaid credit has run out (HTTP 402).');
        return { ok: false, reply: { kind: 'unavailable', text: UNAVAILABLE_MESSAGE } };
      }
      console.error('The check-in chat could not reply:', err);
      return { ok: false, reply: { kind: 'error', text: ERROR_MESSAGE } };
    }
  }

  /**
   * What the app allows in an ordinary turn: chatOptions (opener.js), with their checklist (the
   * standard tasks by title; their own only counted), how to do the standard ones still to do, and what
   * the chat remembers. Never a Remember card while they're asking something.
   * @param {string} clean their message, as sent
   * @returns {import('#lib/checkin/chat-prompt.js').ChatOptions}
   */
  function optionsFor(clean) {
    const tasks = facts.tasks ?? null;
    const standard = (tasks ?? []).filter((task) => talkFor(task.id));
    return {
      ...chatOptions(facts),
      remember: !clean.includes('?'),
      checklistKnown: tasks !== null,
      tasks: standard.map((task) => task.title),
      tasksLeft: standard.filter((task) => !task.done).map((task) => task.title),
      ownTasks: (tasks ?? []).some((task) => !talkFor(task.id)),
      howTo: standard.filter((task) => !task.done).map((task) => howToLine(task.id, task.title)).filter(Boolean),
      notes: aboutYou(facts.profile).notes
    };
  }

  /**
   * How to do a task outside the app: the direct link (the Student Portal, or the society they were
   * shown, whose card has "Join on the NSU website"), or the finder or contacts card for the ones done
   * elsewhere, and, while it's still to do, "Tell me when you've done it and I'll tick it off".
   * @param {string} id @param {string} say @param {import('#lib/suggestions/catalogue.js').ReplyLink[]} links
   * @returns {Partial<ChatReply>}
   */
  function outside(id, say, links) {
    const task = (facts.tasks ?? []).find((item) => item.id === id);
    const tool = talkFor(id)?.tool;
    const link = howToFor(id)?.link;
    /** @type {Partial<ChatReply>} */
    const extra = {};
    if (tool === 'gp-finder' || tool === 'dentist-finder' || tool === 'contacts') extra.tool = tool;
    if (tool === 'portal' && link) extra.links = [...links, { label: link.label, href: link.href, external: true }].slice(0, MAX_LINKS);
    if (tool === 'societies' && !links.some((item) => item.kind === 'society')) {
      const shown = suggestedBefore.map((name) => suggestionNamed(name)).find((suggestion) => suggestion?.kind === 'society');
      extra.links = [...links, shown ? shown.link : { label: 'Browse societies', href: '/societies', external: false }].slice(0, MAX_LINKS);
    }
    if (task && !task.done) {
      extra.text = `${say} ${TICK_OFF_LINE}`.trim();
      extra.awaitDone = task.id;
    }
    return extra;
  }

  /**
   * Keeps an exchange that got a reply: the message, and what Gemini said.
   * @param {import('firebase/ai').Content} message @param {string} say @param {string[]} suggested
   */
  function keep(message, say, suggested) {
    history.push(message, { role: 'model', parts: [{ type: 'text', text: say }] });
    if (suggested.length) suggestedBefore = [...suggested, ...suggestedBefore.filter((name) => !suggested.includes(name))].slice(0, 6);
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

    /**
     * Sends the student's message and returns what to show back.
     * @param {string} text
     * @returns {Promise<ChatReply>}
     */
    async send(text) {
      // Layer 1: checked here, and not sent to Gemini (see safety.js).
      if (isCrisis(text)) return { kind: 'safety', text: SAFETY_MESSAGE };
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      // Emails and phone numbers are blanked first, so they're never sent to Google.
      const clean = blankContactDetails(notFromApp(text));
      const list = shortlistFor(clean);
      const options = optionsFor(clean);
      const { actions, ...request } = chatRequest({ about: describeForGemini(facts), opener, shortlist: list, options });
      /** @type {import('firebase/ai').Content} */
      const message = { role: 'user', parts: [{ type: 'text', text: clean }] };
      const notes = options.notes ?? [];
      const answer = await ask(message, request, (reply) => readChatReply(reply, { shortlist: list, actions, tasks: facts.tasks, notes }));
      if (!answer.ok) return answer.reply;
      const { say, links, suggested, action } = answer.reply;
      /** @type {ChatReply} */
      const reply = { kind: 'reply', text: say, links, tasks: [], notes: [], offers: [] };
      const id = action?.id;
      if (action && id && id in EDITS) {
        reply.act = { edit: { edit: EDITS[/** @type {keyof typeof EDITS} */ (id)], taskId: action.taskId, own: action.own, title: action.title }, said: text };
      } else if (id === 'reminder' && action?.text) {
        reply.tasks = [action.text];
      } else if (id === 'offer-to-remember' && action?.text) {
        reply.notes = [action.text];
      } else if (id === 'remember' && action?.text) {
        reply.act = { remember: action.text };
      } else if (id === 'forget' && action?.which) {
        reply.act = { forget: action.which };
      } else if (id === 'gp-finder' || id === 'dentist-finder' || id === 'contacts') {
        reply.tool = id;
      } else if (id === 'ask4help') {
        reply.ask4help = true;
      } else if (id === 'calendar') {
        reply.calendar = { title: action?.title ?? '' };
      } else if (id === 'how-to' && action?.taskId) {
        Object.assign(reply, outside(action.taskId, say, links));
      } else if (id) {
        reply.offers = [id];
        if (action?.taskId) reply.startAt = action.taskId;
      }
      said.unshift(clean);
      // Gemini keeps what the student saw, the chat's line about ticking it off included.
      keep(message, reply.text, suggested);
      return reply;
    },

    /**
     * Straight after they find a mentor: Gemini writes the next message itself, from the app's note
     * (which the student never sees). If anything they've said in this chat seems worried or upset
     * (seemsWorried), nothing is sent and nothing is shown; Gemini may also choose to say nothing.
     * Either way that comes back as 'skip', and the exchange is dropped, as if it never happened.
     * @param {'matched' | 'coordinator'} outcome
     * @returns {Promise<ChatReply>}
     */
    async afterMatch(outcome) {
      if (unavailable) return { kind: 'unavailable', text: UNAVAILABLE_MESSAGE };
      if (said.some(seemsWorried)) return { kind: 'skip', text: '' };
      const list = shortlistFor('');
      const request = afterMatchRequest({ about: describeForGemini(facts), opener, shortlist: list });
      /** @type {import('firebase/ai').Content} */
      const message = { role: 'user', parts: [{ type: 'text', text: afterMentorNote(outcome) }] };
      const answer = await ask(message, request, (reply) => readAfterMatchReply(reply, { shortlist: list }));
      if (!answer.ok) return answer.reply;
      if (answer.reply.skip) return { kind: 'skip', text: '' };
      keep(message, answer.reply.say, answer.reply.suggested);
      return { kind: 'reply', text: answer.reply.say, links: answer.reply.links, tasks: [], notes: [], offers: [] };
    },

    /**
     * Going through the checklist (checklist-talk.js): reads a typed answer to the chat's question
     * about one task. For one of their own tasks, Gemini isn't told its words. The exchange isn't kept
     * here: the talk adds what the chat says next (note).
     * @param {string} text
     * @param {import('#lib/checklist/tasks.js').Task} task
     * @param {string} question what the chat asked
     * @returns {Promise<import('#lib/checkin/checklist-talk.js').Answer>}
     */
    async checklistAnswer(text, task, question) {
      if (isCrisis(text)) return { kind: 'failed', reply: { kind: 'safety', text: SAFETY_MESSAGE } };
      if (unavailable) return { kind: 'failed', reply: { kind: 'unavailable', text: UNAVAILABLE_MESSAGE } };
      const clean = blankContactDetails(notFromApp(text));
      const request = checklistAnswerRequest({ about: describeForGemini(facts), opener, question: talkFor(task.id) ? question : null });
      const answer = await ask({ role: 'user', parts: [{ type: 'text', text: clean }] }, request, readChecklistAnswer);
      if (!answer.ok) return { kind: 'failed', reply: answer.reply };
      said.unshift(clean);
      return { kind: 'answer', ...answer.reply };
    },

    /**
     * Going through the checklist: Gemini's help with one standard task they haven't done, from its
     * how-to only (never one of their own: those have none). first: the first help with it, when the
     * app shows the task's tool. fromApp: the message is one of the app's notes (after the task that
     * comes first is ticked), not theirs.
     * @param {string} text
     * @param {import('#lib/checklist/tasks.js').Task} task
     * @param {boolean} first
     * @param {boolean} [fromApp]
     * @returns {Promise<import('#lib/checkin/checklist-talk.js').Help>}
     */
    async checklistHelp(text, task, first, fromApp = false) {
      if (!fromApp && isCrisis(text)) return { kind: 'failed', reply: { kind: 'safety', text: SAFETY_MESSAGE } };
      if (unavailable) return { kind: 'failed', reply: { kind: 'unavailable', text: UNAVAILABLE_MESSAGE } };
      const howTo = howToFor(task.id);
      const talk = talkFor(task.id);
      if (!howTo || !talk) return { kind: 'failed', reply: { kind: 'error', text: ERROR_MESSAGE } };
      const clean = fromApp ? text : blankContactDetails(notFromApp(text));
      const list = talk.tool === 'societies' ? shortlistFor(fromApp ? '' : clean) : [];
      const request = checklistHelpRequest({ about: describeForGemini(facts), opener, title: task.title, howTo, talk, first, shortlist: list });
      /** @type {import('firebase/ai').Content} */
      const message = { role: 'user', parts: [{ type: 'text', text: clean }] };
      const help = await ask(message, request, (reply) => readChecklistHelp(reply, { shortlist: list }));
      if (!help.ok) return { kind: 'failed', reply: help.reply };
      if (!fromApp) said.unshift(clean);
      if (help.reply.about === 'task') keep(message, help.reply.say, help.reply.suggested);
      return { kind: 'help', about: help.reply.about, say: help.reply.say, ask4help: help.reply.ask4help, links: help.reply.links };
    },

    /**
     * Adds what was said without Gemini to its side of the conversation, so later turns know: the
     * student's words (a tap, or a typed answer the app read itself) and what the chat said, or with
     * no student words, more of what the chat said in its last message.
     * @param {string | null} student
     * @param {string} chat
     */
    note(student, chat) {
      if (student === null) {
        const last = history.at(-1);
        if (last?.role === 'model' && chat) {
          const before = last.parts.map((part) => ('text' in part ? part.text : '')).join('');
          history[history.length - 1] = { role: 'model', parts: [{ type: 'text', text: `${before} ${chat}`.trim() }] };
        }
        return;
      }
      const clean = blankContactDetails(notFromApp(student));
      said.unshift(clean);
      history.push({ role: 'user', parts: [{ type: 'text', text: clean }] }, { role: 'model', parts: [{ type: 'text', text: chat }] });
    }
  };
}

/** The app's note when the task that comes first is done, so Gemini helps with the one asked about. @param {string} first @param {string} then */
export const firstDoneNote = (first, then) => `${APP_NOTE_START} they've just said they've done "${first}", so now help them with "${then}".]`;
