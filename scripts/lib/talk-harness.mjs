// Going through the checklist in the check-in chat, in Node, the way the chat page wires it: the talk
// (checklist-talk.js) with the chat's own turns (chat-turns.js), over a made-up model or Gemini over
// REST, and a checklist kept in memory. What the student sees is collected as a transcript, so the
// checks and measurements can read it, and anyone can read it as a conversation.

import { createChecklistTalk } from '#lib/checkin/checklist-talk.js';
import { chatWith, firstDoneNote } from '#lib/checkin/chat-turns.js';

/**
 * One line of the transcript: who said it, and for the chat, what came with it.
 * @typedef {{ who: 'student' | 'chat', text: string, kind?: string, quick?: { label: string }[], ticked?: { title: string },
 *   tool?: string, ask4help?: boolean, links?: { label: string, kind?: string }[], offers?: string[] }} Line
 */

/**
 * A chat with the checklist talk, as the page runs it.
 * @param {Pick<import('firebase/ai').GenerativeModel, 'generateContent'>} model
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts with tasks: their checklist
 * @param {string[]} opener the first messages Gemini is told
 */
export function talkHarness(model, facts, opener) {
  let current = { ...facts, tasks: (facts.tasks ?? []).map((task) => ({ ...task })) };
  const chat = chatWith(model, { facts: current, opener });
  /** @type {Line[]} */
  const lines = [];
  /** @type {{ outcome: string, text?: string }[]} */
  const endings = [];
  /** What they typed that the talk passed on to the ordinary chat. @type {string[]} */
  const passedOn = [];

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
    const cards = (reply.links?.length ?? 0) + (reply.offers ?? []).filter((offer) => offer !== 'checklist' && offer !== 'checklist-offer').length;
    if (reply.text.trim() || cards) lines.push({
      who: 'chat',
      text: reply.text,
      ...(reply.kind === 'reply' ? {} : { kind: reply.kind }),
      ...(reply.links?.length ? { links: reply.links.map(({ label, kind }) => ({ label, ...(kind ? { kind } : {}) })) } : {}),
      ...(reply.offers?.length ? { offers: reply.offers } : {})
    });
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
      } else {
        await ordinary(text);
      }
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
        line.ticked ? '[Undo]' : '',
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
