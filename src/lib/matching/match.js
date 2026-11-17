import { compareItems } from '#lib/matching/compare-items.js';

// Only scoring lives here, with no Firebase or Gemini, so scripts/check-compare-items.mjs can test
// it in Node. The whole flow for a student (Gemini, embedding, loading mentors) is in find-match.js.

/**
 * A mentor ready to be scored: one list of item vectors per question (empty where their summary was).
 * @typedef {{ id: string, name: string, itemVectors: number[][][] }} MatchableMentor
 */

/**
 * One mentor's result for one student.
 * - perQuestion: the score for each question, or null where it couldn't be compared because either
 *   person's summary for it was empty.
 * - score: the average of the questions that could be compared, or null if none could.
 * - questionsCompared: how many questions that average is based on.
 * @typedef {{ id: string, name: string, score: number | null, perQuestion: (number | null)[],
 *   questionsCompared: number }} RankedMentor
 */

/** Unscored mentors sort below any real score (similarities run from -1 to 1). */
const UNSCORED = -2;

/**
 * Scores a student against every mentor and returns the mentors best first.
 *
 * Each question is compared item by item, student side only: every student item is paired with the
 * mentor's closest item for that question, and those scores are averaged. That asks "does this mentor
 * cover what the student wants?", so a mentor's extra interests don't count against them.
 *
 * A question where either summary is empty (they only said what they don't want) is left out of that
 * pair's average instead of counting as 0, so nobody is marked down for an answer with nothing to match on.
 * @param {number[][][]} studentItems one list of item vectors per question
 * @param {MatchableMentor[]} mentors
 * @returns {RankedMentor[]}
 */
export function rankMentors(studentItems, mentors) {
  return mentors
    .map((mentor) => {
      const perQuestion = studentItems.map((items, i) => compareItems(items, mentor.itemVectors[i], 'student'));
      const compared = /** @type {number[]} */ (perQuestion.filter((s) => s !== null));
      const score = compared.length ? compared.reduce((total, s) => total + s, 0) / compared.length : null;
      return { id: mentor.id, name: mentor.name, score, perQuestion, questionsCompared: compared.length };
    })
    .sort((a, b) => (b.score ?? UNSCORED) - (a.score ?? UNSCORED));
}

/**
 * Why a person should pick the mentor instead of the top match:
 * - 'no-mentors': there was nobody to compare with
 * - 'nothing-to-compare': no question could be compared with any mentor
 * - 'weak-match': the best score is under minScore
 * - 'too-few-questions': the best match was compared on fewer than minQuestions questions
 * - 'near-tie': the top two are less than minGap apart, too close to call
 * @typedef {'no-mentors' | 'nothing-to-compare' | 'weak-match' | 'too-few-questions' | 'near-tie'} CoordinatorReason
 */

/**
 * Says why a person should pick the mentor instead, or returns null if the top match can be used.
 *
 * The minimum number of questions matters because empty summaries are skipped: a mentor compared on
 * one question can score 1.0 from a single matching phrase and outrank one compared on all six.
 *
 * TODO(thresholds): tune all three together on the 20 to 30 example test set before relying on them.
 * 0.3 and 0.05 were starting guesses for whole-answer vectors, and item-by-item scores run higher
 * (two unrelated single words can score about 0.25). 4 of 6 questions is also a starting guess.
 * @param {{ score: number | null, questionsCompared: number }[]} ranked best first, as rankMentors returns it
 * @returns {CoordinatorReason | null}
 */
export function coordinatorReason(ranked, minScore = 0.3, minGap = 0.05, minQuestions = 4) {
  const [first, second] = ranked;
  if (!first) return 'no-mentors';
  if (first.score === null) return 'nothing-to-compare';
  if (first.score < minScore) return 'weak-match';
  if (first.questionsCompared < minQuestions) return 'too-few-questions';
  if (second !== undefined && second.score !== null && first.score - second.score < minGap) return 'near-tie';
  return null;
}

/**
 * True when a person should pick the mentor instead (see coordinatorReason).
 * @param {{ score: number | null, questionsCompared: number }[]} ranked best first
 * @param {number} [minScore]
 * @param {number} [minGap]
 * @param {number} [minQuestions]
 */
export function needsCoordinator(ranked, minScore, minGap, minQuestions) {
  return coordinatorReason(ranked, minScore, minGap, minQuestions) !== null;
}
