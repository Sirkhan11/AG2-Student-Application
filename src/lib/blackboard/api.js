import { currentUid, idToken } from '#lib/firebase/auth.js';
import { forgetOnDevice } from '#lib/blackboard/seen.js';

// The Blackboard section's calls to the app's own server (src/routes/api/blackboard). The browser
// never sees a Blackboard token or the app's secret: it sends the student's Firebase sign-in, and
// the server does the rest. Browser only.

/** @typedef {import('./shapes.js').BlackboardView} BlackboardView */

/**
 * What the section shows: the student's modules, or why there aren't any.
 * @returns {Promise<BlackboardView>}
 */
export async function loadBlackboard() {
  const token = await idToken();
  if (!token) return { connected: false, reason: 'not-connected' };
  try {
    const response = await fetch('/api/blackboard/modules', { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) return { connected: false, reason: 'not-connected' };
    return await response.json();
  } catch {
    return { connected: true, error: 'unavailable' };
  }
}

/** Starts connecting: the server answers with Blackboard's sign-in page, which this opens. */
export async function connectBlackboard() {
  const token = await idToken();
  if (!token) throw new Error('Not logged in');
  const response = await fetch('/api/blackboard/connect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Connecting answered ${response.status}`);
  const { url } = await response.json();
  window.location.assign(url);
}

/**
 * Disconnect: the server deletes its cookies (everything it holds), and this deletes what's kept on
 * the phone. Also used when logging out, so a shared computer keeps nothing.
 */
export async function disconnectBlackboard() {
  const uid = currentUid();
  if (uid) forgetOnDevice(uid);
  const response = await fetch('/api/blackboard/disconnect', { method: 'POST', keepalive: true });
  if (!response.ok) throw new Error(`Disconnecting answered ${response.status}`);
}
