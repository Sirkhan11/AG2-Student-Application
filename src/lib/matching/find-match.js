import { SUMMARISE_FAILED, summariseAnswers } from '#lib/matching/summarise.js';
import { embedSummaries } from '#lib/matching/compare-items.js';
import { hasMentorProfile, loadApprovedMentors } from '#lib/matching/mentors.js';
import { coordinatorReason, rankMentors } from '#lib/matching/match.js';
import { explainMatch } from '#lib/matching/explain.js';
import { keepMatchingSummary, loadMyMatch, passToCoordinator, takePlace } from '#lib/matching/matches.js';

/** @typedef {import('#lib/matching/matches.js').Match} Match */
/** @typedef {import('#lib/matching/matches.js').MeetingPreferences} MeetingPreferences */

/**
 * Why a student was passed to the coordinator, in words, saved with their request for the coordinator
 * to read in the console. 'mentor-full' and 'gemini-unavailable' come from saving, not from ranking.
 * @type {Record<string, string>}
 */
const REASON_TEXT = {
  'nothing-to-compare': 'None of their answers could be compared with any mentor.',
  'weak-match': 'Their best match was too weak to use.',
  'too-few-questions': 'Their best match could only be compared on a few questions.',
  'near-tie': 'Their top two mentors were too close to call.',
  'mentor-full': 'Their best mentors filled up while they were being matched.',
  'gemini-unavailable': 'Gemini could not summarise their answers, so they asked to be matched by hand.'
};

/**
 * A student's answers, ready to match: Gemini's summary, and the vectors of its likes. It's made once,
 * so matching can be tried again (for example after a mentor fills up) without another Gemini request.
 * @typedef {{ answers: string[], summary: import('#lib/matching/summary-prompt.js').Summary,
 *   itemVectors: number[][][] }} PreparedStudent
 */

/**
 * Summarises the answers with Gemini (one request) and embeds each liked phrase.
 * Throws an error with code SUMMARISE_FAILED if Gemini fails; other errors (such as the embedding model
 * failing to download) are thrown as they are.
 * @param {string[]} answers in question order
 * @returns {Promise<PreparedStudent>}
 */
export async function prepareStudent(answers) {
  const summary = await summariseAnswers(answers);
  const itemVectors = await embedSummaries(summary.likes);
  return { answers, summary, itemVectors };
}

/**
 * Loads the approved mentors with a free place and ranks them for this student. Needs a signed-in user.
 * @param {PreparedStudent} prepared
 */
export async function rankForStudent(prepared) {
  const mentors = await loadApprovedMentors();
  const ranked = rankMentors(prepared.itemVectors, mentors);
  return { mentors, ranked, reason: coordinatorReason(ranked) };
}

/**
 * What /find-mentor should show when it opens, for a signed-in user:
 * - 'is-mentor': they have a mentor profile, so this student page isn't for them
 * - 'has-record': they already have a match record (one per student, and it can't be changed)
 * - 'no-mentors': no approved mentor has a free place, so there's no point asking the questions yet
 * - 'form': ready to ask the questions
 * @returns {Promise<{ view: 'is-mentor' | 'no-mentors' | 'form' } | { view: 'has-record', match: Match }>}
 */
export async function checkBeforeMatching() {
  const [isMentor, match] = await Promise.all([hasMentorProfile(), loadMyMatch()]);
  if (isMentor) return { view: 'is-mentor' };
  if (match) return { view: 'has-record', match };
  const mentors = await loadApprovedMentors();
  return { view: mentors.length === 0 ? 'no-mentors' : 'form' };
}

/**
 * What happened when matching and saving:
 * - 'matched': the student took one of mentorName's places; reasons are what the page shows
 * - 'coordinator': saved as waiting for the coordinator
 * - 'no-mentors': no approved mentor has a free place; nothing was saved
 * - 'already-saved': they already had a match record (for example from an earlier try), so that's shown
 * @typedef {{ outcome: 'matched', mentorName: string, reasons: string[] } | { outcome: 'coordinator' }
 *   | { outcome: 'no-mentors' } | { outcome: 'already-saved', match: Match }} SaveOutcome
 */

/**
 * Saves the student as waiting for the coordinator, with what the coordinator needs to match them by hand.
 * @param {string[]} answers
 * @param {import('#lib/matching/summary-prompt.js').Summary | null} summary null if Gemini couldn't make one
 * @param {MeetingPreferences} preferences
 * @param {string} reason a CoordinatorReason, 'mentor-full' or 'gemini-unavailable'
 * @returns {Promise<SaveOutcome>}
 */
async function requestCoordinator(answers, summary, preferences, reason) {
  await passToCoordinator(preferences, { answers, summary, reason, reasonText: REASON_TEXT[reason] ?? reason });
  return { outcome: 'coordinator' };
}

/**
 * Ranks the mentors for a prepared student and saves the result: a place with their top mentor if the
 * match is good enough (see coordinatorReason), otherwise a request for the coordinator.
 *
 * If taking the place is refused (most likely the mentor filled up after the mentors were loaded), the
 * mentors are loaded and ranked again once, with the same phrases and vectors, so no new Gemini request.
 * If that's refused too, the student is passed to the coordinator. Any other error is thrown, so the page
 * can offer Try again.
 * @param {PreparedStudent} prepared
 * @param {MeetingPreferences} preferences
 * @returns {Promise<SaveOutcome>}
 */
export async function matchAndSave(prepared, preferences) {
  // A record can only be made once. If one exists (say an earlier try saved, but the connection dropped
  // before the page heard back), show it instead of failing.
  const existing = await loadMyMatch();
  if (existing) return { outcome: 'already-saved', match: existing };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { mentors, ranked, reason } = await rankForStudent(prepared);
    if (reason === 'no-mentors') return { outcome: 'no-mentors' };
    if (reason !== null) return requestCoordinator(prepared.answers, prepared.summary, preferences, reason);

    const top = ranked[0];
    const mentor = /** @type {import('#lib/matching/match.js').MatchableMentor} */ (mentors.find((m) => m.id === top.id));
    const reasons = explainMatch(prepared.summary.likes, prepared.itemVectors, mentor.itemVectors, top.perQuestion);
    try {
      await takePlace({ id: top.id, name: top.name }, reasons, preferences);
      // For the check-in chat (see about-you.js). The match is saved whatever happens to this.
      await keepMatchingSummary(prepared.summary).catch((err) => console.error('Keeping the matching summary failed:', err?.code ?? err));
      return { outcome: 'matched', mentorName: top.name, reasons };
    } catch (err) {
      if (/** @type {{ code?: string }} */ (err).code !== 'permission-denied') throw err;
      console.warn(`Taking a place with mentor ${top.id} was refused (attempt ${attempt}); they may have filled up.`);
    }
  }
  return requestCoordinator(prepared.answers, prepared.summary, preferences, 'mentor-full');
}

/**
 * For when Gemini is down and the student chooses to be matched by hand: saves them as waiting for the
 * coordinator, with their answers but no phrases.
 * @param {string[]} answers
 * @param {MeetingPreferences} preferences
 * @returns {Promise<SaveOutcome>}
 */
export async function askCoordinator(answers, preferences) {
  const existing = await loadMyMatch();
  if (existing) return { outcome: 'already-saved', match: existing };
  return requestCoordinator(answers, null, preferences, 'gemini-unavailable');
}

/**
 * What matching a student gives back on /matching-demo (which shows scores and saves nothing):
 * - 'summarise-failed': Gemini couldn't summarise the answers, so a person should match this student
 * - 'ranked': mentors best first; passToCoordinator says whether the top match is good enough to use
 * @typedef {{ status: 'summarise-failed', passToCoordinator: true }
 *   | { status: 'ranked', passToCoordinator: boolean,
 *       ranked: import('#lib/matching/match.js').RankedMentor[],
 *       mentorCount: number, studentSummary: import('#lib/matching/summary-prompt.js').Summary }} MatchResult
 */

/**
 * Matches a student's answers against the approved mentors with a free place, without saving anything.
 * Used by /matching-demo. If Gemini fails, it doesn't fall back to the raw answers (that would bring
 * back the problems the summaries fix); other failures are thrown.
 * @param {string[]} answers in question order
 * @returns {Promise<MatchResult>}
 */
export async function matchStudent(answers) {
  let prepared;
  try {
    prepared = await prepareStudent(answers);
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code === SUMMARISE_FAILED) {
      return { status: 'summarise-failed', passToCoordinator: true };
    }
    throw err;
  }
  const { mentors, ranked, reason } = await rankForStudent(prepared);
  return {
    status: 'ranked',
    passToCoordinator: reason !== null,
    ranked,
    mentorCount: mentors.length,
    studentSummary: prepared.summary
  };
}
