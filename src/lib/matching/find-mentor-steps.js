import { findBlankAnswer } from '#lib/matching/answers.js';
import { SUMMARISE_FAILED } from '#lib/matching/errors.js';
import { MAX_AVAILABILITY_LENGTH, MEETING_FREQUENCIES } from '#lib/matching/meeting.js';
import { questions } from '#lib/matching/questions.js';

// Finding a student a mentor: the steps the Find a mentor page and the check-in chat share, so they
// can't drift apart. What to check, what each case and outcome says, and finding and saving with the
// same error handling: Gemini failing (try again, or ask the coordinator), the credit running out (the
// coordinator only), anything else (try that step again). The matching itself (find-match.js) is
// passed in, as it needs the browser, so the checks can run all of this in Node.

export { MAX_AVAILABILITY_LENGTH, MEETING_FREQUENCIES, questions };

/** The note before the questions, about how the answers are used. */
export const ANSWERS_NOTE =
  'Google’s Gemini AI summarises your answers to find your match, and they’re only used for matching. ' +
  'Your mentor won’t see them. If we can’t find a good match automatically, the mentoring coordinator may read them to match you themselves.';

/**
 * What it says while finding a mentor, and while sending the answers to the coordinator. The note
 * about the download only shows when the matching model isn't ready yet (see model-download.js).
 */
export const FINDING_MESSAGE = 'Finding your mentor…';
export const FIRST_TIME_NOTE = 'The first time, this can take a minute while the matching model downloads.';
export const ASKING_COORDINATOR_MESSAGE = 'Sending your answers to the coordinator…';

/** @param {boolean} modelReady whether the matching model is loaded, or this browser has it already */
export const findingMessage = (modelReady) => (modelReady ? FINDING_MESSAGE : `${FINDING_MESSAGE} ${FIRST_TIME_NOTE}`);

/** The cases before the questions (checkBeforeMatching), and when Gemini can't help. */
export const SAYS = Object.freeze({
  isMentor: 'You’ve signed up as a mentor, so the coordinator will match students with you.',
  noMentors: 'There are no mentors available yet. Please check back soon.',
  nothingSaved: 'Nothing has been saved, so you can answer the questions once mentors are available.',
  geminiFailed: 'We can’t match you automatically right now. Please try again in a minute.',
  geminiFailedNote: 'If you ask the coordinator, they’ll read your answers and find you a mentor themselves.',
  geminiUnavailable: 'Sorry, automatic matching isn’t available right now.',
  geminiUnavailableNote: 'The coordinator will read your answers and find you a mentor themselves.',
  askCoordinator: 'Ask the coordinator to match me',
  loadFailed: 'We couldn’t check that just now. Please check your connection.'
});

/** "every two weeks" → "Every two weeks". @param {string} text */
export const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Checks the answers as the page does, and returns what to tell the student, or null if they're fine.
 * @param {string[]} answers the six, in question order
 * @param {string} availability when they're usually free
 */
export function checkAnswers(answers, availability) {
  const blank = findBlankAnswer(answers);
  if (blank !== -1) return `Please answer question ${blank + 1}.`;
  return checkAvailability(availability);
}

/**
 * Checks when they're usually free, as the page does: something, and not too long.
 * @param {string} availability
 */
export function checkAvailability(availability) {
  if (availability.trim() === '') return 'Please say when you’re usually free.';
  if (availability.trim().length > MAX_AVAILABILITY_LENGTH) return `Please keep it to ${MAX_AVAILABILITY_LENGTH} characters.`;
  return null;
}

/**
 * What to say about a match record they already have (checkBeforeMatching's 'has-record').
 * @param {import('#lib/matching/matches.js').Match} match
 */
export const alreadyHasText = (match) =>
  match.status === 'matched'
    ? `You’ve already been matched with ${match.mentorName ?? 'a mentor'}.`
    : 'We’re already finding you a mentor, and we’ll let you know soon.';

/**
 * What to say once it's saved: the same words the chat's first message uses after the page saves.
 * @param {import('#lib/matching/find-match.js').SaveOutcome} outcome
 */
export function outcomeText(outcome) {
  if (outcome.outcome === 'matched') return `Thanks for answering those questions. You’ve been matched with ${outcome.mentorName}, and your coordinator will introduce you.`;
  if (outcome.outcome === 'coordinator') return 'Thanks for answering those questions. We’re finding you a mentor, and we’ll let you know soon.';
  if (outcome.outcome === 'already-saved') return alreadyHasText(outcome.match);
  return `${SAYS.noMentors} ${SAYS.nothingSaved}`;
}

/**
 * The matching steps (find-match.js in the app; made-up ones in the checks). getReady starts loading
 * the matching model when the questions start, and modelReady says whether it's ready, for the
 * message while finding (model-download-browser.js); without them, the message has the note.
 * @typedef {{ prepareStudent: (answers: string[]) => Promise<any>,
 *   matchAndSave: (prepared: any, preferences: { meetingFrequency: string, availability: string }) => Promise<import('#lib/matching/find-match.js').SaveOutcome>,
 *   askCoordinator: (answers: string[], preferences: { meetingFrequency: string, availability: string }) => Promise<import('#lib/matching/find-match.js').SaveOutcome>,
 *   getReady?: () => void, modelReady?: () => boolean }} MatchingSteps
 */

/**
 * How a step went: saved (with the outcome), Gemini failed (try again or ask the coordinator), Gemini's
 * credit has run out (the coordinator only), or something else failed (try that step again).
 * @typedef {{ status: 'saved', outcome: import('#lib/matching/find-match.js').SaveOutcome }
 *   | { status: 'gemini-failed' } | { status: 'gemini-unavailable' }
 *   | { status: 'error', step: 'prepare' | 'save' | 'coordinator', message: string, error: unknown }} FindResult
 */

/**
 * Finds a mentor and saves the result, as the page and the chat both do. What Gemini prepared is kept,
 * so trying again after a failed save never asks Gemini again. Nothing is saved until find() or
 * askCoordinator() is called, which only happens when the student confirms.
 * @param {MatchingSteps} steps
 */
export function createFinder(steps) {
  /** @type {any} what prepareStudent made, or null */
  let prepared = null;

  /** @param {{ meetingFrequency: string, availability: string }} preferences @returns {Promise<FindResult>} */
  async function save(preferences) {
    try {
      return { status: 'saved', outcome: await steps.matchAndSave(prepared, preferences) };
    } catch (error) {
      return { status: 'error', step: 'save', message: 'We couldn’t save your match.', error };
    }
  }

  return {
    /**
     * Gemini and the matching model (once), then matching and saving.
     * @param {string[]} answers
     * @param {{ meetingFrequency: string, availability: string }} preferences
     * @returns {Promise<FindResult>}
     */
    async find(answers, preferences) {
      if (!prepared) {
        try {
          prepared = await steps.prepareStudent(answers.map((answer) => answer.trim()));
        } catch (error) {
          const failure = /** @type {{ code?: string, outOfCredit?: boolean }} */ (error);
          // Not passed to the coordinator automatically: a match record is permanent, so the student chooses.
          if (failure?.code === SUMMARISE_FAILED) return { status: failure.outOfCredit ? 'gemini-unavailable' : 'gemini-failed' };
          return { status: 'error', step: 'prepare', message: 'We couldn’t get your answers ready to match.', error };
        }
      }
      return save(preferences);
    },
    /** Saving again after it failed, with what was prepared. */
    save,
    /**
     * For when Gemini can't help and the student would rather be matched by hand.
     * @param {string[]} answers
     * @param {{ meetingFrequency: string, availability: string }} preferences
     * @returns {Promise<FindResult>}
     */
    async askCoordinator(answers, preferences) {
      try {
        return { status: 'saved', outcome: await steps.askCoordinator(answers.map((answer) => answer.trim()), preferences) };
      } catch (error) {
        return { status: 'error', step: 'coordinator', message: 'We couldn’t send your request to the coordinator.', error };
      }
    },
    /** Their answers changed, so what was prepared from the old ones is dropped. */
    forget() {
      prepared = null;
    }
  };
}
