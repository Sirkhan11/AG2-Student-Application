import { bestMatches } from '#lib/matching/compare-items.js';

// Turns a match into short reasons a student can read, such as "You share interests: gigs". No Firebase or
// Gemini here, so scripts/check-compare-items.mjs can test it in Node.
//
// Mentors' phrases are private (mentorDetails), so reasons only ever use the STUDENT's own phrases:
// the ones whose closest phrase on the mentor's side was very similar. That tells the student what
// they have in common without showing anything the mentor wrote. No scores are shown.

/**
 * How similar a student's phrase and the mentor's closest phrase must be before a reason names it.
 * Measured with MiniLM: "gigs" vs "gym" 0.25, "gigs" vs "live music" only 0.39, "partying" vs "going
 * clubbing" 0.58, and the same phrase 1. So 0.6 names near-identical phrases only. It can still name
 * an opposite, as "quiet nights in" vs "nights out" scores 0.71; Stage 3 of the matching fix deals
 * with opposites.
 * TODO(thresholds): check this on the 20 to 30 example test set along with the matching thresholds.
 */
export const REASON_MIN_SIMILARITY = 0.6;

/** At most this many reasons per match (firestore.rules allows the same number). */
export const MAX_REASONS = 3;

/** At most this many of the student's phrases in one reason, so it stays short. */
const MAX_PHRASES_PER_REASON = 2;

/**
 * How each question's reason is worded, in question order (see questions.js; mentors answer
 * question 1 as what they could help with, and question 6 as the kind of mentor they want to be).
 * Each is a label and then the phrases, because Gemini's phrases come in all shapes ("team",
 * "football match") and fitting them into a sentence read badly ("You both care about team").
 * @type {((phrases: string) => string)[]}
 */
const REASON_WORDING = [
  (phrases) => `They can help with what you need: ${phrases}`,
  (phrases) => `You share interests: ${phrases}`,
  (phrases) => `You like similar weekends: ${phrases}`,
  (phrases) => `You work in a similar way: ${phrases}`,
  (phrases) => `You care about similar things: ${phrases}`,
  (phrases) => `They're the kind of mentor you asked for: ${phrases}`
];

/** What each question is about, for the fallback reason, in question order. */
const QUESTION_TOPICS = [
  'what you’d like help with',
  'what you enjoy',
  'weekends',
  'how you like to work',
  'what matters to you at uni',
  'what you want from a mentor'
];

/**
 * Joins phrases into a list a person would write: "gigs", "gigs and live music".
 * @param {string[]} phrases one or two phrases
 */
function joinPhrases(phrases) {
  return phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`;
}

/**
 * Explains a match in words, from the student's own phrases that matched this mentor best.
 *
 * For each question, it finds the student's phrases whose closest mentor phrase is at least
 * REASON_MIN_SIMILARITY similar. The questions with the strongest such phrase come first, each
 * becomes one reason (up to 2 phrases), and a phrase already used isn't repeated. If no phrase is
 * similar enough, it falls back to naming the question whose answers matched best.
 * @param {string[][]} studentSummaries the student's phrases, one list per question
 * @param {number[][][]} studentItems the vectors of those phrases, in the same order
 * @param {number[][][]} mentorItems the mentor's item vectors, one list per question
 * @param {(number | null)[]} perQuestion this pair's score for each question (from rankMentors)
 * @returns {string[]} up to MAX_REASONS sentences; empty only if no question could be compared
 */
export function explainMatch(studentSummaries, studentItems, mentorItems, perQuestion) {
  /** @type {{ question: number, best: number, phrases: string[] }[]} */
  const candidates = [];
  studentItems.forEach((items, question) => {
    if (items.length === 0 || mentorItems[question].length === 0) return;
    const shared = bestMatches(items, mentorItems[question])
      .map((match, i) => ({ phrase: studentSummaries[question][i], score: match.score }))
      .filter((item) => item.score >= REASON_MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score);
    if (shared.length > 0) {
      candidates.push({ question, best: shared[0].score, phrases: shared.map((item) => item.phrase) });
    }
  });
  candidates.sort((a, b) => b.best - a.best);

  /** @type {string[]} */
  const reasons = [];
  const used = new Set();
  for (const { question, phrases } of candidates) {
    const fresh = phrases.filter((phrase) => !used.has(phrase.toLowerCase())).slice(0, MAX_PHRASES_PER_REASON);
    if (fresh.length === 0) continue;
    fresh.forEach((phrase) => used.add(phrase.toLowerCase()));
    reasons.push(REASON_WORDING[question](joinPhrases(fresh)));
    if (reasons.length === MAX_REASONS) break;
  }

  if (reasons.length === 0) {
    // Nothing similar enough to name, so say which question matched best, which is still true.
    let closest = -1;
    perQuestion.forEach((score, question) => {
      if (score !== null && (closest === -1 || score > /** @type {number} */ (perQuestion[closest]))) closest = question;
    });
    if (closest !== -1) reasons.push(`Your answers about ${QUESTION_TOPICS[closest]} were the closest match`);
  }
  return reasons;
}
