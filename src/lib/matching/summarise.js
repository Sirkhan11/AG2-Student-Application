import { getGeminiModel } from '#lib/firebase/ai.js';
import {
  cleanAnswers,
  INSTRUCTIONS,
  MAX_WANTS,
  MODEL_NAME,
  readReply,
  requestText,
  responseSchema
} from '#lib/matching/summary-prompt.js';

// The instructions, reply shape and so on live in summary-prompt.js, which the test fixtures use too.
export { MAX_WANTS };

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
 * Asks Gemini, in ONE request, for a short list of the interests, activities and needs in each of
 * someone's answers, leaving out anything they said they don't want. Comparing these items
 * (see compare-items.js) instead of the raw answers stops MiniLM matching people on things they
 * rejected ("I'm not into sport" vs a sporty mentor), and on how much they happened to write.
 *
 * One request rather than one per answer because the free tier allows 15 requests a minute:
 * that's 15 sign-ups or matches a minute, instead of 2 or 3.
 *
 * All or nothing: if the request fails or the reply is broken, it throws an error with code
 * SUMMARISE_FAILED instead of returning some of the lists.
 *
 * Only the answers are sent, never a name or profile, and anything that looks like an email
 * address is replaced with [email] first.
 * @param {string[]} answers
 * @returns {Promise<string[][]>} one list of phrases per answer, in the same order; a list is empty
 *   when that answer only says what they don't want (or is blank)
 */
export async function summariseAnswers(answers) {
  const texts = cleanAnswers(answers);
  // Nothing to summarise, so don't use up a request.
  if (texts.every((text) => text === '')) return texts.map(() => []);

  try {
    const result = await getModel(texts.length).generateContent(requestText(texts));
    return readReply(result.response.text(), texts.length);
  } catch (err) {
    console.error('Gemini could not summarise the answers:', err);
    throw Object.assign(new Error('Gemini could not summarise the answers.', { cause: err }), {
      code: SUMMARISE_FAILED
    });
  }
}

/**
 * Summarises a single answer, for the matching test page. It's a one-answer summariseAnswers,
 * so it uses exactly the same instructions and settings as sign-up and matching.
 * @param {string} answer
 * @returns {Promise<string[]>}
 */
export async function summariseWants(answer) {
  const [phrases] = await summariseAnswers([answer]);
  return phrases;
}
