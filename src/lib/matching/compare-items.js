import { embed } from '#lib/matching/embed.js';
import { similarity } from '#lib/matching/similarity.js';

/**
 * Which side's items get matched:
 * - 'student': each student item is paired with its closest mentor item, and those scores are
 *   averaged. Asks "is everything the student wants covered by this mentor?", so a mentor's
 *   extra interests don't lower the score.
 * - 'both': the same is done from the mentor's side too, and the two averages are averaged.
 *   Also asks "does the student share the mentor's interests?", so extra mentor items the
 *   student doesn't share do lower the score.
 * @typedef {'student' | 'both'} Direction
 */

/**
 * Embeds each item on its own. Embedding a joined-up list averages every word into one vector,
 * so adding words ("every weekend") moves the vector even when the meaning hasn't changed.
 * @param {string[]} items
 * @returns {Promise<number[][]>}
 */
export function embedItems(items) {
  return Promise.all(items.map((item) => embed(item)));
}

/**
 * Embeds every item of every answer: one list of item vectors per question, in the same order as
 * the phrases, so the nth vector always goes with the nth phrase.
 * @param {string[][]} summaries one list of phrases per question (from summariseAnswers)
 * @returns {Promise<number[][][]>}
 */
export function embedSummaries(summaries) {
  return Promise.all(summaries.map((items) => embedItems(items)));
}

/**
 * For each vector in `from`, finds the most similar vector in `to`.
 * @param {number[][]} from
 * @param {number[][]} to must not be empty
 * @returns {{ index: number, score: number }[]} one entry per `from` vector: where its closest
 *   match is in `to`, and how similar they are
 */
export function bestMatches(from, to) {
  return from.map((vector) => {
    let best = { index: -1, score: -Infinity };
    to.forEach((other, index) => {
      const score = similarity(vector, other);
      if (score > best.score) best = { index, score };
    });
    return best;
  });
}

/**
 * The average of each `from` vector's best match in `to`. Averaging (rather than adding up) keeps
 * the score on the same scale however many items there are, so a one-item list isn't penalised.
 * @param {number[][]} from must not be empty
 * @param {number[][]} to must not be empty
 */
function averageBestMatch(from, to) {
  const matches = bestMatches(from, to);
  return matches.reduce((total, match) => total + match.score, 0) / matches.length;
}

/**
 * Scores a student's item vectors against a mentor's, item by item instead of as whole lists.
 * @param {number[][]} studentVectors one vector per student item (from embedItems)
 * @param {number[][]} mentorVectors one vector per mentor item
 * @param {Direction} direction see Direction above
 * @returns {number | null} null when either list is empty, as there's nothing to compare
 */
export function compareItems(studentVectors, mentorVectors, direction) {
  if (studentVectors.length === 0 || mentorVectors.length === 0) return null;
  const studentSide = averageBestMatch(studentVectors, mentorVectors);
  if (direction === 'student') return studentSide;
  return (studentSide + averageBestMatch(mentorVectors, studentVectors)) / 2;
}
