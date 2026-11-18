import { findPage } from '#lib/checkin/app-pages.js';
import { CHAT_PAGES, OWN_TASK } from '#lib/checkin/chat-prompt.js';
import { FINDER_LINES, talkFor } from '#lib/checklist/how-to.js';
import { MAX_TITLE_LENGTH } from '#lib/checklist/tasks.js';
import { screenNote } from '#lib/checkin/remember-notes.js';
import { existingTask } from '#lib/checkin/task-suggestions.js';

// Reads Gemini's JSON replies in the check-in chat, and checks each one again against what the app
// allowed for that turn, whatever the schema said: only names from that turn's short list become
// cards, only the allowed pages and actions count, a task must really be on their checklist, a
// reminder must fit on it, and a note to remember must pass screenNote. Anything else is dropped, so
// the student never sees a made-up or misspelt name, a stray marker or a card that does nothing.
// No Firebase here, so the checks can test it in Node.

/** The most links one reply can have, cards and page buttons together, whatever Gemini writes. */
export const MAX_LINKS = 3;

/**
 * Gemini's words, tidied for the student: any [[ ]] or {{ }} left over from an older habit is taken
 * out (keeping a name inside), and spacing tidied.
 * @param {unknown} value
 */
export function tidySay(value) {
  return typeof value === 'string'
    ? value
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/\[\[|\]\]|\{\{|\}\}/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([.,!?])/g, '$1')
        .trim()
    : '';
}

/**
 * A last sentence offering to remember something ("Want me to remember that?"), which the Remember
 * card asks instead; with no card, there'd be nothing to answer. "Remember to bring photo ID." stays.
 */
const OFFERS_TO_REMEMBER = /[^.!?\n]*\b(want me to|like me to|shall I|should I|can I|could I|I can|I could|I'll|I will)\s+(remember|make a note|note|save|keep)\b[^.!?\n]*[.!?]?\s*$/i;

/**
 * A sentence saying a reminder the chat is only suggesting has been added ("I've added that to your
 * list"): it hasn't, until they tap Add on its card. (When they ask for one, the app adds it straight
 * away and confirms it itself.)
 */
const CLAIMS_ADDED = /[^.!?\n]*\b(I(?:'|’)ve|I have|I(?:'|’)ll|I will|I(?:'|’)m going to|I(?:'|’)m|it(?:'|’)s|that(?:'|’)s|has been|have been|is now)\s+(?:just\s+|now\s+|been\s+)?(added|adding|saved|saving|set|setting|put|putting|created|creating)\b[^.!?\n]*[.!?]?\s*/gi;

/** What the chat says with a reminder when Gemini's own words only claimed to have added it. */
export const REMINDER_OFFER = 'Here’s a reminder you can add to your checklist.';

/** What the chat says when asked to remember something it never keeps (screenNote). */
export const NOT_REMEMBERED = 'To keep things private, I don’t remember anything about health, money, worries, safety, other people or contact details.';

/** The actions that change something, which the app confirms in a line of its own. */
const CHANGES = ['tick', 'untick', 'add-task', 'remove-task', 'rename-task', 'remember', 'forget'];

/** What the chat says with the key contacts or Ask4Help when Gemini gave no words of its own. */
const CARD_WORDS = { contacts: 'Here are the key numbers to save in your phone.', ask4help: 'Ask4Help can sort that out with you.' };

/**
 * The JSON in a reply, or null if it isn't an object.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function parse(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The suggestions Gemini picked that really are on this turn's short list: each once, at most 3.
 * @param {unknown} picked
 * @param {import('#lib/suggestions/shortlist.js').Shortlisted[]} shortlist
 */
function pickedFrom(picked, shortlist) {
  /** @type {import('#lib/suggestions/catalogue.js').Suggestion[]} */
  const kept = [];
  for (const name of Array.isArray(picked) ? picked : []) {
    const found = typeof name === 'string' ? shortlist.find(({ suggestion }) => suggestion.name.toLowerCase() === name.trim().toLowerCase()) : null;
    if (found && !kept.includes(found.suggestion) && kept.length < 3) kept.push(found.suggestion);
  }
  return kept;
}

/** A reminder's task as Gemini wrote it, tidied: one line, no quotes or full stop. @param {unknown} value */
function tidyTask(value) {
  return typeof value === 'string'
    ? value
        .replace(/\[\[|\]\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'“”‘’]+|["'“”‘’.!?]+$/g, '')
        .trim()
    : '';
}

/**
 * One action Gemini chose, as the app read it: a task on their checklist (taskId, one of the standard
 * ones; or own: one of their own, which the app matches on their words; or neither: not clear), a
 * title (a task to add, a new name, or what to put in their calendar), text (a note, or a suggested
 * reminder), or which note to forget.
 * @typedef {{ id: string, taskId?: string, own?: boolean, title?: string, text?: string, which?: string }} ReadAction
 */

/**
 * An ordinary chat reply, checked: what to say, the cards and page button under it (links), and at
 * most one action.
 * - say: Gemini's words, tidied, without a last sentence offering to remember something (see
 *   OFFERS_TO_REMEMBER)
 * - links: the suggestions it picked from this turn's short list, then the page, at most MAX_LINKS
 * - action: one the app allowed this turn. A task must be a standard one on their checklist ("one of
 *   their own" is matched by the app); a suggested reminder already there says so instead, and a
 *   claim that it's been added goes; a note to remember must pass screenNote (otherwise the chat says
 *   it doesn't keep that); only a note it remembers can be forgotten
 * - a change (a checklist edit, remembering or forgetting) has no words of Gemini's: the app's own
 *   line confirming it, or asking which task, is the reply
 * - the GP finder and dentist search come with the app's own words on finding and registering
 *   (FINDER_LINES), so the chat never refuses to help find one
 * - going through the checklist: the app asks the questions, so its one-line offer is the whole reply
 *   to "now what?", and Gemini's words never ask one before the first question
 * @param {string} text Gemini's reply
 * @param {{ shortlist: import('#lib/suggestions/shortlist.js').Shortlisted[], actions: string[],
 *   tasks?: import('#lib/checklist/tasks.js').Task[] | null, notes?: string[] }} turn
 *   tasks: their checklist, if known; notes: what the chat remembers
 * @returns {{ say: string, links: import('#lib/suggestions/catalogue.js').ReplyLink[], suggested: string[], action: ReadAction | null } | null}
 *   null if it isn't a reply at all
 */
export function readChatReply(text, { shortlist, actions, tasks = null, notes = [] }) {
  const reply = parse(text);
  if (!reply) return null;
  const suggested = pickedFrom(reply.suggest, shortlist);
  const page = typeof reply.page === 'string' && CHAT_PAGES.includes(reply.page) ? findPage(reply.page) : null;
  let say = tidySay(reply.say).replace(OFFERS_TO_REMEMBER, '').trim();
  const id = typeof reply.action === 'string' && actions.includes(reply.action) ? reply.action : null;

  /** The task Gemini named: a standard one on their checklist, one of their own, or not clear. */
  const task = () => {
    const named = typeof reply.task === 'string' ? (tasks ?? []).find((item) => item.title === reply.task && talkFor(item.id)) : null;
    return named ? { taskId: named.id } : reply.task === OWN_TASK ? { own: true } : {};
  };

  /** @type {ReadAction | null} */
  let action = null;
  switch (id) {
    case null:
      break;
    case 'tick':
    case 'untick':
    case 'remove-task':
      action = { id, ...task() };
      break;
    case 'rename-task':
      action = { id, ...task(), title: tidyTask(reply.title) };
      break;
    case 'add-task':
    case 'calendar':
      action = { id, title: tidyTask(reply.title) };
      break;
    case 'reminder': {
      const title = tidyTask(reply.title);
      const existing = title && tasks ? existingTask(tasks, title) : null;
      if (existing) {
        say = `That’s already on your checklist: “${existing.title}”.`;
      } else if (title && title.length <= MAX_TITLE_LENGTH && !/[[\]]/.test(title)) {
        action = { id, text: title };
        say = say.replace(CLAIMS_ADDED, ' ').replace(/\s{2,}/g, ' ').trim() || REMINDER_OFFER;
      }
      break;
    }
    case 'remember':
    case 'offer-to-remember': {
      const note = tidyTask(reply.note);
      if (screenNote(note) === null) action = { id, text: note };
      else if (id === 'remember' && note) say = NOT_REMEMBERED;
      break;
    }
    case 'forget': {
      const which = typeof reply.forget === 'string' ? reply.forget : '';
      if (which === 'everything' || notes.includes(which)) action = { id, which };
      break;
    }
    case 'how-to': {
      const named = task();
      if (named.taskId) action = { id, taskId: named.taskId };
      break;
    }
    case 'checklist': {
      // The task they named, if it's one still to do.
      const named = task();
      const left = named.taskId ? tasks?.find((item) => item.id === named.taskId && !item.done) : null;
      action = left ? { id, taskId: left.id } : { id };
      break;
    }
    case 'gp-finder':
    case 'dentist-finder':
      // The app's own words from the how-to: it never refuses to help find one.
      action = { id };
      say = FINDER_LINES[id === 'gp-finder' ? 'gp' : 'dentist'];
      break;
    case 'contacts':
    case 'ask4help':
      action = { id };
      say = say || CARD_WORDS[id];
      break;
    default:
      action = { id };
  }

  // When the app changes something (or asks which task), its one line is the reply: Gemini's own
  // words could only repeat it, or claim it's done before the app has asked which one.
  if (action && CHANGES.includes(action.id)) say = '';
  // Going through the checklist: the app asks the questions. Its one-line offer is the whole reply to
  // "now what?", and before the first question, Gemini's words can't ask one too.
  if (action?.id === 'checklist-offer' || (action?.id === 'checklist' && say.includes('?'))) say = '';
  const links = [...suggested.map((suggestion) => suggestion.link), ...(page ? [{ label: page.name, href: page.href, external: false }] : [])].slice(0, MAX_LINKS);
  if (!say && !action && !links.length) return null;
  return { say, links, suggested: suggested.map((suggestion) => suggestion.name), action };
}

/**
 * The reply straight after they find a mentor, checked: skip (say nothing), or what to say with the
 * suggestions it picked from the short list.
 * @param {string} text
 * @param {{ shortlist: import('#lib/suggestions/shortlist.js').Shortlisted[] }} turn
 * @returns {{ skip: true } | { skip: false, say: string, links: import('#lib/suggestions/catalogue.js').ReplyLink[], suggested: string[] } | null}
 */
export function readAfterMatchReply(text, { shortlist }) {
  const reply = parse(text);
  if (!reply) return null;
  if (reply.skip === true) return { skip: true };
  const say = tidySay(reply.say);
  if (!say) return null;
  const suggested = pickedFrom(reply.suggest, shortlist);
  return { skip: false, say, links: suggested.map((suggestion) => suggestion.link), suggested: suggested.map((suggestion) => suggestion.name) };
}

/** What the chat asks when Gemini finds an answer unclear but gives no question of its own. */
export const UNCLEAR_FALLBACK = 'Is that a yes, or not yet?';

/**
 * A typed answer to the chat's question about a checklist task, as Gemini read it (checklist-talk.js):
 * what it means, and for an unclear one, the one short question to ask back.
 * @param {string} text
 * @returns {{ answer: 'yes' | 'not-yet' | 'unclear' | 'stop' | 'other', say: string } | null}
 */
export function readChecklistAnswer(text) {
  const reply = parse(text);
  const answer = reply?.answer;
  if (answer !== 'yes' && answer !== 'not-yet' && answer !== 'unclear' && answer !== 'stop' && answer !== 'other') return null;
  const say = answer === 'unclear' ? tidySay(reply?.say) || UNCLEAR_FALLBACK : '';
  return { answer, say };
}

/**
 * Gemini's help with a checklist task, checked: what their message was about, what to say (needed
 * when it's about the task), whether to show Ask4Help, and any societies it suggested from the short
 * list (for joining a society).
 * @param {string} text
 * @param {{ shortlist: import('#lib/suggestions/shortlist.js').Shortlisted[] }} turn
 * @returns {{ about: 'task' | 'done' | 'move-on' | 'stop' | 'other', say: string, ask4help: boolean,
 *   links: import('#lib/suggestions/catalogue.js').ReplyLink[], suggested: string[] } | null}
 */
export function readChecklistHelp(text, { shortlist }) {
  const reply = parse(text);
  const about = reply?.about;
  if (about !== 'task' && about !== 'done' && about !== 'move-on' && about !== 'stop' && about !== 'other') return null;
  const say = tidySay(reply?.say);
  if (about === 'task' && !say) return null;
  const suggested = pickedFrom(reply?.suggest, shortlist);
  return { about, say, ask4help: reply?.ask4help === true, links: suggested.map((suggestion) => suggestion.link), suggested: suggested.map((suggestion) => suggestion.name) };
}
