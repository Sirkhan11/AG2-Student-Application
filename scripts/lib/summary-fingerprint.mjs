// A short fingerprint of everything that decides what Gemini is asked when summarising: the model,
// the instructions and the reply shape. Saved fixtures record it, so a check can tell when they were
// made with an older prompt and need making again. Node only (it uses node:crypto).
import { createHash } from 'node:crypto';
import { INSTRUCTIONS, MODEL_NAME, responseSchema } from '#lib/matching/summary-prompt.js';

export const SUMMARY_FINGERPRINT = createHash('sha256')
  .update(`${MODEL_NAME}\n${INSTRUCTIONS}\n${JSON.stringify(responseSchema(6))}`)
  .digest('hex')
  .slice(0, 12);
