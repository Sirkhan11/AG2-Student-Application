// The changes the check-in chat makes when Gemini calls one of the app's tools (chat-tools.js): their
// checklist (tick, untick, add, remove, rename, through the checklist's own change, as the checklist
// page does) and what the chat remembers (as the Remember card and the About you page do). Each is
// checked here first (planEdit in checklist-edits.js; screenNote in remember-notes.js), made straight
// away, and confirmed in a line of its own with Undo; Gemini is told how it went, so it can say so in
// its own words. The words of the student's own tasks never go to Gemini.
// No Firebase here (the page passes its stores in, the scripts their own), so the checks run it in Node.

import { EDIT_SAYS, planEdit } from '#lib/checkin/checklist-edits.js';
import { screenNote } from '#lib/checkin/remember-notes.js';
import { talkFor } from '#lib/checklist/how-to.js';
import { NOT_SURE, OWN_TASK, standardTask } from '#lib/checkin/chat-tools.js';

/** What the chat's lines say when it remembers or forgets something. */
export const NOTE_SAYS = Object.freeze({
  remembered: (/** @type {string} */ text) => `Remembered: ${text}.`,
  forgotten: (/** @type {string} */ text) => `Forgotten: ${text}.`,
  forgottenAll: 'Forgotten everything I was remembering for you.',
  undone: 'Put back as it was.'
});

/**
 * How to put a change back, for the Undo button: a checklist change, or a notes change (forget the
 * one just remembered, or remember again the ones just forgotten).
 * @typedef {{ checklist: import('#lib/checklist/tasks.js').Change } | { forget: string } | { remember: string[] }} Undo
 */

/**
 * How a change went: what Gemini is told (forGemini), and for the page, the line confirming it with
 * Undo (line), quick replies of their tasks to pick from (quick: the student sees their own tasks'
 * words, Gemini doesn't), and the checklist or notes as they are now.
 * @typedef {{ forGemini: Record<string, unknown>, line?: { text: string, undo: Undo },
 *   quick?: { label: string, value: string }[], tasks?: import('#lib/checklist/tasks.js').Task[], notes?: string[] }} Done
 */

/**
 * The stores the changes go through.
 * @typedef {{
 *   loadTasks: () => Promise<import('#lib/checklist/tasks.js').Task[]>,
 *   saveChange: (change: import('#lib/checklist/tasks.js').Change, list: import('#lib/checklist/tasks.js').Task[]) => Promise<import('#lib/checklist/tasks.js').Task[]>,
 *   loadNotes: () => Promise<{ text: string, savedAt: unknown }[]>,
 *   remember: (text: string) => Promise<string>,
 *   forget: (note: { text: string, savedAt: unknown }) => Promise<void>,
 *   forgetAll: () => Promise<void>
 * }} Stores
 *   saveChange: saves one change and returns the list as saved; remember: 'saved', 'exists', 'full',
 *   or why it's never kept
 */

/** Text as compared: lower case, letters and numbers only, single spaces. @param {string} text */
const plain = (text) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether these words are really theirs: found in what they typed (any of their latest messages).
 * @param {string} words what Gemini quoted
 * @param {string[]} typed their latest messages
 */
export const saidIt = (words, typed) => plain(words) !== '' && typed.some((text) => plain(text).includes(plain(words)));

/**
 * The chat's changes, through these stores.
 * @param {Stores} stores
 */
export function createChatDo(stores) {
  /** Their notes' texts now. */
  const noteTexts = async () => (await stores.loadNotes()).map((note) => note.text);
  return {
    /**
     * Changes their checklist as Gemini asked (change_checklist).
     * @param {{ change: 'tick' | 'untick' | 'add' | 'remove' | 'rename', task: string, new_title?: string, their_words?: string }} call
     * @param {string[]} typed their latest messages, newest first
     * @returns {Promise<Done>}
     */
    async checklist(call, typed) {
      const list = await stores.loadTasks();
      const taskId = standardTask(call.task);
      const own = call.task === OWN_TASK;
      const words = call.their_words && saidIt(call.their_words, typed) ? call.their_words : typed[0] ?? '';
      const request = { edit: call.change, ...(taskId ? { taskId } : {}), own, title: call.new_title };
      const plan = planEdit(list, request, words, call.change === 'tick' ? { saidDone: saidIt(call.their_words ?? '', typed) } : {});
      if (plan.kind === 'say') return { forGemini: { done: false, why: plan.text } };
      if (plan.kind === 'sure') {
        const which = talkFor(plan.task.id) ? `"${plan.task.title}"` : 'that one of their own';
        return { forGemini: { done: false, why: `They haven't said they've done ${which}: ask them before ticking it.` } };
      }
      if (plan.kind === 'choose') {
        return {
          forGemini: {
            done: false,
            why: 'Not clear which task: ask them which one. The app shows their tasks as buttons under your message.',
            their_tasks: [...new Set(plan.options.map((task) => (talkFor(task.id) ? task.title : OWN_TASK)))]
          },
          quick: plan.options.slice(0, 8).map((task) => ({ label: task.title, value: task.title }))
        };
      }
      let tasks;
      try {
        tasks = await stores.saveChange(plan.change, list);
      } catch (err) {
        console.error('Changing the checklist from the chat failed:', err);
        return { forGemini: { done: false, why: "The app couldn't save the change just now: say sorry and ask them to try again in a minute." } };
      }
      return { forGemini: { done: true, what: plan.forGemini }, line: { text: plan.confirm, undo: { checklist: plan.undo } }, tasks };
    },

    /**
     * Remembers something they asked it to (remember). Never anything about health, money, worries,
     * safety, other people or contact details.
     * @param {string} note
     * @returns {Promise<Done>}
     */
    async remember(note) {
      const text = note.trim();
      if (!text || screenNote(text) !== null) {
        return { forGemini: { done: false, why: 'Not kept: the app never remembers anything about health, money, worries, safety, other people or contact details. Say so kindly.' } };
      }
      let result;
      try {
        result = await stores.remember(text);
      } catch (err) {
        console.error('Remembering a note from the chat failed:', err);
        return { forGemini: { done: false, why: "The app couldn't save it just now." } };
      }
      if (result === 'exists') return { forGemini: { done: false, why: 'It already remembers that.' } };
      if (result === 'full') return { forGemini: { done: false, why: 'It already remembers 10 things, the most it keeps: they can ask you to forget one.' } };
      if (result !== 'saved') return { forGemini: { done: false, why: 'Not kept: it never remembers anything private.' } };
      return { forGemini: { done: true, what: `Remembered: ${text}` }, line: { text: NOTE_SAYS.remembered(text), undo: { forget: text } }, notes: await noteTexts() };
    },

    /**
     * Forgets one thing it remembers, or everything (forget).
     * @param {string} which the note, or "everything"
     * @returns {Promise<Done>}
     */
    async forget(which) {
      try {
        const notes = await stores.loadNotes();
        if (notes.length === 0) return { forGemini: { done: false, why: "It isn't remembering anything for them." } };
        if (plain(which) === 'everything' || plain(which) === 'all') {
          await stores.forgetAll();
          return { forGemini: { done: true, what: 'Forgot everything' }, line: { text: NOTE_SAYS.forgottenAll, undo: { remember: notes.map((note) => note.text) } }, notes: [] };
        }
        const note = notes.find((saved) => plain(saved.text) === plain(which)) ?? notes.find((saved) => plain(saved.text).includes(plain(which)) || plain(which).includes(plain(saved.text)));
        if (!note) return { forGemini: { done: false, why: "It doesn't remember that.", remembers: notes.map((saved) => saved.text) } };
        await stores.forget(note);
        return { forGemini: { done: true, what: `Forgot: ${note.text}` }, line: { text: NOTE_SAYS.forgotten(note.text), undo: { remember: [note.text] } }, notes: await noteTexts() };
      } catch (err) {
        console.error('Forgetting a note from the chat failed:', err);
        return { forGemini: { done: false, why: "The app couldn't change it just now." } };
      }
    },

    /**
     * Undo on one of those lines: puts it back as it was.
     * @param {Undo} undo
     * @returns {Promise<{ text: string, forGemini: string, tasks?: import('#lib/checklist/tasks.js').Task[], notes?: string[] } | null>} null if it couldn't
     */
    async undo(undo) {
      try {
        if ('checklist' in undo) {
          const list = await stores.loadTasks();
          const tasks = await stores.saveChange(undo.checklist, list);
          return { text: EDIT_SAYS.undone, forGemini: 'they tapped Undo on that checklist change, so it is back as it was', tasks };
        }
        if ('forget' in undo) {
          const note = (await stores.loadNotes()).find((saved) => saved.text === undo.forget);
          if (note) await stores.forget(note);
        } else {
          for (const text of undo.remember) await stores.remember(text);
        }
        return { text: NOTE_SAYS.undone, forGemini: 'they tapped Undo, so what you remember is back as it was', notes: await noteTexts() };
      } catch (err) {
        console.error('Undoing a change from the chat failed:', err);
        return null;
      }
    }
  };
}

export { NOT_SURE, OWN_TASK };
