import { howToFor } from '#lib/checklist/how-to.js';

// Going through a student's checklist in the check-in chat, one task at a time. Gemini only offers it
// ({{checklist}}, see chat-actions.js); the app does the rest. Each task that isn't done yet gets a
// card with its how-to (how-to.js: the steps, a link, and for joining a society, suggestions here in
// the chat), then Done, Not yet and Ask4Help. Done ticks it through the checklist's own change, as the
// checklist page does, so nothing is ticked without their tap. Stop (or typing "stop") ends it at any
// point. Anything else they type is a question for Gemini, which the page tells about the task on
// screen (onTask), to answer only from its how-to. No Firebase here (the steps are passed in), so the
// checks can run it in Node.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */

/** What the student types to stop. */
const STOP = /^\s*stop\s*[.!]?\s*$/i;

/**
 * A task's card: the task, where it is in the walkthrough, and its how-to (null for one of their own).
 * @typedef {{ kind: 'checklist-task', taskId: string, title: string, position: number, count: number,
 *   howTo: import('#lib/checklist/how-to.js').HowTo | null }} TaskCard
 */
/** @typedef {TaskCard | { kind: 'retry' } | { kind: 'link', label: string, href: string }} ChecklistCard */
/**
 * What the walkthrough adds to the chat: a bubble (from the app, or echoing the student's choice),
 * maybe with a card.
 * @typedef {{ role: 'assistant' | 'user', text: string, card?: ChecklistCard & { id: number } }} ChecklistMessage
 */
/**
 * Where it is, for the page: active while it's running; step; live is the card whose buttons work now.
 * @typedef {{ kind: 'checklist', active: boolean, step: 'checking' | 'task' | 'busy' | 'error' | 'done', live: number | null }} ChecklistState
 */
/**
 * How it ended: everything already done ('all-done'), every task seen ('finished'), stopped, or the
 * checklist couldn't be loaded ('failed', then stopped). ticked: the tasks ticked here; tasks: the
 * list as last loaded or saved (null if it never loaded).
 * @typedef {{ outcome: 'all-done' | 'finished' | 'stopped', ticked: string[], tasks: Task[] | null }} ChecklistResult
 */

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * @param {{ load: () => Promise<Task[]>, tick: (id: string, list: Task[]) => Promise<Task[]>,
 *   post: (message: ChecklistMessage) => void, changed: (state: ChecklistState) => void,
 *   onTask: (task: Task | null) => void, finished: (result: ChecklistResult) => void }} setup
 *   load: the checklist (the checklist's own loader); tick: ticks a task through the checklist's own
 *   change and returns the list as saved; post: adds a bubble; changed: its state changed; onTask:
 *   the task now on screen (null when there isn't one); finished: it ended
 */
export function createChecklistFlow({ load, tick, post, changed, onTask, finished }) {
  /** @type {ChecklistState} */
  let state = { kind: 'checklist', active: false, step: 'done', live: null };
  /** @type {Task[] | null} the list as last loaded or saved */
  let list = null;
  /** @type {Task[]} what it goes through: the tasks not done when it started, in their order */
  let queue = [];
  let at = 0;
  /** @type {string[]} */
  let ticked = [];
  let cards = 0;
  /** What Try again repeats. @type {() => Promise<void>} */
  let again = async () => {};

  /** @param {Partial<ChecklistState>} next */
  const set = (next) => {
    state = { ...state, ...next };
    changed(state);
  };
  /** @param {{ role?: 'assistant' | 'user', text: string, card?: ChecklistCard }} message */
  const say = (message) => {
    if (message.card) {
      const id = ++cards;
      post({ role: message.role ?? 'assistant', text: message.text, card: { ...message.card, id } });
      set({ live: id });
    } else {
      post({ role: message.role ?? 'assistant', text: message.text });
    }
  };
  /** @param {ChecklistResult['outcome']} outcome */
  const end = (outcome) => {
    set({ active: false, step: 'done', live: null });
    onTask(null);
    finished({ outcome, ticked, tasks: list });
  };

  function show() {
    const task = queue[at];
    set({ step: 'task', live: null });
    onTask(task);
    say({ text: `${at + 1} of ${queue.length}: ${task.title}`, card: { kind: 'checklist-task', taskId: task.id, title: task.title, position: at + 1, count: queue.length, howTo: howToFor(task.id) } });
  }

  function next() {
    at++;
    if (at < queue.length) {
      show();
      return;
    }
    say({
      text: ticked.length ? `That’s everything for now, and you’ve ticked off ${plural(ticked.length, 'task')}. Nice work!` : 'That’s everything for now. Your checklist is saved as it is, so come back to it whenever you like.',
      card: { kind: 'link', label: 'Open your checklist', href: '/checklist' }
    });
    end('finished');
  }

  async function begin() {
    set({ active: true, step: 'checking', live: null });
    try {
      list = await load();
    } catch (err) {
      console.error('Loading the checklist for the chat failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      again = begin;
      set({ step: 'error' });
      say({ text: 'We couldn’t load your checklist just now. Please try again.', card: { kind: 'retry' } });
      return;
    }
    queue = list.filter((task) => !task.done);
    at = 0;
    ticked = [];
    if (queue.length === 0) {
      say({ text: 'Your checklist’s all done. Nice work!' });
      end('all-done');
      return;
    }
    say({ text: `Let’s go through your checklist, one task at a time: ${plural(queue.length, 'task')} to go. Tap Done when you’ve done one, or Not yet to leave it for now. You can ask me about a task, or type stop to stop.` });
    show();
  }

  /** Ticks the task on screen, through the checklist's own change. @param {Task} task */
  async function tickTask(task) {
    set({ step: 'busy', live: null });
    try {
      list = await tick(task.id, /** @type {Task[]} */ (list));
      ticked.push(task.id);
      next();
    } catch (err) {
      console.error('Ticking a task from the chat failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      again = () => tickTask(task);
      set({ step: 'error' });
      say({ text: `We couldn’t tick off “${task.title}” just now. Please try again.`, card: { kind: 'retry' } });
    }
  }

  return {
    /** @returns {ChecklistState} */
    state: () => state,
    /** Starts it (from the offer card's Start). */
    start() {
      if (!state.active) void begin();
    },
    /** Whether it takes what they typed: only "stop". Anything else is a question for Gemini. @param {string} text */
    takes: (text) => state.active && STOP.test(text),
    /** What they typed: "stop" stops it (returns true); anything else isn't for it (false). @param {string} text */
    reply(text) {
      if (!state.active || !STOP.test(text)) return false;
      stop();
      return true;
    },
    /** Done: ticks the task on screen and moves on. */
    async done() {
      if (!state.active || state.step !== 'task') return;
      const task = queue[at];
      say({ role: 'user', text: 'Done' });
      await tickTask(task);
    },
    /** Not yet: leaves it for now and moves on. */
    notYet() {
      if (!state.active || state.step !== 'task') return;
      say({ role: 'user', text: 'Not yet' });
      next();
    },
    /** Try again, after loading or ticking failed. */
    async tryAgain() {
      if (state.active && state.step === 'error') await again();
    },
    stop
  };

  /** Stops it. Not while a tick is saving. */
  function stop() {
    if (!state.active || state.step === 'busy') return false;
    say({ text: 'Stopped. Your checklist is saved as it is, and we can carry on chatting.' });
    end('stopped');
    return true;
  }
}
