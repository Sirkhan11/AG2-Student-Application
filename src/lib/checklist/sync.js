import { applyAll, applyChange, ChecklistError } from '#lib/checklist/tasks.js';

// Keeps the checklist on screen in step with the saved one. No Firebase here: the save function is
// passed in, so scripts/check-checklist.mjs can test this with a pretend one.
//
// The list on screen is always "the last list the server confirmed, plus the changes still waiting
// to be saved". So a change shows straight away, and stays on screen if saving it fails.
// Changes are sent one at a time, in the order they were made.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/** @typedef {import('#lib/checklist/tasks.js').Change} Change */

/**
 * What saving one change gave back:
 * - 'saved': it was applied to the latest saved list, which is `list` (it may include changes made
 *   on another device)
 * - 'queued': offline, so the whole list on screen was queued; `synced` resolves once it reaches
 *   the server
 * @typedef {{ status: 'saved', list: Task[] } | { status: 'queued', synced: Promise<void> }} SaveResult
 */

/**
 * Something the page should tell the student:
 * - 'error': a change couldn't be saved; it's still on screen, and Try again (retry) sends it again
 * - 'offline': changes are queued and will save once the device is back online
 * - 'refused': a change can never be saved (for example the list filled up on another device), so
 *   it was taken off the screen
 * @typedef {{ kind: 'error' | 'offline' | 'refused', message: string }} Problem
 */

/**
 * @param {Task[]} savedList the list as loaded from the server
 * @param {{
 *   save: (change: Change, listOnScreen: Task[]) => Promise<SaveResult>,
 *   onUpdate: (state: { tasks: Task[], problem: Problem | null, waiting: number }) => void
 * }} options
 */
export function createChecklistSync(savedList, { save, onUpdate }) {
  let confirmed = savedList;
  /** @type {Change[]} changes made but not confirmed yet, oldest first */
  let waiting = [];
  /** @type {Problem | null} */
  let problem = null;
  let sending = false;

  const onScreen = () => applyAll(confirmed, waiting);
  const publish = () => onUpdate({ tasks: onScreen(), problem, waiting: waiting.length });

  async function sendNext() {
    // One at a time, and after an error nothing more is sent until the student presses Try again.
    if (sending || waiting.length === 0 || problem?.kind === 'error') return;
    sending = true;
    const change = waiting[0];
    try {
      const result = await save(change, onScreen());
      if (result.status === 'saved') {
        confirmed = result.list;
        waiting = waiting.slice(1);
        // A transaction only succeeds online, so any "offline" or "refused" notice is out of date now.
        problem = null;
      } else {
        // Offline: everything on screen has been queued as one whole-list save.
        confirmed = onScreen();
        waiting = [];
        problem = { kind: 'offline', message: 'Not saved yet: you seem to be offline. Your changes will save when you’re back online.' };
        const queuedList = confirmed;
        result.synced.then(() => {
          if (problem?.kind === 'offline' && confirmed === queuedList) {
            problem = null;
            publish();
          }
        });
      }
    } catch (err) {
      if (err instanceof ChecklistError) {
        // Can never be saved, so take it off the screen and say why.
        waiting = waiting.slice(1);
        problem = { kind: 'refused', message: err.message };
      } else {
        console.error('Saving the checklist failed:', err);
        problem = { kind: 'error', message: 'We couldn’t save your last change. It’s still shown here, so you can try again.' };
      }
    } finally {
      sending = false;
      publish();
    }
    await sendNext();
  }

  return {
    /** The list as it should be shown now. */
    get tasks() {
      return onScreen();
    },
    /**
     * Shows a change straight away and queues it to be saved. Throws a ChecklistError (and changes
     * nothing) if the change isn't allowed, so the page can say why.
     * @param {Change} change
     */
    record(change) {
      applyChange(onScreen(), change);
      waiting.push(change);
      if (problem?.kind === 'refused') problem = null;
      publish();
      return sendNext();
    },
    /** Sends the waiting changes again after an error. */
    retry() {
      if (problem?.kind !== 'error') return Promise.resolve();
      problem = null;
      publish();
      return sendNext();
    }
  };
}
