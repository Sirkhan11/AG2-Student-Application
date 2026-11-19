import { understandReply } from '#lib/checkin/mentor-replies.js';
import { isCrisis, SAFETY_MESSAGE } from '#lib/checkin/safety.js';
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
// to Gemini. What each message means is worked out on the phone (mentor-replies.js): most are their
// answer, however short, and some are about the questions ("will that be saved?", "can I try again?",
// "start again?"), which it answers or does (agent1.md A13). The steps it shares with the page (checks, matching, saving, what each outcome says) are
// in find-mentor-steps.js. No Firebase here (the steps are passed in), so the checks run it in Node.
// A message that suggests they may be at risk (safety.js) is never one of the answers: the chat page
// answers it with the support message before the flow sees it, and the questions stop there, with
// nothing saved (setAside); the flow refuses one itself too, and so does the finder (agent1.md A13).
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
 * kind 'safety': the support message (SAFETY_MESSAGE), shown as the chat shows it.
 * @typedef {{ role: 'assistant' | 'user', text: string, card?: FlowCard & { id: number }, question?: boolean, celebrate?: boolean, kind?: 'safety' }} FlowMessage
 */

/**
 * Where the flow is, for the page: kind (which of the chat's actions); active while it's running;
 * step; live is the card whose buttons work now (null for none).
 * confirm: it's asking first, before keeping a question for the chat as their answer, or before
 * stopping or starting again when they asked in their own words (agent1.md A14).
 * @typedef {{ kind: 'mentor', active: boolean, step: 'checking' | 'question' | 'confirm' | 'frequency' | 'availability' | 'review' | 'busy'
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

/** Asked whether anything is saved: true, and the same question again. */
export const ABOUT_SAVING = 'Nothing’s saved yet: your answers are only saved when you choose Find my mentor at the end, and you can change any of them before then.';
/** Starting again: nothing they've typed so far is kept. */
export const STARTING_AGAIN = 'Starting again, with nothing kept.';
/** An exclamation, not an answer ("ooo poop"). */
export const NOT_KEPT = 'I won’t keep that as your answer.';
/** Asked before stopping, when they asked in their own words: stopping throws their answers away. */
export const STOP_SURE = 'Do you want to stop the questions? Nothing’s been saved, so your answers so far won’t be kept.';
/** Asked before starting again, when they asked in their own words. */
export const RESTART_SURE = 'Start again from question 1? Your answers so far won’t be kept.';
/** The buttons for asking first: a question typed instead of an answer; stopping; starting again. */
const KEEP_OR_AGAIN = [{ id: 'keep', label: 'Keep it as my answer' }, { id: 'again', label: 'Answer again' }];
const STOP_OR_CARRY_ON = [{ id: 'stop', label: 'Stop the questions' }, { id: 'carry-on', label: 'Carry on' }];
const RESTART_OR_CARRY_ON = [{ id: 'restart', label: 'Start again' }, { id: 'carry-on', label: 'Carry on' }];
/** Typed answers to those: yes, or no. */
const YES = /^(yes|yeah|yep|y|sure|keep( it)?|keep it as my answer)[.!]*$/i;
const NO = /^(no|nope|n|no thanks|answer again|carry on|keep going)[.!]*$/i;

/** After the support message, when the questions stop for it: what's happened to them, and that they can come back. */
export const SET_ASIDE = 'I’ve stopped the mentor questions, and nothing from them has been saved. We can come back to them whenever you like.';

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
  /**
   * What it's asking first, while that card is live (step 'confirm'): whether to keep a question for the
   * chat as their answer, or whether they meant to stop or start again (both throw their answers away).
   * @type {{ kind: 'answer', text: string } | { kind: 'stop' } | { kind: 'restart' } | null}
   */
  let pending = null;
  /** The step it asked from, to carry on from. @type {FlowState['step']} */
  let askedFrom = 'question';
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
   * celebrate: the moment they're matched, for the page to celebrate. kind 'safety': the support message.
   * @param {{ role?: 'assistant' | 'user', text: string, card?: FlowCard, question?: boolean, celebrate?: boolean, kind?: 'safety' }} message
   */
  const say = (message) => {
    if (message.card) {
      const id = ++cards;
      post({ role: message.role ?? 'assistant', text: message.text, card: { ...message.card, id }, question: message.question, ...(message.celebrate ? { celebrate: true } : {}) });
      set({ live: id });
    } else {
      post({ role: message.role ?? 'assistant', text: message.text, question: message.question, ...(message.kind ? { kind: message.kind } : {}) });
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
    } else if (result.status === 'safety') {
      // An answer suggests they may be at risk, so nothing was sent (the finder checks too).
      say({ text: SAFETY_MESSAGE, kind: 'safety' });
      say({ text: SET_ASIDE });
      end({ outcome: 'stopped' });
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
      say({ text: `Answer six short questions so we can match you with a student mentor who shares your interests and the way you like to do things. ${ANSWERS_NOTE} You can go back, start again or stop at any time: nothing is saved until you choose Find my mentor.` });
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

  /** Their answer to the question being asked, then on to the next (or back to the review). @param {string} typed */
  function keep(typed) {
    answers[question] = typed;
    finder.forget();
    if (changing) review();
    else if (question < questions.length - 1) ask(question + 1);
    else askFrequency();
  }

  /**
   * Asks before acting: keep a question for the chat as their answer, or stop, or start again.
   * @param {{ kind: 'answer', text: string } | { kind: 'stop' } | { kind: 'restart' }} next
   */
  function askFirst(next) {
    pending = next;
    askedFrom = state.step;
    set({ step: 'confirm' });
    if (next.kind === 'answer') {
      say({ text: `Is that your answer to question ${question + 1}? I can answer other questions once we’ve finished these.`, card: { kind: 'choices', choices: KEEP_OR_AGAIN } });
    } else {
      say({ text: next.kind === 'stop' ? STOP_SURE : RESTART_SURE, card: { kind: 'choices', choices: next.kind === 'stop' ? STOP_OR_CARRY_ON : RESTART_OR_CARRY_ON } });
    }
  }

  /** Whatever's being asked now, again: after a nudge, a note, or a question about saving. */
  function askAgain() {
    if (state.step === 'question' || state.step === 'confirm') ask(question);
    else if (state.step === 'frequency') askFrequency();
    else if (state.step === 'availability') askAvailability();
    else if (state.step === 'review') review();
  }

  /** The question before, again: "can I try again?" (or, from how often, the last question). */
  function back() {
    if (state.step === 'review') {
      say({ text: 'Tap Change under the answer you’d like to change.' });
    } else if (state.step === 'availability') {
      say({ text: 'Of course.' });
      askFrequency();
    } else if (state.step === 'frequency') {
      say({ text: 'Of course.' });
      ask(questions.length - 1);
    } else {
      say({ text: 'Of course.' });
      // Changing one from the review: that question again. Otherwise the one they answered last.
      ask(changing ? question : Math.max(0, question - 1));
    }
  }

  /** From question 1 again, with nothing kept. */
  function restart() {
    answers = questions.map(() => '');
    meetingFrequency = '';
    availability = '';
    changing = false;
    pending = null;
    finder.forget();
    say({ text: STARTING_AGAIN });
    ask(0);
  }

  /**
   * What the student typed while the flow is running: an answer, or something about the questions
   * (mentor-replies.js), which it acts on. Returns true when the flow took it, which it always does
   * while active: it's never sent to Gemini.
   * @param {string} text
   */
  function reply(text) {
    if (!state.active) return false;
    // Never kept as an answer: the support message, and the questions stop (the page checks first).
    if (isCrisis(text)) {
      say({ text: SAFETY_MESSAGE, kind: 'safety' });
      setAside();
      return true;
    }
    const typed = text.trim();
    // It asked first (keep it, stop, start again): yes, no, or something else entirely, which drops it.
    if (state.step === 'confirm' && pending) {
      if (YES.test(typed)) {
        choose(pending.kind === 'answer' ? 'keep' : pending.kind);
        return true;
      }
      if (NO.test(typed)) {
        choose(pending.kind === 'answer' ? 'again' : 'carry-on');
        return true;
      }
      pending = null;
      set({ step: askedFrom, live: null });
    }
    const meant = understandReply(typed);
    if (meant === 'stop') {
      stop();
      return true;
    }
    if (state.step === 'busy') return true;
    if (!['question', 'frequency', 'availability', 'review'].includes(state.step)) {
      say({ text: 'Please use the buttons above, or type stop to stop.' });
      return true;
    }
    // Stopping or starting again asked in their own words: asked first, as both throw answers away.
    if (meant === 'ask-stop' || meant === 'ask-restart') {
      askFirst({ kind: meant === 'ask-stop' ? 'stop' : 'restart' });
      return true;
    }
    if (meant === 'restart') {
      restart();
      return true;
    }
    if (meant === 'redo') {
      back();
      return true;
    }
    if (meant === 'about-saving') {
      say({ text: ABOUT_SAVING });
      askAgain();
      return true;
    }
    if (meant === 'nudge') {
      askAgain();
      return true;
    }
    if (meant === 'not-an-answer' && state.step === 'question') {
      say({ text: NOT_KEPT });
      askAgain();
      return true;
    }
    if (state.step === 'question') {
      if (findBlankAnswer([typed]) !== -1) {
        say({ text: `Please answer question ${question + 1}.`, question: true });
        return true;
      }
      // A question for the chat, not an answer: kept only if they say so.
      if (meant === 'check') {
        askFirst({ kind: 'answer', text: typed });
        return true;
      }
      keep(typed);
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
    } else {
      say({ text: 'Please use the buttons above, or type stop to stop.' });
    }
    return true;
  }

  /**
   * A button on the live choices card: how often they'd like to meet, or, where it asked first, keep it
   * or answer again, or stop or start again, or carry on.
   * @param {string} frequency
   */
  function choose(frequency) {
    if (state.active && state.step === 'confirm') {
      const asked = pending;
      pending = null;
      if (frequency === 'keep' && asked?.kind === 'answer') {
        say({ role: 'user', text: 'Keep it as my answer' });
        set({ step: 'question', live: null });
        keep(asked.text);
      } else if (frequency === 'again' && asked?.kind === 'answer') {
        say({ role: 'user', text: 'Answer again' });
        ask(question);
      } else if (frequency === 'stop' && asked?.kind === 'stop') {
        say({ role: 'user', text: 'Stop the questions' });
        stop();
      } else if (frequency === 'restart' && asked?.kind === 'restart') {
        say({ role: 'user', text: 'Start again' });
        restart();
      } else if (frequency === 'carry-on' && asked && asked.kind !== 'answer') {
        say({ role: 'user', text: 'Carry on' });
        set({ step: askedFrom, live: null });
        askAgain();
      } else {
        // Not one of this card's buttons: still asking.
        pending = asked;
      }
      return;
    }
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

  /**
   * A message that suggests they may be at risk (safety.js), which the chat page has answered with the
   * support message and kept out of the flow: the questions stop there, with nothing saved, rather than
   * carry on over it, so nothing they typed in them goes anywhere. Not while it's saving (they'd already
   * chosen Find my mentor, before that message). Returns true if it stopped.
   */
  function setAside() {
    if (!state.active || state.step === 'busy') return false;
    say({ text: SET_ASIDE });
    end({ outcome: 'stopped' });
    return true;
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

  return { state: () => state, start, takes, reply, choose, change, confirm, tryAgain, coordinator: askCoordinator, stop, setAside };
}
