import { applyChange, makeAdd, MAX_TASKS } from '#lib/checklist/tasks.js';

// Checklist reminders in the check-in chat. When a student names something they'd like reminding
// about, Gemini suggests one short task as its reply's reminder action (chat-prompt.js), and the app
// shows a card with Add and No thanks. Only their tap adds it, through the checklist's own "add"
// change, so the checklist's limits and rules apply. No Firebase here (the card passes the checklist store in), so the checks
// can test all of it in Node.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/** @typedef {import('#lib/checklist/tasks.js').Change} Change */

/** Lower case, without punctuation or little words, for comparing task titles. @param {string} title */
const simple = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['a', 'an', 'the', 'my', 'your', 'to', 'for'].includes(word))
    .join(' ');

/**
 * True if two task titles mean the same task: the same words, or one inside the other when the
 * shorter has at least two words ("Register with a GP" and "Register with a GP surgery"). A more
 * specific task ("Join the chess society" next to "Join a society") counts as new.
 * @param {string} a
 * @param {string} b
 */
export function sameTask(a, b) {
  const x = simple(a);
  const y = simple(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.split(' ').length >= 2 && ` ${longer} `.includes(` ${shorter} `);
}

/**
 * The task already on the checklist that a suggestion repeats, or null.
 * @param {Task[]} list
 * @param {string} title
 */
export const existingTask = (list, title) => list.find((task) => sameTask(task.title, title)) ?? null;

/**
 * What the card offers for a suggested task, given their checklist: the task that's already there
 * instead of a copy ('exists'), 'full' if there's no room, otherwise Add ('offered').
 * @param {Task[]} list
 * @param {string} title
 * @returns {{ state: 'offered' } | { state: 'full' } | { state: 'exists', existing: string }}
 */
export function stateFor(list, title) {
  const found = existingTask(list, title);
  if (found) return { state: 'exists', existing: found.title };
  return list.length >= MAX_TASKS ? { state: 'full' } : { state: 'offered' };
}

/**
 * Adds a suggested task. Only the card's Add button calls this, so nothing is added without the
 * student's tap. Their checklist is loaded again first, as it may have changed since the card
 * appeared: if the task is there now, or there's no room, nothing is saved. Otherwise it's saved
 * through the checklist's own "add" change (an own- task), as the checklist page adds one, so the
 * same limits and rules apply. Throws a ChecklistError (with a message to show) if the change isn't
 * allowed, or Firebase's error if saving fails.
 * @param {string} title
 * @param {{ loadChecklist: () => Promise<Task[]>,
 *   saveChange: (change: Change, listOnScreen: Task[]) => Promise<{ status: 'saved' | 'queued' }> }} store
 * @returns {Promise<{ state: 'added' | 'queued' } | { state: 'full' } | { state: 'exists', existing: string }>}
 */
export async function addSuggestedTask(title, store) {
  const list = await store.loadChecklist();
  const now = stateFor(list, title);
  if (now.state !== 'offered') return now;
  const change = makeAdd(title);
  const { status } = await store.saveChange(change, applyChange(list, change));
  return { state: status === 'queued' ? 'queued' : 'added' };
}
