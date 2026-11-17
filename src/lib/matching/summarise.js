import { getGeminiModel } from '#lib/firebase/ai.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import {
  cleanAnswers,
  emptySummary,
  INSTRUCTIONS,
  MAX_WANTS,
  MODEL_NAME,
  readReply,
  requestText,
  responseSchema
} from '#lib/matching/summary-prompt.js';

// The instructions, reply shape and so on live in summary-prompt.js, which the test fixtures use too.
export { MAX_WANTS };

/** @typedef {import('#lib/matching/summary-prompt.js').Summary} Summary */
/** @typedef {import('#lib/matching/summary-prompt.js').Styles} Styles */

/** Error code for when Gemini couldn't summarise the answers. Pages check err.code, as with Firebase errors. */
export const SUMMARISE_FAILED = 'matching/summarise-failed';

/**
 * One model per number of answers, because the reply's shape names one key per answer.
 * Only two are ever made: 6 answers (sign-up and matching) and 1 (the matching test page).
 * @type {Map<number, import('firebase/ai').GenerativeModel>}
 */
const models = new Map();

/**
 * Creates the model for this many answers the first time it's needed (Gemini can only run in the browser).
 * @param {number} count
 */
function getModel(count) {
  let model = models.get(count);
  if (!model) {
    model = getGeminiModel({
      model: MODEL_NAME,
      systemInstruction: INSTRUCTIONS,
      generationConfig: {
        // No temperature setting: the SDK says Gemini 3.x ignores it, and in testing the same answers
        // could still come back slightly different. Consistency comes from saving each mentor's
        // summaries once at sign-up instead, so their matching data never changes afterwards.
        responseMimeType: 'application/json',
        responseSchema: responseSchema(count)
      }
    });
    models.set(count, model);
  }
  return model;
}

/**
 * Asks Gemini, in ONE request, to summarise someone's answers: for each answer, what they like
 * (interests, activities and needs) and what they avoid, plus three styles from all the answers
 * together (going out or staying in, planning ahead or last minute, on their own or with others).
 *
 * Only likes are embedded and compared item by item (see compare-items.js), so things someone
 * rejected ("I'm not into sport") never count towards a match, and nor does how much they happened
 * to write. Styles are never embedded.
 *
 * One request rather than one per answer: on the free tier that meant 15 sign-ups or matches a
 * minute instead of 2 or 3, and on the paid tier every request uses credit.
 *
 * All or nothing: if the request fails or the reply is broken, it throws an error with code
 * SUMMARISE_FAILED instead of returning part of a summary. Its outOfCredit is true when Gemini's
 * prepaid credit has run out (HTTP 402), so pages say matching isn't available rather than "try again".
 *
 * Only the answers are sent, never a name or profile, and anything that looks like an email
 * address is replaced with [email] first.
 * @param {string[]} answers
 * @returns {Promise<Summary>} likes and avoids have one list per answer, in the same order; an
 *   answer's likes are empty when it only says what they don't want (or is blank)
 */
export async function summariseAnswers(answers) {
  const texts = cleanAnswers(answers);
  // Nothing to summarise, so don't use up a request.
  if (texts.every((text) => text === '')) return emptySummary(texts.length);

  try {
    const result = await getModel(texts.length).generateContent(requestText(texts));
    return readReply(result.response.text(), texts.length);
  } catch (err) {
    console.error('Gemini could not summarise the answers:', err);
    throw Object.assign(new Error('Gemini could not summarise the answers.', { cause: err }), {
      code: SUMMARISE_FAILED,
      outOfCredit: isOutOfCredit(err)
    });
  }
}

/**
 * Summarises a single answer, for the matching test page: its likes and avoids, and any styles it
 * states. It's a one-answer summariseAnswers, so it uses exactly the same instructions and settings
 * as sign-up and matching.
 * @param {string} answer
 * @returns {Promise<{ likes: string[], avoids: string[], styles: Styles }>}
 */
export async function summariseAnswer(answer) {
  const summary = await summariseAnswers([answer]);
  return { likes: summary.likes[0], avoids: summary.avoids[0], styles: summary.styles };
}
