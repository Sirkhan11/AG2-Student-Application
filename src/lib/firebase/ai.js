import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { startAppCheck } from './app-check.js';
import { app } from './client.js';

/** @type {import('firebase/ai').AI | undefined} */
let ai;

/**
 * Starts App Check (app-check.js, shared with the app's function), then Firebase AI Logic, the first
 * time Gemini is needed.
 * The order matters: getAI() looks for App Check once, when it's first called. If App Check isn't
 * running by then, every Gemini request goes without a token and is refused, because App Check
 * is enforced for AI Logic.
 */
function getAIService() {
  if (typeof window === 'undefined') {
    throw new Error('Firebase AI Logic must run in the browser');
  }
  if (!ai) {
    startAppCheck();
    // GoogleAIBackend means the Gemini Developer API (on the paid tier with prepaid credit since
    // November 2026), not the Agent Platform one. A 402 means the credit has run out: see ai-errors.js.
    ai = getAI(app, { backend: new GoogleAIBackend() });
  }
  return ai;
}

/**
 * Creates a Gemini model with the given settings (model name, instructions, output format).
 * @param {import('firebase/ai').ModelParams} params
 */
export function getGeminiModel(params) {
  return getGenerativeModel(getAIService(), params);
}
