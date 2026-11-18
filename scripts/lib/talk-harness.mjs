// The check-in chat in Node, the way the chat page wires it: the chat's own turns (chat-turns.js),
// the checklist talk (checklist-talk.js), and the changes the chat makes when asked from any message
// (checklist-edits.js and run-actions.js), over a made-up model or Gemini over REST, with the
// checklist and what the chat remembers kept in memory. What the student sees is collected as a
// transcript, so the checks and measurements can read it, and anyone can read it as a conversation.

import { createChecklistEdits } from '#lib/checkin/checklist-edits.js';
import { createChecklistTalk } from '#lib/checkin/checklist-talk.js';
import { chatWith, firstDoneNote } from '#lib/checkin/chat-turns.js';
import { withNote, withoutNote } from '#lib/checkin/remember-notes.js';
import { afterReply, createNoteActions } from '#lib/checkin/run-actions.js';
import { applyChange } from '#lib/checklist/tasks.js';

/**
 * One line of the transcript: who said it, and for the chat, what came with it.
 * undo: the line confirms a change the chat made (with Undo); calendar: a calendar card.
 * @typedef {{ who: 'student' | 'chat', text: string, kind?: string, quick?: { label: string }[], ticked?: { title: string },
 *   tool?: string, ask4help?: boolean, links?: { label: string, kind?: string }[], offers?: string[], undo?: boolean,
 *   calendar?: string, cards?: string[] }} Line
 */

/**
 * A chat with the checklist talk, as the page runs it.
 * @param {Pick<import('firebase/ai').GenerativeModel, 'generateContent'>} model
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts with tasks: their checklist
 * @param {string[]} opener the first messages Gemini is told
 * @param {[string, string][]} [seed] a conversation so far: the student's message and the chat's words
 */
export function talkHarness(model, facts, opener, seed = []) {
  let current = { ...facts, tasks: (facts.tasks ?? []).map((task) => ({ ...task })) };
  const chat = chatWith(model, { facts: current, opener, seed });
  /** @type {Line[]} */
  const lines = [];
  /** @type {{ outcome: string, text?: string }[]} */
  const endings = [];
  /** What they typed that the talk passed on to the ordinary chat. @type {string[]} */
  const passedOn = [];
  /** What the chat remembers, as the notes record keeps it. @type {{ text: string, savedAt: any }[]} */
  let notes = (facts.profile?.notes ?? []).map((/** @type {string} */ text, /** @type {number} */ i) => ({ text, savedAt: i }));
  /** The undo for each line that has one, by line. @type {Map<object, any>} */
  const undos = new Map();
  /** Tells the chat what's on the checklist, or what it remembers, now. */
  const retell = () => {
    current = { ...current, profile: { ...(current.profile ?? {}), notes: notes.map((note) => note.text) } };
    chat.retell(current);
  };

  /** Shows one of the changes' lines. @param {import('#lib/checkin/run-actions.js').ActionMessage} message */
  const postChange = (message) => {
    /** @type {Line} */
    const line = {
      who: 'chat',
      text: message.text,
      ...(message.quick ? { quick: message.quick.map(({ label }) => ({ label })) } : {}),
      ...(message.undo || message.noteUndo ? { undo: true } : {})
    };
    lines.push(line);
    if (message.undo) undos.set(line, { checklist: message.undo });
    if (message.noteUndo) undos.set(line, { notes: message.noteUndo });
  };
  const edits = createChecklistEdits({
    load: async () => (current.tasks ?? []).map((task) => ({ ...task })),
    save: async (change, list) => {
      const now = applyChange(list, change);
      current = { ...current, tasks: now, checklistSaved: true };
      chat.retell(current);
      return now;
    },
    post: postChange,
    record: (student, text) => chat.note(student, text)
  });
  const noteActions = createNoteActions({
    load: async () => notes,
    remember: async (text) => {
      const result = withNote(notes, text, notes.length + 100);
      if ('refused' in result) return result.refused;
      notes = result.notes;
      return 'saved';
    },
    forget: async (note) => {
      notes = withoutNote(notes, note, (a, b) => a === b);
    },
    forgetAll: async () => {
      notes = [];
    },
    changed: retell,
    post: postChange,
    record: (student, text) => chat.note(student, text)
  });

  const talk = createChecklistTalk({
    load: async () => (current.tasks ?? []).map((task) => ({ ...task })),
    tick: async (id, done, list) => {
      const now = list.map((task) => (task.id === id ? { ...task, done } : task));
      current = { ...current, tasks: now, checklistSaved: true };
      chat.retell(current);
      return now;
    },
    post: (message) =>
      lines.push({
        who: 'chat',
        text: message.text,
        ...(message.kind ? { kind: message.kind } : {}),
        ...(message.quick ? { quick: message.quick.map(({ label }) => ({ label })) } : {}),
        ...(message.ticked ? { ticked: { title: message.ticked.title } } : {}),
        ...(message.tool ? { tool: message.tool } : {}),
        ...(message.ask4help ? { ask4help: true } : {}),
        ...(message.links?.length ? { links: message.links.map(({ label, kind }) => ({ label, ...(kind ? { kind } : {}) })) } : {})
      }),
    record: (student, text) => chat.note(student, text),
    answer: (text, task, question) => chat.checklistAnswer(text, task, question),
    help: (text, task, first, fromApp) => chat.checklistHelp(text, task, first, fromApp),
    firstDone: (first, then) => firstDoneNote(first.title, then.title),
    changed: () => {},
    finished: (result) => {
      endings.push({ outcome: result.outcome, ...(result.text ? { text: result.text } : {}) });
      if (result.outcome === 'other' && result.text) passedOn.push(result.text);
    }
  });

  /** The ordinary chat's answer to something they said, and what it starts. @param {string} text */
  async function ordinary(text) {
    const reply = await chat.send(text);
    // As on the page, a reply with no words and nothing to show isn't seen (the chat's own offer or
    // question follows).
    const cards = [
      ...(reply.offers ?? []).filter((offer) => offer !== 'checklist' && offer !== 'checklist-offer').map((offer) => `${offer} card`),
      ...(reply.tasks ?? []).map((task) => `Add card: ${task}`),
      ...(reply.notes ?? []).map((note) => `Remember card: ${note}`)
    ];
    if (reply.text.trim() || reply.links?.length || cards.length || reply.tool || reply.ask4help || reply.calendar) {
      lines.push({
        who: 'chat',
        text: reply.text,
        ...(reply.kind === 'reply' ? {} : { kind: reply.kind }),
        ...(reply.links?.length ? { links: reply.links.map(({ label, kind }) => ({ label, ...(kind ? { kind } : {}) })) } : {}),
        ...(reply.offers?.length ? { offers: reply.offers } : {}),
        ...(reply.tool ? { tool: reply.tool } : {}),
        ...(reply.ask4help ? { ask4help: true } : {}),
        ...(reply.calendar ? { calendar: reply.calendar.title } : {}),
        ...(cards.length ? { cards } : {})
      });
    }
    if (reply.kind === 'reply') await afterReply(reply, { edits, notes: noteActions, tasks: async () => current.tasks ?? [] });
    if (reply.offers?.[0] === 'checklist') await talk.start({ from: reply.startAt });
    else if (reply.offers?.[0] === 'checklist-offer') talk.offer();
  }

  return {
    talk,
    chat,
    lines,
    endings,
    /** Their checklist as it is now. */
    tasks: () => current.tasks ?? [],
    /** What the chat remembers now. */
    notes: () => notes.map((note) => note.text),
    /** The first message asked about the first task still to do: the talk waits for the answer. */
    async opened() {
      await talk.start({ asked: true });
    },
    /** They say something (typed, or a tap's words). @param {string} text */
    async say(text) {
      lines.push({ who: 'student', text });
      if (talk.takes()) {
        await talk.reply(text);
        // A change of subject goes on to the ordinary chat, as on the page.
        while (passedOn.length) await ordinary(/** @type {string} */ (passedOn.shift()));
      } else if (edits.takes(text)) {
        await edits.reply(text);
      } else {
        edits.clear();
        await ordinary(text);
      }
    },
    /** Undo on the last line confirming a change the chat made when asked. */
    async undoChange() {
      const line = [...lines].reverse().find((item) => undos.has(item));
      lines.push({ who: 'student', text: '(taps Undo)' });
      const undo = line ? undos.get(line) : null;
      if (undo?.checklist) await edits.undo(undo.checklist);
      else if (undo?.notes) await noteActions.undo(undo.notes);
    },
    /** Undo on the last "Ticked" line. */
    async undo() {
      const ticked = [...lines].reverse().find((line) => line.ticked);
      const task = (current.tasks ?? []).find((item) => item.title === ticked?.ticked?.title);
      lines.push({ who: 'student', text: '(taps Undo)' });
      if (task) await talk.undo(task.id);
    }
  };
}

/**
 * The transcript as a conversation, for reading.
 * @param {Line[]} lines
 */
export function asTranscript(lines) {
  return lines
    .map((line) => {
      if (line.who === 'student') return `Student: ${line.text}`;
      const extras = [
        line.ticked || line.undo ? '[Undo]' : '',
        line.calendar !== undefined ? `[Calendar card: "${line.calendar}", Add to Outlook, .ics]` : '',
        ...(line.cards ?? []).map((card) => `[${card}]`),
        line.tool === 'gp-finder' ? '[GP finder card: postcode box, Use my location]' : '',
        line.tool === 'dentist-finder' ? '[Dentist search card: postcode box, NHS Find a dentist]' : '',
        line.tool === 'contacts' ? '[Key contacts card]' : '',
        line.ask4help ? '[Ask4Help card: Ask4Help Online, 0191 227 4646]' : '',
        ...(line.links ?? []).map((link) => `[${link.kind ? `${link.label} card` : `${link.label} button`}]`),
        line.quick ? `[${line.quick.map((reply) => reply.label).join('] [')}]` : '',
        ...(line.offers ?? []).filter((offer) => offer !== 'checklist' && offer !== 'checklist-offer').map((offer) => `[${offer} card]`)
      ].filter(Boolean);
      return `Chat: ${line.text}${extras.length ? `  ${extras.join(' ')}` : ''}`;
    })
    .join('\n');
}
