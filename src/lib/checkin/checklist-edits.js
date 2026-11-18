import { talkFor } from '#lib/checklist/how-to.js';
import { makeAdd, makeDelete, makeEdit, makeTick, MAX_TASKS, MAX_TITLE_LENGTH } from '#lib/checklist/tasks.js';
import { existingTask } from '#lib/checkin/task-suggestions.js';

// Planning a change to a student's checklist that the chat was asked for: tick, untick, add, remove
// and rename ("I've joined that, tick it off", "add open a bank account", "take the dentist one off").
// Gemini says what they asked for and which task (a standard one by its title, "one of their own", or
// "not sure"); the app works out the task, checks the change is to one really on their list, and plans
// it (chat-do.js makes it, with Undo). When it isn't clear which task, the plan is to ask. A tick needs
// them to have said they've done it; otherwise the plan is to ask first. The words of their own tasks
// never go to Gemini: the app matches those itself, against what the student typed.
// No Firebase here (the page passes the checklist store in), so the checks can run it in Node.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/** @typedef {import('#lib/checklist/tasks.js').Change} Change */

/**
 * What Gemini asked for (its change_checklist tool, chat-tools.js): the edit, and the task as one of
 * their standard tasks (id), one of their own (own), or not clear; title is a new task's name (add)
 * or a new name (rename).
 * @typedef {{ edit: 'tick' | 'untick' | 'add' | 'remove' | 'rename', taskId?: string, own?: boolean, title?: string }} EditRequest
 */

/** What the chat says when it changes the checklist, and when it can't. */
export const EDIT_SAYS = Object.freeze({
  ticked: (/** @type {string} */ title) => `Ticked: ${title}.`,
  unticked: (/** @type {string} */ title) => `Unticked: ${title}.`,
  added: (/** @type {string} */ title) => `Added to your checklist: ${title}.`,
  removed: (/** @type {string} */ title) => `Removed from your checklist: ${title}.`,
  renamed: (/** @type {string} */ before, /** @type {string} */ after) => `Renamed “${before}” to “${after}”.`,
  undone: 'Okay, I’ve put that back as it was.',
  alreadyTicked: (/** @type {string} */ title) => `“${title}” is already ticked.`,
  notTicked: (/** @type {string} */ title) => `“${title}” isn’t ticked.`,
  exists: (/** @type {string} */ title) => `That’s already on your checklist: “${title}”.`,
  full: `Your checklist is full (${MAX_TASKS} tasks), so I couldn’t add that. Remove one and I can.`,
  tooLong: `That’s too long for a task (up to ${MAX_TITLE_LENGTH} characters). Could you say it more briefly?`,
  noTitle: 'What should the task say?',
  standardRename: 'The standard tasks can’t be renamed, but I can remove it, or add one of your own.',
  nothingTo: {
    tick: 'Everything on your checklist is already ticked.',
    untick: 'Nothing on your checklist is ticked yet.',
    remove: 'Your checklist is empty.',
    rename: 'Only your own tasks can be renamed, and you haven’t added any yet.'
  },
  which: {
    tick: 'Which one have you done?',
    untick: 'Which one should I untick?',
    remove: 'Which one should I take off?',
    rename: 'Which one should I rename?'
  },
  sure: (/** @type {string} */ title) => `Have you done “${title}”? If so, I’ll tick it off.`,
  couldNotSave: 'Sorry, I couldn’t change your checklist just now. Please try again in a minute.'
});

/** How the chat's own lines about one of their own tasks are kept for Gemini, which never sees its words. */
const FOR_GEMINI = Object.freeze({
  ticked: 'Ticked one of their own tasks.',
  unticked: 'Unticked one of their own tasks.',
  added: (/** @type {string} */ title) => `Added to their checklist: ${title}.`,
  removed: 'Removed one of their own tasks.',
  renamed: 'Renamed one of their own tasks.'
});

/**
 * Words that say they've done something, so a tick is what they meant: "I've joined that", "tick it
 * off", "done", "got it". Without any, the app asks before ticking.
 */
const DONE_WORDS = /\b(tick|ticked|done|did|finished|complete|completed|sorted|joined|registered|enrolled|collected|picked (it )?up|got (it|my|one|the|a)|have got|saved|found|signed up|been|went|booked|made)\b/i;

/** Small words that don't help tell tasks apart. */
const LITTLE = new Set(['a', 'an', 'the', 'my', 'to', 'of', 'for', 'and', 'or', 'it', 'that', 'this', 'on', 'in', 'at', 'with', 'off', 'up', 'i', 'ive', 'im', 'me', 'you', 'can', 'please', 'one', 'task', 'list', 'checklist', 'tick', 'untick', 'remove', 'take', 'rename', 'done', 'just', 'now', 'have', 'has', 'is', 'be', 'do', 'did', 'got']);

/** A text's words, for matching: lower case, no punctuation, no little words, no final "s". @param {string} text */
function words(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !LITTLE.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

/**
 * The tasks among these that best match what they said, by shared words: one if it's clear, all the
 * best ones if they tie, none if nothing matches.
 * @param {Task[]} tasks @param {string} said
 */
export function bestMatches(tasks, said) {
  const wanted = new Set(words(said));
  const scored = tasks.map((task) => ({ task, score: words(task.title).filter((word) => wanted.has(word)).length }));
  const top = Math.max(0, ...scored.map((entry) => entry.score));
  return top === 0 ? [] : scored.filter((entry) => entry.score === top).map((entry) => entry.task);
}

/** Whether a task is one of their own (no how-to). @param {Task} task */
const ownTask = (task) => talkFor(task.id) === null;

/**
 * What a change is: the change to save, the change that undoes it, and the line confirming it (with
 * the line kept for Gemini, which never has their own tasks' words).
 * @typedef {{ kind: 'change', change: Change, undo: Change, confirm: string, forGemini: string }} Planned
 */

/**
 * What the app does about a request: make a change; ask which task (quick replies of their tasks'
 * names: the student sees them, Gemini doesn't); ask whether they've done it before ticking; or say
 * why not (already ticked, already there, full, a standard task's name).
 * @typedef {Planned
 *   | { kind: 'choose', edit: EditRequest['edit'], question: string, options: Task[], title?: string }
 *   | { kind: 'sure', task: Task, question: string }
 *   | { kind: 'say', text: string }} Plan
 */

/**
 * The plan for one request, against their checklist as it is now.
 * @param {Task[]} list
 * @param {EditRequest} request
 * @param {string} said what they typed (for their own tasks' words, and whether they've said they've done it)
 * @param {{ saidDone?: boolean }} [known] saidDone: the app has checked they said they've done it (the
 *   chat quoted their words, and the app found them in what they typed), so a tick needs no "done"
 *   word: "yes" to "have you joined one?" is enough
 * @returns {Plan}
 */
export function planEdit(list, request, said, { saidDone } = {}) {
  if (request.edit === 'add') return planAdd(list, request.title ?? '');
  const candidates = list.filter((task) =>
    request.edit === 'tick' ? !task.done : request.edit === 'untick' ? task.done : request.edit === 'rename' ? ownTask(task) : true
  );
  if (candidates.length === 0) {
    const named = request.taskId ? list.find((task) => task.id === request.taskId) : null;
    if (named && request.edit === 'tick') return { kind: 'say', text: EDIT_SAYS.alreadyTicked(named.title) };
    if (named && request.edit === 'untick') return { kind: 'say', text: EDIT_SAYS.notTicked(named.title) };
    return { kind: 'say', text: EDIT_SAYS.nothingTo[request.edit] };
  }

  /** @type {Task | null} */
  let task = null;
  if (request.taskId) {
    const named = list.find((item) => item.id === request.taskId) ?? null;
    if (!named) return choose(request, candidates);
    if (request.edit === 'tick' && named.done) return { kind: 'say', text: EDIT_SAYS.alreadyTicked(named.title) };
    if (request.edit === 'untick' && !named.done) return { kind: 'say', text: EDIT_SAYS.notTicked(named.title) };
    if (request.edit === 'rename' && !ownTask(named)) return { kind: 'say', text: EDIT_SAYS.standardRename };
    task = named;
  } else {
    // One of their own, or not clear: matched here, on their words, never Gemini's.
    const matches = bestMatches(request.own ? candidates.filter(ownTask) : candidates, said);
    if (matches.length === 1) task = matches[0];
    else return choose(request, matches.length > 1 ? matches : candidates);
  }

  if (request.edit === 'tick') {
    if (!(saidDone ?? DONE_WORDS.test(said))) return { kind: 'sure', task, question: EDIT_SAYS.sure(task.title) };
    return planned(makeTick(task.id, true), makeTick(task.id, false), EDIT_SAYS.ticked(task.title), ownTask(task) ? FOR_GEMINI.ticked : EDIT_SAYS.ticked(task.title));
  }
  if (request.edit === 'untick') {
    return planned(makeTick(task.id, false), makeTick(task.id, true), EDIT_SAYS.unticked(task.title), ownTask(task) ? FOR_GEMINI.unticked : EDIT_SAYS.unticked(task.title));
  }
  if (request.edit === 'remove') {
    const at = list.findIndex((item) => item.id === task.id);
    return planned(makeDelete(task.id), { type: 'add', task: { ...task }, at }, EDIT_SAYS.removed(task.title), ownTask(task) ? FOR_GEMINI.removed : EDIT_SAYS.removed(task.title));
  }
  // Rename (one of their own).
  const title = tidyTitle(request.title ?? '');
  if (!title) return { kind: 'say', text: EDIT_SAYS.noTitle };
  if (title.length > MAX_TITLE_LENGTH) return { kind: 'say', text: EDIT_SAYS.tooLong };
  return planned(makeEdit(task.id, title), makeEdit(task.id, task.title), EDIT_SAYS.renamed(task.title, title), FOR_GEMINI.renamed);
}

/** @param {Change} change @param {Change} undo @param {string} confirm @param {string} forGemini @returns {Planned} */
const planned = (change, undo, confirm, forGemini) => ({ kind: 'change', change, undo, confirm, forGemini });

/** @param {EditRequest} request @param {Task[]} options @returns {Plan} */
const choose = (request, options) => ({ kind: 'choose', edit: request.edit, question: EDIT_SAYS.which[/** @type {'tick' | 'untick' | 'remove' | 'rename'} */ (request.edit)], options, title: request.title });

/** A task's name as Gemini wrote it, tidied: one line, no quotes or full stop. @param {string} title */
const tidyTitle = (title) =>
  title
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’.!?]+$/g, '')
    .trim();

/** @param {Task[]} list @param {string} raw @returns {Plan} */
function planAdd(list, raw) {
  const title = tidyTitle(raw);
  if (!title || /[[\]]/.test(title)) return { kind: 'say', text: EDIT_SAYS.noTitle };
  if (title.length > MAX_TITLE_LENGTH) return { kind: 'say', text: EDIT_SAYS.tooLong };
  const existing = existingTask(list, title);
  if (existing) return { kind: 'say', text: EDIT_SAYS.exists(existing.title) };
  if (list.length >= MAX_TASKS) return { kind: 'say', text: EDIT_SAYS.full };
  const change = makeAdd(title);
  if (change.type !== 'add') throw new Error('makeAdd made something else');
  return planned(change, makeDelete(change.task.id), EDIT_SAYS.added(title), FOR_GEMINI.added(title));
}
