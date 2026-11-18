// What the check-in chat does after showing a reply: the changes a student asked for, made straight
// away, each confirmed in a line of its own with Undo. A checklist edit goes to checklist-edits.js;
// remembering something, or forgetting it, goes to the student's notes (chat-notes.js in the app);
// "tell me when you've done it and I'll tick it off" waits for their "done". The chat page and the
// Node checks both use this, so what's measured is what runs. No Firebase here: the stores are
// passed in.

import { screenNote } from '#lib/checkin/remember-notes.js';

/** What the chat says when it remembers or forgets something. */
export const NOTE_SAYS = Object.freeze({
  remembered: (/** @type {string} */ text) => `I’ll remember: ${text}.`,
  exists: 'I already remember that.',
  full: 'I already remember 10 things for you, so I couldn’t keep that. Ask me to forget one and I can.',
  refused: 'To keep things private, I don’t remember anything about health, money, worries, safety, other people or contact details.',
  forgotten: (/** @type {string} */ text) => `Forgotten: ${text}.`,
  forgottenAll: 'I’ve forgotten everything you asked me to remember.',
  nothing: 'I’m not remembering anything for you at the moment.',
  undone: 'Okay, I’ve put that back as it was.',
  couldNot: 'Sorry, I couldn’t change that just now. Please try again in a minute.'
});

/**
 * How to undo a change to their notes: forget the one just remembered, or remember again the ones
 * just forgotten.
 * @typedef {{ forget: string } | { remember: string[] }} NoteUndo
 */

/**
 * A line the actions post: undo is the checklist change (from checklist-edits.js) or the notes change
 * that puts it back, for the Undo button.
 * @typedef {{ text: string, undo?: import('#lib/checklist/tasks.js').Change, noteUndo?: NoteUndo,
 *   quick?: import('#lib/checkin/checklist-edits.js').QuickReply[] }} ActionMessage
 */

/**
 * The chat's changes to what it remembers, for one chat.
 * @param {{
 *   load: () => Promise<{ text: string, savedAt: any }[]>,
 *   remember: (text: string) => Promise<string>,
 *   forget: (note: { text: string, savedAt: any }) => Promise<void>,
 *   forgetAll: () => Promise<void>,
 *   changed: () => Promise<void> | void,
 *   post: (message: ActionMessage) => void,
 *   record: (student: string | null, chat: string) => void
 * }} parts
 *   load: their notes now; remember: saves one ('saved', 'exists', 'full' or why it's never kept);
 *   forget and forgetAll: delete; changed: tells Gemini what it remembers now; post and record: as
 *   for the checklist edits
 */
export function createNoteActions({ load, remember, forget, forgetAll, changed, post, record }) {
  /** @param {string} text */
  function say(text) {
    post({ text });
    record(null, text);
  }

  return {
    /** They asked the chat to remember this: saved straight away. @param {string} text */
    async rememberNow(text) {
      if (screenNote(text) !== null) return say(NOTE_SAYS.refused);
      let result;
      try {
        result = await remember(text);
      } catch (err) {
        console.error('Remembering a note from the chat failed:', err);
        return say(NOTE_SAYS.couldNot);
      }
      if (result === 'exists') return say(NOTE_SAYS.exists);
      if (result === 'full') return say(NOTE_SAYS.full);
      if (result !== 'saved') return say(NOTE_SAYS.refused);
      await changed();
      post({ text: NOTE_SAYS.remembered(text), noteUndo: { forget: text } });
      record(null, NOTE_SAYS.remembered(text));
    },

    /** They asked the chat to forget one thing it remembers, or everything. @param {string} which */
    async forgetNow(which) {
      try {
        const notes = await load();
        if (notes.length === 0) return say(NOTE_SAYS.nothing);
        if (which === 'everything') {
          await forgetAll();
          await changed();
          post({ text: NOTE_SAYS.forgottenAll, noteUndo: { remember: notes.map((note) => note.text) } });
          return record(null, NOTE_SAYS.forgottenAll);
        }
        const note = notes.find((saved) => saved.text === which);
        if (!note) return say(NOTE_SAYS.nothing);
        await forget(note);
        await changed();
        post({ text: NOTE_SAYS.forgotten(note.text), noteUndo: { remember: [note.text] } });
        record(null, NOTE_SAYS.forgotten(note.text));
      } catch (err) {
        console.error('Forgetting a note from the chat failed:', err);
        say(NOTE_SAYS.couldNot);
      }
    },

    /** Undo on one of those lines. @param {NoteUndo} undo */
    async undo(undo) {
      try {
        if ('forget' in undo) {
          const note = (await load()).find((saved) => saved.text === undo.forget);
          if (note) await forget(note);
        } else {
          for (const text of undo.remember) await remember(text);
        }
        await changed();
      } catch (err) {
        console.error('Undoing a note change from the chat failed:', err);
        return say(NOTE_SAYS.couldNot);
      }
      post({ text: NOTE_SAYS.undone });
      record('Undo', NOTE_SAYS.undone);
    }
  };
}

/**
 * Does what a reply asked for, after it's shown: the change (a checklist edit, or remembering or
 * forgetting something), and waiting for "done" after how to do a task outside the app.
 * @param {import('#lib/checkin/chat-turns.js').ChatReply} reply
 * @param {{ edits: ReturnType<typeof import('#lib/checkin/checklist-edits.js').createChecklistEdits>,
 *   notes: ReturnType<typeof createNoteActions>,
 *   tasks: () => Promise<import('#lib/checklist/tasks.js').Task[]> }} parts
 */
export async function afterReply(reply, { edits, notes, tasks }) {
  const act = reply.act;
  if (act && 'edit' in act) await edits.request(act.edit, act.said);
  else if (act && 'remember' in act) await notes.rememberNow(act.remember);
  else if (act && 'forget' in act) await notes.forgetNow(act.forget);
  if (reply.awaitDone) {
    const task = (await tasks()).find((item) => item.id === reply.awaitDone);
    if (task && !task.done) edits.awaitDone(task);
  }
}
