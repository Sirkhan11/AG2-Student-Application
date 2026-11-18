import { howToFor, talkFor } from '#lib/checklist/how-to.js';

// Going through a student's checklist as a conversation in the check-in chat, one task at a time, in
// checklist order, their own tasks included. The chat asks one plain question about one task
// ("Have you collected your student ID yet?") with Yes and Not yet as quick replies:
// - Yes (tapped, or typed: "yeah, got it on Monday") ticks that task straight away through the
//   checklist's own change, says so in one line with Undo, and asks about the next task. A typed
//   answer can only tick the task just asked about; an unclear one ("sort of") gets one quick question.
// - Not yet helps, as a conversation: first anything that has to be done before it ("Have you enrolled
//   yet? You need to do that first."), then a sentence or two on how, from that task's how-to only,
//   with what the chat can do there and then (the GP finder, the key contacts, suggestions, the
//   Student Portal), Ask4Help if it isn't straightforward, and then whether to move on or keep going.
// - Stop (typed, or the Stop button) ends it at any point, and so does changing the subject, which
//   goes to the ordinary chat. The next chat picks up at the first task still to do.
// One question at a time, always. Taps and the plainest typed answers never need Gemini; everything
// else is read by Gemini in the checklist's own modes (chat-turns.js), told only the task in hand,
// and never the words of one of their own tasks.
// No Firebase here (the page passes the checklist store in), so the checks can run it in Node.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */

/**
 * A quick reply under the chat's question: what the button says, and what it sends.
 * @typedef {{ label: string, value: string }} QuickReply
 */

/**
 * Something the chat shows, as the talk posts it. kind: the fixed support message, an error, or the
 * chat being unavailable; quick: quick replies under it (only the newest message's work); ticked: the
 * task just ticked, with Undo; tool: what the chat can do for the task there and then; ask4help: the
 * Ask4Help card; links: buttons and cards under it.
 * @typedef {{ text: string, kind?: 'safety' | 'error' | 'unavailable', quick?: QuickReply[], ticked?: { id: string, title: string },
 *   tool?: 'gp-finder' | 'dentist-finder' | 'contacts', ask4help?: boolean, links?: import('#lib/suggestions/catalogue.js').ReplyLink[] }} TalkMessage
 */

/**
 * What Gemini made of a typed answer to the chat's question (checklistAnswer in chat-turns.js): 'yes',
 * 'not-yet', 'unclear' (with one short question back, in say), 'stop', or 'other' (something else).
 * @typedef {{ kind: 'answer', answer: 'yes' | 'not-yet' | 'unclear' | 'stop' | 'other', say: string }
 *   | { kind: 'failed', reply: import('#lib/checkin/chat-turns.js').ChatReply }} Answer
 */

/**
 * Gemini's help with a task (checklistHelp in chat-turns.js): what to say, any cards, whether to show
 * Ask4Help, and what their message was about: this task, saying it's 'done', wanting to 'move-on',
 * 'stop', or something 'other'.
 * @typedef {{ kind: 'help', about: 'task' | 'done' | 'move-on' | 'stop' | 'other', say: string, ask4help: boolean,
 *   links: import('#lib/suggestions/catalogue.js').ReplyLink[] } | { kind: 'failed', reply: import('#lib/checkin/chat-turns.js').ChatReply }} Help
 */

/**
 * Where the talk is. step: 'offered' (the chat offered to go through it), 'asking' (about task),
 * 'first' (about before, which has to be done before task), 'helping' (Gemini asked them something),
 * 'moving' (move on or keep going?), 'doing' (keep going: tell me when it's done), 'busy' (saving or
 * asking Gemini), or 'idle'.
 * @typedef {{ active: boolean, step: 'idle' | 'offered' | 'asking' | 'first' | 'helping' | 'moving' | 'doing' | 'busy',
 *   task: Task | null, before: Task | null }} TalkState
 */

/** The plainest answers, read here without Gemini. A tap sends the same words. */
const YES = /^(yes|yeah|yep|yup|yes please|done|got it|i have|i've done it|already done|sorted)[.!]*$/;
const NOT_YET = /^(no|not yet|nope|nah|no not yet|i haven't|not really)[.!]*$/;
const NOT_NOW = /^(not now|no thanks|no thank you|maybe later)[.!]*$/;
const STOP = /^(stop|stop please|that's enough|enough for now|no more)[.!]*$/;
const MOVE_ON = /^(move on|next|next one|skip|skip it|later)[.!]*$/;
const KEEP_GOING = /^(keep going|keep going with this|do it now|let's do it now)[.!]*$/;
const STUCK = /^(i'm stuck|im stuck|stuck|help)[.!]*$/;

/** A typed answer, tidied for those: lower case, straight apostrophes, single spaces. @param {string} text */
const plain = (text) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** The quick replies the chat shows. */
export const QUICK = Object.freeze({
  yesNo: [{ label: 'Yes', value: 'Yes' }, { label: 'Not yet', value: 'Not yet' }],
  offer: [{ label: 'Yes', value: 'Yes' }, { label: 'Not now', value: 'Not now' }],
  moving: [{ label: 'Move on', value: 'Move on' }, { label: 'Keep going', value: 'Keep going' }],
  doing: [{ label: 'Done', value: 'Done' }, { label: 'I’m stuck', value: 'I’m stuck' }]
});

/** What the chat says. Kept together so the checks and the page say the same. */
export const SAYS = Object.freeze({
  offer: 'Want to go through your checklist together, one task at a time?',
  declined: 'No problem. Just ask whenever you’d like to go through it.',
  ticked: (/** @type {string} */ title) => `Ticked: ${title}.`,
  unticked: (/** @type {string} */ title) => `Okay, “${title}” isn’t ticked any more.`,
  ownNotYet: 'No problem. It’s one of your own, so it’ll be on your checklist when you’re ready.',
  moving: 'Shall we move on to the next one, or keep going with this?',
  doing: 'Okay. Tell me when you’ve done it and I’ll tick it off, or ask me anything about it.',
  stuck: 'Ask4Help can sort it out with you: use Ask4Help Online, or call 0191 227 4646.',
  stopped: 'Okay, we’ll stop there. Your checklist is saved as it is, and we can pick it up next time.',
  allDone: 'That’s everything on your checklist done. Nice work!',
  endOfList: 'That’s the end of the list. The ones still to do will be on your checklist, and we can come back to them next time.',
  couldNotLoad: 'Sorry, I couldn’t load your checklist just now. Please try again in a minute.',
  couldNotTick: 'Sorry, I couldn’t tick that just now. Please try again in a minute.'
});

/** How the chat's own words about one of their own tasks are kept for Gemini, which never sees its name. */
export const OWN_TASK_FOR_GEMINI = Object.freeze({
  question: 'Have you done one of your own checklist tasks yet? (Its name isn’t shared with you.)',
  ticked: 'Ticked one of their own tasks.',
  unticked: 'Unticked one of their own tasks.'
});

/** Whether a task is one of their own (no how-to). @param {Task} task */
const ownTask = (task) => talkFor(task.id) === null;

/**
 * How the chat asks about a task: its own question for a standard one ("Have you collected your
 * student ID yet?"), or with the student's own words for one of theirs.
 * @param {Task} task
 */
export function questionFor(task) {
  return talkFor(task.id)?.question ?? `Have you done “${task.title}” yet?`;
}

/**
 * What a plain typed answer means, or null if it needs Gemini.
 * @param {string} text
 * @returns {'yes' | 'not-yet' | 'not-now' | 'stop' | 'move-on' | 'keep-going' | 'stuck' | null}
 */
export function plainAnswer(text) {
  const said = plain(text);
  if (YES.test(said)) return 'yes';
  if (NOT_YET.test(said)) return 'not-yet';
  if (NOT_NOW.test(said)) return 'not-now';
  if (STOP.test(said)) return 'stop';
  if (MOVE_ON.test(said)) return 'move-on';
  if (KEEP_GOING.test(said)) return 'keep-going';
  if (STUCK.test(said)) return 'stuck';
  return null;
}

/**
 * Creates the talk for one chat.
 * @param {{
 *   load: () => Promise<Task[]>,
 *   tick: (id: string, done: boolean, list: Task[]) => Promise<Task[]>,
 *   post: (message: TalkMessage) => void,
 *   record: (student: string | null, chat: string) => void,
 *   answer: (text: string, task: Task, question: string) => Promise<Answer>,
 *   help: (text: string, task: Task, first: boolean, fromApp: boolean) => Promise<Help>,
 *   firstDone: (first: Task, then: Task) => string,
 *   changed: (state: TalkState) => void,
 *   finished: (result: { outcome: 'done' | 'stopped' | 'other' | 'declined' | 'failed', text?: string, tasks: Task[] }) => void
 * }} parts
 *   load: their checklist now; tick: ticks or unticks one task through the checklist's own change,
 *   and returns the list as it is now; post: shows something in the chat; record: adds what was said
 *   to Gemini's side of the conversation (the student's words, or null to add to the chat's last
 *   message), so the ordinary chat knows; answer and help: Gemini's checklist modes; firstDone: the
 *   app's note to Gemini when the task that comes first is done; finished: it ended ('other' with
 *   what they typed, for the ordinary chat to answer)
 */
export function createChecklistTalk({ load, tick, post, record, answer, help, firstDone, changed, finished }) {
  /** @type {TalkState} */
  let state = { active: false, step: 'idle', task: null, before: null };
  /** @type {Task[]} */
  let list = [];
  /** Tasks they said not yet to in this talk, so it moves past them. */
  const later = new Set();
  /** Whether the task in hand has had its first help (its tool is shown once). */
  let helped = false;

  /** @param {Partial<TalkState>} next */
  function set(next) {
    state = { ...state, ...next };
    changed(state);
  }

  /**
   * Shows something, and keeps it for Gemini (in other words, for one of their own tasks).
   * @param {TalkMessage} message @param {string | null} student @param {string} [forGemini]
   */
  function say(message, student, forGemini = message.text) {
    post(message);
    record(student, forGemini);
  }

  /** The next task to ask about: the first not done, and not put off in this talk. */
  const nextTask = () => list.find((task) => !task.done && !later.has(task.id)) ?? null;

  /** @param {'done' | 'stopped' | 'other' | 'declined' | 'failed'} outcome @param {string} [text] */
  function end(outcome, text) {
    set({ active: false, step: 'idle', task: null, before: null });
    finished({ outcome, ...(text === undefined ? {} : { text }), tasks: list });
  }

  /** @param {Task} task @param {string | null} student */
  function ask(task, student) {
    helped = false;
    set({ active: true, step: 'asking', task, before: null });
    say({ text: questionFor(task), quick: QUICK.yesNo }, student, ownTask(task) ? OWN_TASK_FOR_GEMINI.question : questionFor(task));
  }

  /** Asks about the next task, or ends: all done, or the end of the list. @param {string | null} student */
  function askNext(student) {
    const task = nextTask();
    if (task) return ask(task, student);
    say({ text: list.every((item) => item.done) ? SAYS.allDone : SAYS.endOfList }, student);
    end('done');
  }

  /** @param {string | null} student */
  function stopped(student) {
    say({ text: SAYS.stopped }, student);
    end('stopped');
  }

  /**
   * Something went wrong with Gemini: the support message ends the talk, as does the chat being
   * unavailable; any other failure shows the error and stays where it was, so they can try again.
   * @param {import('#lib/checkin/chat-turns.js').ChatReply} reply @param {TalkState['step']} back
   */
  function failed(reply, back) {
    post({ text: reply.text, kind: reply.kind === 'reply' || reply.kind === 'skip' ? 'error' : reply.kind });
    if (reply.kind === 'safety' || reply.kind === 'unavailable') end('failed');
    else set({ step: back });
  }

  /**
   * Ticks a task, says so with Undo, and keeps it for Gemini.
   * @param {Task} task @param {string} student
   * @returns {Promise<boolean>} whether it was ticked
   */
  async function tickIt(task, student) {
    try {
      list = await tick(task.id, true, list);
    } catch (err) {
      console.error('Ticking a task from the chat failed:', err);
      say({ text: SAYS.couldNotTick, quick: QUICK.yesNo }, student);
      return false;
    }
    post({ text: SAYS.ticked(task.title), ticked: { id: task.id, title: task.title } });
    record(student, ownTask(task) ? OWN_TASK_FOR_GEMINI.ticked : SAYS.ticked(task.title));
    return true;
  }

  /** Yes: ticks it, then asks about the next one. @param {Task} task @param {string} student */
  async function yes(task, student) {
    const back = state.step;
    set({ step: 'busy' });
    if (await tickIt(task, student)) askNext(null);
    else set({ step: back === 'busy' ? 'asking' : back });
  }

  /** Not yet: first anything that has to be done before it, then help with it. @param {Task} task @param {string} student */
  async function notYet(task, student) {
    later.add(task.id);
    const talk = talkFor(task.id);
    if (!talk) {
      // One of their own: no how-to, so nothing to help with here.
      say({ text: SAYS.ownNotYet }, student);
      return askNext(null);
    }
    const before = talk.needsFirst ? list.find((item) => item.id === talk.needsFirst?.task && !item.done) ?? null : null;
    if (before && talk.needsFirst) {
      set({ step: 'first', task, before });
      return say({ text: talk.needsFirst.question, quick: QUICK.yesNo }, student);
    }
    await helpWith(task, student, false);
  }

  /**
   * Gemini's help with a task, then (unless it asked them something) whether to move on.
   * @param {Task} task @param {string} text @param {boolean} fromApp
   */
  async function helpWith(task, text, fromApp) {
    const first = !helped;
    helped = true;
    set({ step: 'busy', task });
    const result = await help(text, task, first, fromApp);
    if (result.kind === 'failed') return failed(result.reply, 'moving');
    if (result.about === 'other') return end('other', text);
    if (result.about === 'stop') return stopped(text);
    if (result.about === 'move-on') return askNext(text);
    if (result.about === 'done') {
      set({ step: 'busy' });
      if (await tickIt(task, text)) return askNext(null);
      return set({ step: 'moving' });
    }
    const talk = talkFor(task.id);
    const tool = first ? talk?.tool : undefined;
    const portal = tool === 'portal' ? howToFor(task.id)?.link : null;
    // chat-turns.js has kept Gemini's words; the app's own come after them.
    post({
      text: result.say,
      ...(tool === 'gp-finder' || tool === 'dentist-finder' || tool === 'contacts' ? { tool } : {}),
      ...(result.ask4help ? { ask4help: true } : {}),
      links: [...result.links, ...(portal ? [{ label: portal.label, href: portal.href, external: /^https?:/.test(portal.href) }] : [])]
    });
    if (/\?\s*$/.test(result.say)) return set({ step: 'helping' });
    set({ step: 'moving' });
    say({ text: SAYS.moving, quick: QUICK.moving }, null);
  }

  return {
    get state() {
      return state;
    },

    /**
     * Starts going through it, loading their checklist first, at the first task still to do (or one
     * they named, if it's still to do).
     * @param {{ asked?: boolean, student?: string | null, from?: string }} [options] asked: the chat's
     *   first message already asked about that task (buildOpener), so the talk waits for the answer;
     *   student: what they said that started it (kept for Gemini with the first question); from: the
     *   id of a task they named
     */
    async start({ asked = false, student = null, from } = {}) {
      set({ active: true, step: 'busy', task: null, before: null });
      try {
        list = await load();
      } catch (err) {
        console.error('Loading the checklist for the chat failed:', err);
        post({ text: SAYS.couldNotLoad });
        return end('failed');
      }
      later.clear();
      const named = from ? list.find((item) => item.id === from && !item.done) : null;
      if (named) return ask(named, student);
      const task = nextTask();
      if (asked && task) {
        helped = false;
        return set({ step: 'asking', task });
      }
      askNext(student);
    },

    /** The chat offers to go through it, in one line, with Yes and Not now. */
    offer() {
      set({ active: true, step: 'offered', task: null, before: null });
      say({ text: SAYS.offer, quick: QUICK.offer }, null);
    },

    /** Whether what they type now is the talk's (otherwise it's for the ordinary chat). */
    takes() {
      return state.active && state.step !== 'busy';
    },

    /** Their answer, tapped or typed. @param {string} text */
    async reply(text) {
      const plainly = plainAnswer(text);
      if (plainly === 'stop') return stopped(text);
      const step = state.step;

      if (step === 'offered') {
        if (plainly === 'yes') return this.start({ student: text });
        if (plainly === 'not-yet' || plainly === 'not-now') {
          say({ text: SAYS.declined }, text);
          return end('declined');
        }
        return end('other', text);
      }

      const task = state.task;
      if (!task) return;

      if (step === 'asking' || step === 'first') {
        // "Skip" or "next": on to the next task, without help.
        if (plainly === 'move-on') {
          later.add(task.id);
          return askNext(text);
        }
        const before = step === 'first' ? state.before : null;
        const about = before ?? task;
        /** @type {'yes' | 'not-yet' | null} */
        let meaning = plainly === 'yes' || plainly === 'not-yet' ? plainly : null;
        if (!meaning) {
          set({ step: 'busy' });
          const asked = before ? talkFor(task.id)?.needsFirst?.question ?? questionFor(before) : questionFor(task);
          const read = await answer(text, about, asked);
          if (read.kind === 'failed') return failed(read.reply, step);
          if (read.answer === 'other') return end('other', text);
          if (read.answer === 'stop') return stopped(text);
          if (read.answer === 'unclear') {
            set({ step });
            return say({ text: read.say, quick: QUICK.yesNo }, text);
          }
          meaning = read.answer;
        }
        if (!before) return meaning === 'yes' ? yes(task, text) : notYet(task, text);
        // About the task that comes first: yes ticks it, then help with the one asked about; not yet
        // means helping with the one that comes first.
        if (meaning === 'yes') {
          set({ step: 'busy' });
          if (!(await tickIt(before, text))) return set({ step: 'first' });
          set({ before: null });
          return helpWith(task, firstDone(before, task), true);
        }
        later.add(before.id);
        set({ task: before, before: null });
        helped = false;
        return helpWith(before, text, false);
      }

      if (plainly === 'move-on') return askNext(text);
      if (plainly === 'keep-going' && step === 'moving') {
        set({ step: 'doing' });
        return say({ text: SAYS.doing, quick: QUICK.doing }, text);
      }
      if (plainly === 'yes' && step === 'doing') return yes(task, text);
      if (plainly === 'stuck') {
        post({ text: SAYS.stuck, ask4help: true });
        record(text, SAYS.stuck);
        set({ step: 'moving' });
        return say({ text: SAYS.moving, quick: QUICK.moving }, null);
      }
      return helpWith(task, text, false);
    },

    /**
     * Undo on a "Ticked" line: unticks that task, says so, and asks about it again.
     * @param {string} id
     */
    async undo(id) {
      if (state.step === 'busy') return;
      let task = list.find((item) => item.id === id);
      if (!task) {
        // After the talk, or in a new one: the list as it is now.
        try {
          list = await load();
        } catch {
          return post({ text: SAYS.couldNotTick });
        }
        task = list.find((item) => item.id === id);
        if (!task) return;
      }
      const back = state;
      set({ active: true, step: 'busy' });
      try {
        list = await tick(id, false, list);
      } catch (err) {
        console.error('Unticking a task from the chat failed:', err);
        post({ text: SAYS.couldNotTick });
        return set(back);
      }
      later.delete(id);
      const again = list.find((item) => item.id === id) ?? task;
      say({ text: SAYS.unticked(again.title) }, 'Undo', ownTask(again) ? OWN_TASK_FOR_GEMINI.unticked : SAYS.unticked(again.title));
      ask(again, null);
    },

    /** Stop: ends it at any point. Changing the subject (another action) ends it quietly. @param {{ quietly?: boolean }} [options] */
    stop({ quietly = false } = {}) {
      if (!state.active) return;
      if (quietly) return end('stopped');
      stopped('Stop');
    }
  };
}
