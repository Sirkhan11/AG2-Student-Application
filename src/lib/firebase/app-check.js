import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { app, EMULATORS } from './client.js';

// App Check, started once for everything in the app that Google checks it for: Gemini through
// Firebase AI Logic (ai.js) and the app's own function (deadlines/read.js). It has to be one place:
// Firebase allows one App Check per app, and whichever of the two is used first must start it the
// same way. In the browser only.

/** @type {import('firebase/app-check').AppCheck | undefined} */
let appCheck;

/**
 * Starts App Check the first time it's needed and returns it. Firebase's SDKs then put its token on
 * every request to Gemini and to the function, which refuse requests without one.
 */
export function startAppCheck() {
  if (typeof window === 'undefined') throw new Error('App Check must run in the browser');
  if (appCheck) return appCheck;

  if (EMULATORS) {
    // Against the emulators (the browser checks) there's no App Check service to get a token from. The
    // functions emulator reads the token without checking who signed it, so a pretend one made here
    // stands in, and the function's "App Check or nothing" rule can still be tested. EMULATORS is false
    // in every build, so none of this is in the live site.
    appCheck = initializeAppCheck(app, {
      provider: new CustomProvider({ getToken: async () => ({ token: pretendToken(), expireTimeMillis: Date.now() + 3_600_000 }) }),
      isTokenAutoRefreshEnabled: false
    });
    return appCheck;
  }

  // On localhost, a debug token stands in for reCAPTCHA (localhost must never be an allowed reCAPTCHA
  // domain). It comes from .env.development.local, which git ignores and only `vite dev` reads.
  // import.meta.env.DEV is false in every build, so a build drops this whole block, token and all
  // (check-live-build.mjs checks the live site's files for it).
  if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
    /** @type {any} */ (self).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  }

  // The reCAPTCHA site key isn't secret: it's sent to every visitor's browser anyway.
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    throw new Error("VITE_RECAPTCHA_SITE_KEY is missing from .env, so App Check can't start.");
  }
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    // Without this, App Check tokens aren't refreshed when they expire.
    isTokenAutoRefreshEnabled: true
  });
  return appCheck;
}

/** A token shaped like App Check's (three base64url parts), for the emulator only. */
function pretendToken() {
  const part = (/** @type {object} */ value) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'demo-ag2-app', aud: ['projects/demo-ag2'], iss: 'https://firebaseappcheck.googleapis.com/demo-ag2', iat: now, exp: now + 3600 })}.pretend`;
}
