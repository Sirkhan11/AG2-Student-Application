import { blackboardClient } from './client.js';
import { MOCK_APP_KEY, MOCK_APP_SECRET, MOCK_HOST, mockFetch } from './mock.js';
import { FIREBASE_PROJECT_ID, settings } from './settings.js';
import { bearerToken, verifyFirebaseIdToken } from '../firebase-token.js';

// What the Blackboard routes share: the client for this server's settings (the mock or Northumbria's
// Blackboard), where links should point, and the signed-in app user. Server only.

/**
 * The Learn client: the mock answers inside the server (its pretend sign-in page is in this app),
 * the real one is BLACKBOARD_HOST.
 * @param {string} origin this app's origin, such as http://localhost:5173
 */
export function clientFor(origin) {
  if (settings.mode === 'mock') {
    return blackboardClient({ host: MOCK_HOST, browserHost: `${origin}/blackboard/mock`, appKey: MOCK_APP_KEY, appSecret: MOCK_APP_SECRET, fetch: mockFetch });
  }
  return blackboardClient({ host: settings.host, appKey: settings.appKey, appSecret: settings.appSecret });
}

/** Where links to Blackboard should point (the pretend pages for the mock). @param {string} origin */
export const linksFor = (origin) =>
  settings.mode === 'mock' ? { linkHost: `${origin}/blackboard/mock`, apiHost: MOCK_HOST } : { linkHost: settings.host, apiHost: settings.host };

/**
 * The app user signed in on this request (their Firebase ID token, checked), or null.
 * @param {Request} request
 */
export async function signedInUser(request) {
  try {
    return await verifyFirebaseIdToken(bearerToken(request), { projectId: FIREBASE_PROJECT_ID });
  } catch {
    return null;
  }
}

/**
 * True if a request that changes something came from this app's own pages (against cross-site
 * requests; SvelteKit itself only checks form posts).
 * @param {Request} request
 * @param {URL} url
 */
export const fromThisApp = (request, url) => request.headers.get('origin') === url.origin;

export { settings };
