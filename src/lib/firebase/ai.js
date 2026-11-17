import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { app } from './client.js';

/** @type {import('firebase/ai').AI | undefined} */
let ai;

/**
 * Starts App Check, then Firebase AI Logic, the first time Gemini is needed.
 * The order matters: getAI() looks for App Check once, when it's first called. If App Check isn't
 * running by then, every Gemini request goes without a token and is refused, because App Check
 * is enforced for AI Logic.
 */
function getAIService() {
  if (typeof window === 'undefined') {
    throw new Error('Firebase AI Logic must run in the browser');
  }
  if (!ai) {
    // On localhost, a debug token stands in for reCAPTCHA (localhost must never be an allowed
    // reCAPTCHA domain). It comes from .env.development.local, which git ignores and only
    // `vite dev` reads, and the DEV check keeps it out of production builds too.
    const debugToken = import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined;
    if (debugToken) {
      /** @type {any} */ (self).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }

    // The reCAPTCHA site key isn't secret: it's sent to every visitor's browser anyway.
    const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      throw new Error("VITE_RECAPTCHA_SITE_KEY is missing from .env, so App Check can't start.");
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      // Without this, App Check tokens aren't refreshed when they expire.
      isTokenAutoRefreshEnabled: true
    });
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
