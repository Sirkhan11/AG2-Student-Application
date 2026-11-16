import { embed } from './embed.js';
import { similarity } from './similarity.js';

/**
 * Embeds each answer separately, so answers can be compared question by question.
 * @param {string[]} answers
 * @returns {Promise<number[][]>}
 */
export function embedAnswers(answers) {
  return Promise.all(answers.map((answer) => embed(answer)));
}

/**
 * Scores a student against every mentor and returns the mentors best first.
 * A mentor's score is the average of the six question-by-question similarities.
 * @param {number[][]} studentVectors
 * @param {{ id: string, name: string, vectors: number[][] }[]} mentors
 */
export function rankMentors(studentVectors, mentors) {
  return mentors
    .map((mentor) => {
      const perQuestion = studentVectors.map((vector, i) => similarity(vector, mentor.vectors[i]));
      const score = perQuestion.reduce((total, s) => total + s, 0) / perQuestion.length;
      return { id: mentor.id, name: mentor.name, score, perQuestion };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * True when the match is too weak or too close to call, so a person should check it.
 * The default thresholds are starting guesses, to be tuned with test data.
 * @param {{ score: number }[]} ranked
 */
export function needsCoordinator(ranked, minScore = 0.3, minGap = 0.05) {
  if (ranked.length === 0) return true;
  const [first, second] = ranked;
  if (first.score < minScore) return true;
  return second !== undefined && first.score - second.score < minGap;
}