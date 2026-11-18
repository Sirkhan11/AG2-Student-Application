import { talkFor } from '#lib/checklist/how-to.js';
import { applyChange, ChecklistError, makeAdd, makeDelete, makeEdit, makeTick, MAX_TASKS, MAX_TITLE_LENGTH } from '#lib/checklist/tasks.js';
import { existingTask } from '#lib/checkin/task-suggestions.js';

// Changing a student's checklist from any chat message: tick, untick, add, remove and rename, as
// they ask ("I've joined that, tick it off", "add open a bank account", "take the dentist one off").
// Gemini only says what they asked for and which task (a standard one by its title, "one of their
// own", or "not sure"); the app works out the task, checks the change is to one really on their list,
// makes it straight away through the checklist's own change, and confirms it in one line with Undo.
// When it isn't clear which task, the app asks with quick replies. A tick needs them to have said
// they've done it (DONE_WORDS); otherwise the app asks first. The words of their own tasks never go
// to Gemini: the app matches those itself, against what the student typed.
// No Firebase here (the page passes the checklist store in), so the checks can run it in Node.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/** @typedef {import('#lib/checklist/tasks.js').Change} Change */

/**
 * What Gemini asked for, as the app read it (chat-replies.js): the edit, and the task as one of
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
 * @returns {Plan}
 */
export function planEdit(list, request, said) {
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
    if (!DONE_WORDS.test(said)) return { kind: 'sure', task, question: EDIT_SAYS.sure(task.title) };
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

/**
 * A quick reply under the chat's question: what the button says, and what it sends.
 * @typedef {{ label: string, value: string }} QuickReply
 */

/**
 * A message the edits post. undo: the change that puts it back, for the Undo button; quick: the task
 * names to choose from, or Yes and Not yet.
 * @typedef {{ text: string, undo?: Change, quick?: QuickReply[] }} EditMessage
 */

/**
 * The chat's checklist edits, for one chat: makes a change, asks which task or whether they've done
 * it, and undoes. A question it asks waits for their answer (takes/reply); anything else they say
 * goes on to the chat as usual.
 * @param {{
 *   load: () => Promise<Task[]>,
 *   save: (change: Change, list: Task[]) => Promise<Task[]>,
 *   post: (message: EditMessage) => void,
 *   record: (student: string | null, chat: string) => void
 * }} parts
 *   load: their checklist now; save: makes one change through the checklist's own change and returns
 *   the list as it is now; post: shows something in the chat; record: adds what the chat said to
 *   Gemini's side of the conversation (null: to the chat's last message)
 */
export function createChecklistEdits({ load, save, post, record }) {
  /**
   * A question waiting for their answer: which task (choose), whether they've done it (sure), or a
   * task the chat said it would tick off when they've done it (awaiting: tell me when you've done it).
   * @type {{ kind: 'choose', edit: EditRequest['edit'], options: Task[], title?: string } | { kind: 'sure' | 'awaiting', task: Task } | null}
   */
  let pending = null;

  /** Makes a planned change, and confirms it with Undo. @param {Planned} plan @param {string | null} student */
  async function make(plan, student) {
    try {
      await save(plan.change, await load());
    } catch (err) {
      const message = err instanceof ChecklistError ? err.message : EDIT_SAYS.couldNotSave;
      if (!(err instanceof ChecklistError)) console.error('Changing the checklist from the chat failed:', err);
      post({ text: message });
      record(student, message);
      return false;
    }
    post({ text: plan.confirm, undo: plan.undo });
    record(student, plan.forGemini);
    return true;
  }

  /** Acts on a plan: a change, a question, or why not. @param {Plan} plan @param {string | null} student */
  async function act(plan, student) {
    pending = null;
    if (plan.kind === 'change') return make(plan, student);
    if (plan.kind === 'say') {
      post({ text: plan.text });
      record(student, plan.text);
      return false;
    }
    if (plan.kind === 'sure') {
      pending = { kind: 'sure', task: plan.task };
      post({ text: plan.question, quick: [{ label: 'Yes', value: 'Yes' }, { label: 'Not yet', value: 'Not yet' }] });
      record(student, ownTask(plan.task) ? 'Asked whether they’ve done one of their own tasks.' : plan.question);
      return false;
    }
    pending = { kind: 'choose', edit: plan.edit, options: plan.options, title: plan.title };
    post({ text: plan.question, quick: plan.options.slice(0, 8).map((task) => ({ label: task.title, value: task.title })) });
    record(student, `${plan.question} (The app showed their tasks to choose from.)`);
    return false;
  }

  return {
    /**
     * Gemini read their message as a change to their checklist: the app makes it, or asks.
     * @param {EditRequest} request @param {string} said what they typed
     */
    async request(request, said) {
      return act(planEdit(await load(), request, said), null);
    },

    /**
     * After telling them how to do a task outside the app ("tell me when you've done it and I'll
     * tick it off"): their next "done" or "yes" ticks it.
     * @param {Task} task
     */
    awaitDone(task) {
      pending = { kind: 'awaiting', task };
    },

    /** Whether what they've just typed answers the chat's question (otherwise it's for the chat). @param {string} text */
    takes(text) {
      if (!pending) return false;
      const said = text.trim().toLowerCase().replace(/[.!]+$/, '');
      if (pending.kind === 'choose') return pending.options.some((task) => task.title.toLowerCase() === said);
      if (pending.kind === 'sure') return /^(yes|yeah|yep|not yet|no|nope)$/.test(said);
      return /^(yes|yeah|yep|done|i have|ive done it|i've done it|all done|sorted)$/.test(said);
    },

    /** Their answer to the chat's question. @param {string} text */
    async reply(text) {
      const now = pending;
      pending = null;
      if (!now) return;
      const said = text.trim().toLowerCase().replace(/[.!]+$/, '');
      const list = await load();
      if (now.kind === 'choose') {
        const chosen = now.options.find((task) => task.title.toLowerCase() === said);
        const task = chosen ? list.find((item) => item.id === chosen.id) : null;
        if (!task) return;
        // They chose it themselves, so it counts as saying so.
        const plan = planEdit(list, { edit: now.edit, taskId: task.id, title: now.title }, 'done');
        return act(plan, text);
      }
      const task = list.find((item) => item.id === now.task.id);
      if (!task || /^(not yet|no|nope)$/.test(said)) {
        const line = 'Okay, it’s still on your checklist.';
        post({ text: line });
        record(text, line);
        return;
      }
      return act(planEdit(list, { edit: 'tick', taskId: task.id }, 'done'), text);
    },

    /**
     * Undo on a confirmation: makes the change that puts it back.
     * @param {Change} undo
     */
    async undo(undo) {
      pending = null;
      try {
        const list = await load();
        await save(undo, list);
      } catch (err) {
        console.error('Undoing a checklist change from the chat failed:', err);
        post({ text: EDIT_SAYS.couldNotSave });
        return;
      }
      post({ text: EDIT_SAYS.undone });
      record('Undo', EDIT_SAYS.undone);
    },

    /** Forgets any question waiting (they've moved on). */
    clear() {
      pending = null;
    }
  };
}

/** Applies a change to a list as the checklist does (for stand-in stores in the checks). @param {Task[]} list @param {Change} change */
export const applied = (list, change) => applyChange(list, change);
