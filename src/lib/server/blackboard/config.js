import { randomBytes } from 'node:crypto';

// Turns the Blackboard settings from .env.local into what the server needs, and says what's missing.
// No SvelteKit imports, so check-blackboard.mjs can use it in Node (settings.js reads the real values).

/** Northumbria's Blackboard (Learn 4001.4.0 on 17 November 2026). */
export const NORTHUMBRIA_HOST = 'https://elp.northumbria.ac.uk';

/** A cookie key for the mock when none is set, made once per server start. */
let mockCookieKey = /** @type {Buffer | null} */ (null);

/**
 * @typedef {{ mode: 'mock' | 'live', host: string, appKey: string, appSecret: string, cookieKey: Buffer | null,
 *   ready: boolean, problem: string | null }} BlackboardSettings
 */

/**
 * - mode "mock": the app's pretend Blackboard, with made-up modules. Needs nothing else; without a
 *   BLACKBOARD_COOKIE_KEY it makes a key when the server starts (connections end when it restarts).
 * - mode "live": BLACKBOARD_HOST is an https address, and the app key, secret and cookie key are set.
 * @param {{ host: string, appKey: string, appSecret: string, cookieKey: string }} raw
 * @returns {BlackboardSettings}
 */
export function blackboardSettings(raw) {
  const mode = raw.host === 'mock' ? 'mock' : 'live';
  let cookieKey = null;
  if (raw.cookieKey) {
    const decoded = Buffer.from(raw.cookieKey, 'base64');
    if (decoded.length === 32) cookieKey = decoded;
  } else if (mode === 'mock') {
    mockCookieKey ??= randomBytes(32);
    cookieKey = mockCookieKey;
  }

  let problem = null;
  if (!cookieKey) problem = 'BLACKBOARD_COOKIE_KEY must be 32 random bytes in base64';
  else if (mode === 'live' && !/^https:\/\/[^/]+$/.test(raw.host)) problem = 'BLACKBOARD_HOST must be "mock" or an https address with no path';
  else if (mode === 'live' && (!raw.appKey || !raw.appSecret)) problem = 'BLACKBOARD_APP_KEY and BLACKBOARD_APP_SECRET are needed for the real Blackboard';

  return { mode, host: raw.host, appKey: raw.appKey, appSecret: raw.appSecret, cookieKey, ready: problem === null, problem };
}
