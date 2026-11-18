import { findPage } from '#lib/checkin/app-pages.js';
import { CHAT_PAGES } from '#lib/checkin/chat-prompt.js';
import { MAX_TITLE_LENGTH } from '#lib/checklist/tasks.js';
import { screenNote } from '#lib/checkin/remember-notes.js';
import { existingTask } from '#lib/checkin/task-suggestions.js';

// Reads Gemini's JSON replies in the check-in chat, and checks each one again against what the app
// allowed for that turn, whatever the schema said: only names from that turn's short list become
// cards, only the allowed pages and actions count, a reminder must fit on the checklist, and a note
// to remember must pass screenNote. Anything else is dropped, so the student never sees a made-up
// or misspelt name, a stray marker or a card that does nothing. No Firebase here, so the checks can
// test it in Node.

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
 * A sentence saying the chat has added (or will add) a reminder itself, which only the student's tap
 * on Add can do: "I've added that to your list", "I have set a reminder", "It's been saved".
 */
const CLAIMS_ADDED = /[^.!?\n]*\b(I(?:'|’)ve|I have|I(?:'|’)ll|I will|I(?:'|’)m going to|I(?:'|’)m|it(?:'|’)s|that(?:'|’)s|has been|have been|is now)\s+(?:just\s+|now\s+|been\s+)?(added|adding|saved|saving|set|setting|put|putting|created|creating)\b[^.!?\n]*[.!?]?\s*/gi;

/** What the chat says with a reminder when Gemini's own words only claimed to have added it. */
export const REMINDER_OFFER = 'Here’s a reminder you can add to your checklist.';

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
 * An ordinary chat reply, checked: what to say, the cards and page button under it (links), and at
 * most one action (what the app offers or shows).
 * - say: Gemini's words, tidied, without a last sentence offering to remember something (see
 *   OFFERS_TO_REMEMBER)
 * - links: the suggestions it picked from this turn's short list, then the page, at most MAX_LINKS
 * - action: one the app allowed this turn; a reminder only with a task that fits on the checklist
 *   (and no blanked contact detail), and remember only with a note screenNote allows
 * - a reminder already on their checklist isn't offered: the reply says it's there instead; and any
 *   sentence saying the chat has added a reminder goes, as only their tap on Add can
 * - with their mentor's card or the form, no Your Mentor page button too
 * @param {string} text Gemini's reply
 * - the checklist action may name the task to start at: only one still to do on their checklist; with
 *   it, Gemini's words never ask a question (the app asks about the task), and with the one-line
 *   offer (checklist-offer) the app's offer is the whole reply
 * @param {{ shortlist: import('#lib/suggestions/shortlist.js').Shortlisted[], actions: string[],
 *   tasks?: import('#lib/checklist/tasks.js').Task[] | null }} turn tasks: their checklist, if known
 * @returns {{ say: string, links: import('#lib/suggestions/catalogue.js').ReplyLink[], suggested: string[],
 *   action: { id: string, text?: string, task?: string } | null } | null} null if it isn't a reply at all
 */
export function readChatReply(text, { shortlist, actions, tasks = null }) {
  const reply = parse(text);
  if (!reply) return null;
  const suggested = pickedFrom(reply.suggest, shortlist);
  const page = typeof reply.page === 'string' && CHAT_PAGES.includes(reply.page) ? findPage(reply.page) : null;

  /** @type {{ id: string, text?: string, task?: string } | null} */
  let action = null;
  let say = tidySay(reply.say).replace(OFFERS_TO_REMEMBER, '').trim();
  const id = typeof reply.action === 'string' && actions.includes(reply.action) ? reply.action : null;
  if (id === 'reminder') {
    const task = tidyTask(reply.reminder);
    const existing = task && tasks ? existingTask(tasks, task) : null;
    if (existing) {
      say = `That’s already on your checklist: “${existing.title}”.`;
    } else if (task && task.length <= MAX_TITLE_LENGTH && !/[[\]]/.test(task)) {
      action = { id, text: task };
      say = say.replace(CLAIMS_ADDED, ' ').replace(/\s{2,}/g, ' ').trim() || REMINDER_OFFER;
    }
  } else if (id === 'remember') {
    const note = tidyTask(reply.remember);
    if (screenNote(note) === null) action = { id, text: note };
  } else if (id === 'checklist') {
    // The task they named, by its title, if it's one still to do.
    const named = typeof reply.task === 'string' ? tasks?.find((task) => !task.done && task.title === reply.task) : null;
    action = named ? { id, task: named.id } : { id };
  } else if (id) {
    action = { id };
  }

  // Going through the checklist: the app asks the questions. Its one-line offer is the whole reply to
  // "now what?", and before the first question, Gemini's words can't ask one too.
  if (action?.id === 'checklist-offer' || (action?.id === 'checklist' && say.includes('?'))) say = '';
  // Their mentor's card or the form already link to the Your Mentor page.
  const pageShown = page && !(page.href === '/mentor' && (action?.id === 'your-mentor' || action?.id === 'change-mentor')) ? page : null;
  const links = [...suggested.map((suggestion) => suggestion.link), ...(pageShown ? [{ label: pageShown.name, href: pageShown.href, external: false }] : [])].slice(0, MAX_LINKS);
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
