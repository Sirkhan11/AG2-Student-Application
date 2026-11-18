import { findBlankAnswer } from '#lib/matching/answers.js';
import {
  alreadyHasText,
  ANSWERS_NOTE,
  ASKING_COORDINATOR_MESSAGE,
  capitalise,
  checkAnswers,
  checkAvailability,
  createFinder,
  findingMessage,
  MEETING_FREQUENCIES,
  outcomeText,
  questions,
  SAYS
} from '#lib/matching/find-mentor-steps.js';

// Finding a mentor in the check-in chat. Gemini only offers it ({{mentor}}, see chat-actions.js); the
// app does the rest: after the same checks as the Find a mentor page, it asks the six questions
// (questions.js) one at a time as chat bubbles, then how often they'd like to meet (buttons) and when
// they're usually free, and shows their answers with Change and Find my mentor. Nothing is saved until
// they tap Find my mentor, and Stop (or typing "stop") ends it at any point before that, with nothing
// saved. The answers stay in the chat session: the page sends what they type here to this flow, never
// to Gemini. The steps it shares with the page (checks, matching, saving, what each outcome says) are
// in find-mentor-steps.js. No Firebase here (the steps are passed in), so the checks run it in Node.
//
// It's the first of the chat's actions; later ones (changing mentor, the checklist, the GP finder)
// follow the same shape: start, reply(text), the card's buttons, stop, and finished(result).

/**
 * A card under one of the flow's bubbles. Its buttons only work while it's the live card.
 * @typedef {{ kind: 'choices', choices: { id: string, label: string }[] }
 *   | { kind: 'review', items: { label: string, answer: string, change: number }[] }
 *   | { kind: 'gemini-failed' } | { kind: 'gemini-unavailable' } | { kind: 'retry' }
 *   | { kind: 'link', label: string, href: string }} FlowCard
 */

/**
 * What the flow adds to the chat: a bubble (from the app, or echoing the student's choice), maybe with
 * a card. question: it asks for a typed answer, so the page announces it and moves focus to the box.
 * @typedef {{ role: 'assistant' | 'user', text: string, card?: FlowCard & { id: number }, question?: boolean, celebrate?: boolean }} FlowMessage
 */

/**
 * Where the flow is, for the page: kind (which of the chat's actions); active while it's running;
 * step; live is the card whose buttons work now (null for none).
 * @typedef {{ kind: 'mentor', active: boolean, step: 'checking' | 'question' | 'frequency' | 'availability' | 'review' | 'busy'
 *   | 'gemini-failed' | 'gemini-unavailable' | 'error' | 'done', live: number | null }} FlowState
 */

/**
 * How it ended, for the page to tell Gemini (so it doesn't offer again): what happened, the match or
 * what was saved, where there is one, and Gemini's summary of their answers when they were matched
 * or passed to the coordinator with one (for the chat's message straight after).
 * @typedef {{ outcome: 'matched' | 'coordinator' | 'already-saved' | 'no-mentors' | 'is-mentor' | 'has-record' | 'stopped',
 *   saved?: import('#lib/matching/find-match.js').SaveOutcome, match?: import('#lib/matching/matches.js').Match,
 *   summary?: import('#lib/matching/summary-prompt.js').Summary | null }} FlowResult
 */

/** What the student types to stop. */
const STOP = /^\s*stop\s*[.!]?\s*$/i;

/**
 * @param {{ check: () => Promise<{ view: 'is-mentor' | 'no-mentors' | 'form' } | { view: 'has-record', match: import('#lib/matching/matches.js').Match }>,
 *   steps: import('#lib/matching/find-mentor-steps.js').MatchingSteps,
 *   post: (message: FlowMessage) => void,
 *   changed: (state: FlowState) => void,
 *   finished: (result: FlowResult) => void }} setup
 *   check: checkBeforeMatching (find-match.js); steps: the matching steps; post: adds a bubble to the
 *   chat; changed: the flow's state changed; finished: it ended (saved, stopped, or nothing to do)
 */
export function createMentorFlow({ check, steps, post, changed, finished }) {
  const finder = createFinder(steps);
  /** @type {FlowState} */
  let state = { kind: 'mentor', active: false, step: 'done', live: null };
  let answers = questions.map(() => '');
  let meetingFrequency = '';
  let availability = '';
  let question = 0;
  /** Changing one answer from the review: go back to the review after it, not on through the rest. */
  let changing = false;
  /** What Try again repeats after an error. @type {() => Promise<void>} */
  let again = async () => {};
  let cards = 0;

  /** @param {Partial<FlowState>} next */
  const set = (next) => {
    state = { ...state, ...next };
    changed(state);
  };
  /**
   * Posts a bubble (from the app unless role says otherwise); one with a card makes that card the live one.
   * celebrate: the moment they're matched, for the page to celebrate.
   * @param {{ role?: 'assistant' | 'user', text: string, card?: FlowCard, question?: boolean, celebrate?: boolean }} message
   */
  const say = (message) => {
    if (message.card) {
      const id = ++cards;
      post({ role: message.role ?? 'assistant', text: message.text, card: { ...message.card, id }, question: message.question, ...(message.celebrate ? { celebrate: true } : {}) });
      set({ live: id });
    } else {
      post({ role: message.role ?? 'assistant', text: message.text, question: message.question });
    }
  };
  const preferences = () => ({ meetingFrequency, availability });

  /** @param {FlowResult} result */
  const end = (result) => {
    set({ active: false, step: 'done', live: null });
    finished(result);
  };

  /** @param {number} index */
  const ask = (index) => {
    question = index;
    set({ step: 'question', live: null });
    say({ text: `Question ${index + 1} of ${questions.length}: ${questions[index]}`, question: true });
  };
  const askFrequency = () => {
    set({ step: 'frequency' });
    say({ text: 'How often would you like to meet?', card: { kind: 'choices', choices: MEETING_FREQUENCIES.map((id) => ({ id, label: capitalise(id) })) }, question: true });
  };
  const askAvailability = () => {
    set({ step: 'availability', live: null });
    say({ text: 'When are you usually free? For example, weekday afternoons.', question: true });
  };
  const review = () => {
    changing = false;
    set({ step: 'review' });
    say({
      text: 'Here are your answers. You can change any of them before I find your mentor.',
      card: {
        kind: 'review',
        items: [
          ...questions.map((label, i) => ({ label, answer: answers[i], change: i })),
          { label: 'How often you’d like to meet', answer: capitalise(meetingFrequency), change: questions.length },
          { label: 'When you’re usually free', answer: availability, change: questions.length + 1 }
        ]
      }
    });
  };

  /** @param {import('#lib/matching/find-mentor-steps.js').FindResult} result */
  const handle = (result) => {
    if (result.status === 'saved') {
      const saved = result.outcome;
      const matched = saved.outcome === 'matched' || (saved.outcome === 'already-saved' && saved.match.status === 'matched');
      say({ text: outcomeText(saved), card: saved.outcome === 'no-mentors' ? undefined : { kind: 'link', label: matched ? 'Your mentor' : 'See your mentor page', href: '/mentor' }, celebrate: saved.outcome === 'matched' });
      end({ outcome: saved.outcome, saved, match: saved.outcome === 'already-saved' ? saved.match : undefined, summary: result.summary });
    } else if (result.status === 'gemini-failed') {
      set({ step: 'gemini-failed' });
      say({ text: `${SAYS.geminiFailed} ${SAYS.geminiFailedNote}`, card: { kind: 'gemini-failed' } });
    } else if (result.status === 'gemini-unavailable') {
      set({ step: 'gemini-unavailable' });
      say({ text: `${SAYS.geminiUnavailable} ${SAYS.geminiUnavailableNote}`, card: { kind: 'gemini-unavailable' } });
    } else {
      console.error('Finding a mentor in the chat failed:', /** @type {{ code?: string }} */ (result.error)?.code ?? result.step);
      again = result.step === 'prepare' ? find : result.step === 'save' ? saveAgain : coordinator;
      set({ step: 'error' });
      say({ text: `${result.message} Please try again.`, card: { kind: 'retry' } });
    }
  };

  /** "Finding your mentor…", with the note about the download only if the model isn't ready yet. */
  const finding = () => findingMessage(steps.modelReady?.() ?? false);

  async function find() {
    set({ step: 'busy', live: null });
    say({ text: finding() });
    handle(await finder.find(answers, preferences()));
  }
  async function saveAgain() {
    set({ step: 'busy', live: null });
    say({ text: finding() });
    handle(await finder.save(preferences()));
  }
  async function coordinator() {
    set({ step: 'busy', live: null });
    say({ text: ASKING_COORDINATOR_MESSAGE });
    handle(await finder.askCoordinator(answers, preferences()));
  }

  async function begin() {
    set({ active: true, step: 'checking', live: null });
    /** @type {Awaited<ReturnType<typeof check>>} */
    let before;
    try {
      before = await check();
    } catch (err) {
      console.error('Checking before finding a mentor failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
      again = begin;
      set({ step: 'error' });
      say({ text: SAYS.loadFailed, card: { kind: 'retry' } });
      return;
    }
    if (before.view === 'is-mentor') {
      say({ text: SAYS.isMentor });
      end({ outcome: 'is-mentor' });
    } else if (before.view === 'no-mentors') {
      say({ text: `${SAYS.noMentors} ${SAYS.nothingSaved}` });
      end({ outcome: 'no-mentors' });
    } else if (before.view === 'has-record') {
      const matched = before.match.status === 'matched';
      say({
        text: matched ? `${alreadyHasText(before.match)} If you’d like a different mentor, just say so here and you can ask the coordinator.` : alreadyHasText(before.match),
        card: { kind: 'link', label: 'Your mentor', href: '/mentor' }
      });
      end({ outcome: 'has-record', match: before.match });
    } else {
      // The matching model starts loading now, so it's ready by Find my mentor (model-download.js).
      steps.getReady?.();
      say({ text: `Answer six short questions so we can match you with a student mentor who shares your interests and the way you like to do things. ${ANSWERS_NOTE} Type stop at any time to stop: nothing is saved until you choose Find my mentor.` });
      ask(0);
    }
  }

  /** Starts it (from the card's Start, or the first message's Find a mentor button). */
  function start() {
    if (state.active) return;
    answers = questions.map(() => '');
    meetingFrequency = '';
    availability = '';
    changing = false;
    finder.forget();
    begin();
  }

  /**
   * What the student typed while the flow is running: an answer, or "stop". Returns true when the
   * flow took it, which it always does while active: it's never sent to Gemini.
   * @param {string} text
   */
  function reply(text) {
    if (!state.active) return false;
    if (STOP.test(text)) {
      stop();
      return true;
    }
    const typed = text.trim();
    if (state.step === 'question') {
      if (findBlankAnswer([typed]) !== -1) {
        say({ text: `Please answer question ${question + 1}.`, question: true });
        return true;
      }
      answers[question] = typed;
      finder.forget();
      if (changing) review();
      else if (question < questions.length - 1) ask(question + 1);
      else askFrequency();
    } else if (state.step === 'frequency') {
      const choice = MEETING_FREQUENCIES.find((id) => id === typed.toLowerCase());
      if (choice) choose(choice);
      else say({ text: 'Please choose one of the options above.', question: true });
    } else if (state.step === 'availability') {
      const problem = checkAvailability(typed);
      if (problem) {
        say({ text: problem, question: true });
        return true;
      }
      availability = typed;
      finder.forget();
      review();
    } else if (state.step !== 'busy') {
      say({ text: 'Please use the buttons above, or type stop to stop.' });
    }
    return true;
  }

  /** A meeting choice from the buttons. @param {string} frequency */
  function choose(frequency) {
    if (!state.active || state.step !== 'frequency' || !MEETING_FREQUENCIES.includes(frequency)) return;
    meetingFrequency = frequency;
    finder.forget();
    say({ role: 'user', text: capitalise(frequency) });
    if (changing) review();
    else askAvailability();
  }

  /** Change from the review: 0 to 5 are the questions, 6 how often, 7 when they're free. @param {number} item */
  function change(item) {
    if (!state.active || state.step !== 'review') return;
    changing = true;
    if (item < questions.length) ask(item);
    else if (item === questions.length) askFrequency();
    else askAvailability();
  }

  /** Find my mentor: the only way anything is saved (or the coordinator button, below). */
  async function confirm() {
    if (!state.active || state.step !== 'review') return;
    const problem = checkAnswers(answers, availability);
    if (problem) {
      say({ text: problem });
      return;
    }
    await find();
  }

  /** Try again, after Gemini or a step failed. */
  async function tryAgain() {
    if (!state.active) return;
    if (state.step === 'gemini-failed') await find();
    else if (state.step === 'error') await again();
  }

  /** Ask the coordinator to match them by hand, after Gemini couldn't. */
  async function askCoordinator() {
    if (!state.active || (state.step !== 'gemini-failed' && state.step !== 'gemini-unavailable')) return;
    await coordinator();
  }

  /** Stops it, saving nothing. Not while it's saving (they've already chosen Find my mentor). */
  function stop() {
    if (!state.active || state.step === 'busy') return false;
    say({ text: 'Stopped. Nothing has been saved, and we can carry on chatting.' });
    end({ outcome: 'stopped' });
    return true;
  }

  /** Whether it takes what they typed: everything, while it's running (it's never sent to Gemini). @param {string} _text */
  const takes = (_text) => state.active;

  return { state: () => state, start, takes, reply, choose, change, confirm, tryAgain, coordinator: askCoordinator, stop };
}
