import { summariseAnswers } from '#lib/matching/summarise.js';
import { embedSummaries } from '#lib/matching/compare-items.js';
import { loadApprovedMentors } from '#lib/matching/mentors.js';
import { needsCoordinator, rankMentors } from '#lib/matching/match.js';

/**
 * What matching a student gives back:
 * - 'summarise-failed': Gemini couldn't summarise the answers, so nothing was ranked and the
 *   coordinator should match this student by hand.
 * - 'ranked': mentors best first. passToCoordinator is true when the top match is weak, too close
 *   to the next one, or compared on fewer than 4 of the 6 questions (see needsCoordinator).
 * @typedef {{ status: 'summarise-failed', passToCoordinator: true }
 *   | { status: 'ranked', passToCoordinator: boolean,
 *       ranked: import('#lib/matching/match.js').RankedMentor[],
 *       mentorCount: number, studentSummaries: string[][] }} MatchResult
 */

/**
 * Matches a student's six answers against every approved mentor: one Gemini request summarises the
 * answers, each phrase is embedded, and the result is compared with the item vectors the mentors
 * saved at sign-up. Needs a signed-in user, because only signed-in users can read mentors.
 *
 * If Gemini fails, this doesn't fall back to the raw answers. That would bring back the problems the
 * summaries fix (negations, writing style) and match this student differently from everyone else, so
 * they're passed to the coordinator instead. Other failures (the embedding model, Firestore) are
 * thrown, so the page can ask them to try again.
 * @param {string[]} answers in question order
 * @returns {Promise<MatchResult>}
 */
export async function matchStudent(answers) {
  let summaries;
  try {
    summaries = await summariseAnswers(answers);
  } catch {
    // summariseAnswers has already logged the reason.
    return { status: 'summarise-failed', passToCoordinator: true };
  }

  // The mentors' vectors come ready-made from Firestore; only the student's phrases are embedded now.
  const [mentors, studentItems] = await Promise.all([loadApprovedMentors(), embedSummaries(summaries)]);
  const ranked = rankMentors(studentItems, mentors);
  return {
    status: 'ranked',
    passToCoordinator: needsCoordinator(ranked),
    ranked,
    mentorCount: mentors.length,
    studentSummaries: summaries
  };
}
