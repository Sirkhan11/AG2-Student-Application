import { BlackboardError } from './client.js';
import { challengeFor, newState, newVerifier, seal, unseal } from './crypto.js';
import { readModules } from './read.js';

// Connecting to Blackboard, reading it, and disconnecting, apart from SvelteKit (the routes in
// src/routes/api/blackboard and src/routes/blackboard/callback call these), so check-blackboard.mjs
// can run the whole flow against the mock. Server only.
//
// Two cookies, both sealed (crypto.js) and httpOnly, so the browser can't read or change them:
// - FLOW_COOKIE, for the 10 minutes of signing in: the state and PKCE verifier, and which app user
//   started it. Sent only to the callback.
// - SESSION_COOKIE: the tokens, the Learn user id, and which app user they belong to. Sent only to
//   /api/blackboard. Nothing is stored anywhere else, so Disconnect (deleting both) deletes it all.

export const FLOW_COOKIE = 'ag2_bb_flow';
export const SESSION_COOKIE = 'ag2_bb';
export const FLOW_PATH = '/blackboard/callback';
export const SESSION_PATH = '/api/blackboard';
export const FLOW_MAX_AGE = 10 * 60;
/** A term and a bit. The refresh token keeps it working; when it stops, the student reconnects. */
export const SESSION_MAX_AGE = 120 * 24 * 60 * 60;

/** Where the student lands back on the checklist, saying how connecting went. @param {string} outcome */
const backToChecklist = (outcome) => `/checklist?blackboard=${outcome}#blackboard`;

/**
 * What Northumbria's Blackboard answers until IT register AG2 there (seen November 2026). Matched
 * exactly, so only this answer gets its own message ("not-registered"); Blackboard's own words are
 * never shown to the student.
 */
export const NOT_REGISTERED = { error: 'invalid_request', description: 'Application not registered with site' };

/**
 * True for Blackboard's "this app isn't registered" answer, and nothing else.
 * @param {{ error: string | null, errorDescription?: string | null }} query
 */
export const isNotRegistered = (query) =>
  query.error === NOT_REGISTERED.error && query.errorDescription?.trim() === NOT_REGISTERED.description;

/**
 * Starts connecting: where to send the student to sign in to Blackboard, and the sealed flow cookie.
 * @param {{ cookieKey: Buffer, client: import('./client.js').BlackboardClient, uid: string, origin: string, now?: number }} options
 */
export function startConnect({ cookieKey, client, uid, origin, now = Date.now() }) {
  const state = newState();
  const verifier = newVerifier();
  return {
    url: client.authoriseUrl({ redirectUri: `${origin}${FLOW_PATH}`, state, codeChallenge: challengeFor(verifier) }),
    flow: seal({ v: 1, state, verifier, uid, at: now }, cookieKey)
  };
}

/**
 * Finishes connecting, from Blackboard's callback: checks the state against the flow cookie, then
 * swaps the code for tokens (server to server, with the secret and PKCE verifier).
 * @param {{ cookieKey: Buffer, client: import('./client.js').BlackboardClient,
 *   query: { code: string | null, state: string | null, error: string | null, errorDescription?: string | null },
 *   flowCookie: string | undefined, origin: string, now?: number }} options
 * @returns {Promise<{ redirect: string, session?: string }>}
 */
export async function finishConnect({ cookieKey, client, query, flowCookie, origin, now = Date.now() }) {
  // Blackboard turning AG2 away because IT haven't registered it yet. Checked before the state, as
  // Blackboard may not send the state back with it; nothing is connected either way, so a forged one
  // could only show this message.
  if (isNotRegistered(query)) return { redirect: backToChecklist('not-registered') };
  const flow = unseal(flowCookie, cookieKey);
  if (!flow || !query.state || flow.state !== query.state || now - flow.at > FLOW_MAX_AGE * 1000) return { redirect: backToChecklist('failed') };
  if (query.error) return { redirect: backToChecklist(query.error === 'access_denied' ? 'denied' : 'failed') };
  if (!query.code) return { redirect: backToChecklist('failed') };
  try {
    const tokens = await client.exchangeCode({ code: query.code, redirectUri: `${origin}${FLOW_PATH}`, verifier: flow.verifier });
    if (!tokens.userId) return { redirect: backToChecklist('failed') };
    return {
      redirect: backToChecklist('connected'),
      session: seal({ v: 1, uid: flow.uid, user: tokens.userId, access: tokens.accessToken, refresh: tokens.refreshToken, expires: tokens.expiresAt }, cookieKey)
    };
  } catch (err) {
    return { redirect: backToChecklist(err instanceof BlackboardError && err.kind === 'unavailable' ? 'unavailable' : 'failed') };
  }
}

/**
 * What the Blackboard section shows for this app user, refreshing the access token when it's run out
 * (or Blackboard says it's no good). session in the result says what to do with the cookie:
 * undefined to leave it, null to delete it, or a new sealed value to set.
 * @param {{ cookieKey: Buffer, client: import('./client.js').BlackboardClient, sessionCookie: string | undefined, uid: string, origin: string,
 *   links: { linkHost: string, apiHost: string }, mock: boolean, now?: number }} options
 * @returns {Promise<{ view: import('#lib/blackboard/shapes.js').BlackboardView, session?: string | null, status?: number }>}
 */
export async function readView({ cookieKey, client, sessionCookie, uid, origin, links, mock, now = Date.now() }) {
  const session = unseal(sessionCookie, cookieKey);
  if (!session) return { view: { connected: false, reason: 'not-connected' }, session: sessionCookie ? null : undefined };
  // Someone else's connection on this browser (a shared computer): never shown, and forgotten.
  if (session.uid !== uid) return { view: { connected: false, reason: 'not-connected' }, session: null };

  let current = session;
  let changed = false;
  const refresh = async () => {
    if (!current.refresh) throw new BlackboardError('refused', 'There is no refresh token');
    const tokens = await client.refresh({ refreshToken: current.refresh, redirectUri: `${origin}${FLOW_PATH}` });
    current = { ...current, access: tokens.accessToken, refresh: tokens.refreshToken ?? current.refresh, expires: tokens.expiresAt };
    changed = true;
  };
  const read = () => readModules(client, current.access, current.user, { now, ...links });

  try {
    if (current.expires - 60_000 <= now) await refresh();
    let modules;
    try {
      modules = await read();
    } catch (err) {
      if (!(err instanceof BlackboardError) || err.kind !== 'expired') throw err;
      await refresh();
      modules = await read();
    }
    return { view: { connected: true, modules, readAt: new Date(now).toISOString(), mock }, session: changed ? seal(current, cookieKey) : undefined };
  } catch (err) {
    if (err instanceof BlackboardError && (err.kind === 'refused' || err.kind === 'expired')) {
      return { view: { connected: false, reason: 'reconnect' }, session: null };
    }
    console.error('Blackboard could not be read:', err instanceof Error ? err.message : err);
    return { view: { connected: true, error: 'unavailable' }, session: changed ? seal(current, cookieKey) : undefined, status: 503 };
  }
}
