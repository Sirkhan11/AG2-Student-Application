// The settling-in checklist's rules: the default tasks, the limits, and the four changes a student
// can make (add, tick, edit, delete). No Firebase imports here, so scripts/check-checklist.mjs can
// test it in Node.
//
// Saved format, at students/{uid}.checklist (the checklist page and the check-in chat both read it
// through checklistFrom() below, via loadMyRecord() in store.js, so they always show the same list):
//   [{ id: string, title: string, done: boolean }, ...]
// The six defaults always keep their ids; tasks the student adds get ids starting "own-". A standard
// task added after students had saved their lists (ADDED_DEFAULTS) is put at the top of a saved list
// once, and students/{uid}.checklistOffered remembers that, so one they delete stays deleted.

/** @typedef {{ id: string, title: string, done: boolean }} Task */

/**
 * One change to the checklist. Saving sends changes, not whole lists, so each one can be applied
 * to the latest saved list, and an edit made on another device isn't wiped out.
 * @typedef {{ type: 'add', task: Task } | { type: 'tick', id: string, done: boolean }
 *   | { type: 'edit', id: string, title: string } | { type: 'delete', id: string }} Change
 */

/** The field in students/{uid} that holds the checklist. */
export const CHECKLIST_FIELD = 'checklist';

/**
 * Limits, so one student can't fill their record. firestore.rules checks each task in turn, and a
 * rule can only evaluate so much per write: the rules for 50 places refused 20 tasks or more, so the
 * limit is 15 (the 6 standard tasks and 9 of their own), well inside what fits. check-checklist.mjs
 * checks the rules have exactly MAX_TASKS places, and that the server accepts a full list.
 */
export const MAX_TASKS = 15;
export const MAX_TITLE_LENGTH = 100;

/**
 * Every student starts with these, in this order. Their ids never change, as the check-in chat
 * recognises them, and each has a how-to (how-to.js).
 */
export const DEFAULT_TASKS = Object.freeze([
  { id: 'enrol', title: 'Enrol', done: false },
  { id: 'gp', title: 'Register with a GP', done: false },
  { id: 'student-id', title: 'Collect student ID', done: false },
  { id: 'society', title: 'Join a society', done: false },
  { id: 'dentist', title: 'Find a dentist', done: false },
  { id: 'contacts', title: 'Save key contacts', done: false }
]);

const DEFAULT_IDS = new Set(DEFAULT_TASKS.map((task) => task.id));

/**
 * Standard tasks added after students had started saving their lists, in DEFAULT_TASKS order. A saved
 * list without one gets it at the top, once (see withNewDefaults).
 */
export const ADDED_DEFAULTS = Object.freeze(['enrol']);

/** The field in students/{uid} listing which ADDED_DEFAULTS have been put in their list. */
export const OFFERED_FIELD = 'checklistOffered';

/** A problem the student can fix or needs to know about, with a message that's safe to show them. */
export class ChecklistError extends Error {}

/** @param {string} id */
export function isDefault(id) {
  return DEFAULT_IDS.has(id);
}

/** A fresh copy of the defaults, so changing one never changes DEFAULT_TASKS. @returns {Task[]} */
export function defaultTasks() {
  return DEFAULT_TASKS.map((task) => ({ ...task }));
}

/**
 * Reads a saved checklist safely, keeping only well-formed tasks (it could have been edited by hand
 * in the console). Returns null if nothing has been saved, so the caller can use the defaults.
 * @param {unknown} saved
 * @returns {Task[] | null}
 */
export function readSaved(saved) {
  if (!Array.isArray(saved)) return null;
  return saved
    .filter((task) => task && typeof task.id === 'string' && typeof task.title === 'string')
    .map((task) => ({ id: task.id, title: task.title, done: task.done === true }));
}

/**
 * A saved list with any standard task added since it was saved (ADDED_DEFAULTS) put at the top, in
 * the defaults' order, once: offered lists the ones the list has had, so one they've deleted stays
 * deleted. Only while there's room (MAX_TASKS): their own tasks and ticks are never touched, and one
 * that doesn't fit is added once they make room. Returns the list and what it has now had.
 * @param {Task[]} tasks
 * @param {unknown} offered students/{uid}.checklistOffered
 * @returns {{ tasks: Task[], offered: string[] }}
 */
export function withNewDefaults(tasks, offered) {
  const had = new Set(Array.isArray(offered) ? offered.filter((id) => typeof id === 'string') : []);
  /** @type {Task[]} */
  const added = [];
  for (const id of ADDED_DEFAULTS) {
    if (had.has(id)) continue;
    if (!tasks.some((task) => task.id === id)) {
      if (tasks.length + added.length >= MAX_TASKS) continue;
      added.push({ .../** @type {Task} */ (DEFAULT_TASKS.find((task) => task.id === id)) });
    }
    had.add(id);
  }
  return { tasks: added.length ? [...added, ...tasks] : tasks, offered: [...had] };
}

/**
 * A student's checklist from their record (students/{uid}): what they've saved (with any newer
 * standard task, see withNewDefaults), or a fresh copy of the defaults, all unticked, if they've
 * never changed it. saved says which, so the check-in chat can word a list nobody has ticked yet
 * carefully (they may have done things without ticking them).
 * @param {Record<string, unknown> | undefined} record
 * @returns {{ tasks: Task[], saved: boolean }}
 */
export function checklistFrom(record) {
  const saved = readSaved(record?.[CHECKLIST_FIELD]);
  return saved ? { tasks: withNewDefaults(saved, record?.[OFFERED_FIELD]).tasks, saved: true } : { tasks: defaultTasks(), saved: false };
}

/**
 * Checks a task name and returns it trimmed, or throws a ChecklistError saying what's wrong.
 * @param {string} title
 */
function checkedTitle(title) {
  const trimmed = title.trim();
  if (trimmed === '') throw new ChecklistError('Please give the task a name.');
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ChecklistError(`Task names can be up to ${MAX_TITLE_LENGTH} characters.`);
  }
  return trimmed;
}

/**
 * An id for a task the student adds. The time alone could clash if two devices add a task in the
 * same millisecond, so a few random characters are added.
 */
export function newTaskId() {
  return `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** @param {string} title @returns {Change} */
export function makeAdd(title) {
  return { type: 'add', task: { id: newTaskId(), title: checkedTitle(title), done: false } };
}

/** @param {string} id @param {boolean} done @returns {Change} */
export function makeTick(id, done) {
  return { type: 'tick', id, done };
}

/**
 * Only the student's own tasks can be renamed. The chat describes a default task by its id, so a
 * renamed "Register with a GP" would still be talked about as registering with a GP.
 * @param {string} id @param {string} title @returns {Change}
 */
export function makeEdit(id, title) {
  if (isDefault(id)) throw new ChecklistError('The standard tasks can’t be renamed, but you can delete them.');
  return { type: 'edit', id, title: checkedTitle(title) };
}

/** @param {string} id @returns {Change} */
export function makeDelete(id) {
  return { type: 'delete', id };
}

/**
 * Applies one change and returns the new list (the old one isn't changed). Applying the same change
 * twice gives the same result, so a retry can never add a task twice: adding an id that's already
 * there, or ticking, editing or deleting one that's gone, changes nothing.
 * Throws a ChecklistError if the change isn't allowed (a full list, a renamed default).
 * @param {Task[]} list
 * @param {Change} change
 * @returns {Task[]}
 */
export function applyChange(list, change) {
  switch (change.type) {
    case 'add':
      if (list.some((task) => task.id === change.task.id)) return list;
      if (list.length >= MAX_TASKS) throw new ChecklistError(`You can have up to ${MAX_TASKS} tasks.`);
      return [...list, { ...change.task, title: checkedTitle(change.task.title) }];
    case 'tick':
      return list.map((task) => (task.id === change.id ? { ...task, done: change.done } : task));
    case 'edit':
      if (isDefault(change.id)) throw new ChecklistError('The standard tasks can’t be renamed, but you can delete them.');
      return list.map((task) => (task.id === change.id ? { ...task, title: checkedTitle(change.title) } : task));
    case 'delete':
      return list.filter((task) => task.id !== change.id);
    default:
      throw new Error('Unknown checklist change.');
  }
}

/**
 * Applies changes in order, skipping any that aren't allowed any more (for example an add, after
 * another device filled the list). Used to show changes that are still waiting to be saved.
 * @param {Task[]} list
 * @param {Change[]} changes
 */
export function applyAll(list, changes) {
  return changes.reduce((current, change) => {
    try {
      return applyChange(current, change);
    } catch (err) {
      if (err instanceof ChecklistError) return current;
      throw err;
    }
  }, list);
}

/**
 * The body of a Firestore transaction: reads the LATEST saved list, applies one change to it, and
 * writes it back, so a change made on another device in the meantime is kept. If two saves collide,
 * Firestore runs this again with the newer list. merge: true leaves the student's other fields alone.
 *
 * It only uses transaction.get and transaction.set, so the app (firebase/firestore) and
 * scripts/check-checklist.mjs (firebase/firestore/lite) run exactly the same code.
 * @param {{ get: (ref: any) => Promise<{ data: () => any }>, set: (ref: any, data: object, options: object) => unknown }} transaction
 * @param {any} ref the student's record, students/{uid}
 * @param {Change} change
 * @returns {Promise<Task[]>} the list as saved
 */
export async function applyToLatest(transaction, ref, change) {
  const data = (await transaction.get(ref)).data();
  const saved = readSaved(data?.[CHECKLIST_FIELD]);
  // As the page shows it: with any newer standard task (once), or the defaults, which have them all.
  const { tasks: latest, offered } = saved ? withNewDefaults(saved, data?.[OFFERED_FIELD]) : { tasks: defaultTasks(), offered: [...ADDED_DEFAULTS] };
  const next = applyChange(latest, change);
  transaction.set(ref, { [CHECKLIST_FIELD]: next, [OFFERED_FIELD]: offered }, { merge: true });
  return next;
}
