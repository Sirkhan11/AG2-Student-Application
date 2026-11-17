import { verify } from 'node:crypto';

// Checks a Firebase ID token on the server, the way Firebase documents it for servers that don't use
// the Admin SDK: signed (RS256) by one of Google's public "securetoken" keys, for our project, from
// Firebase, about a real user, and not expired. No service account key is needed, as the keys are
// public. Server only.

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
/** How far a token's times may be ahead of this server's clock. */
const CLOCK_SKEW_SECONDS = 300;

/** @type {{ certs: Record<string, string> | null, until: number }} */
const cache = { certs: null, until: 0 };

/**
 * Google's current public keys by key id, cached for as long as Google says (Cache-Control max-age).
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Record<string, string>>}
 */
export async function googleCerts(fetchImpl = fetch) {
  if (cache.certs && Date.now() < cache.until) return cache.certs;
  const response = await fetchImpl(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Google's keys answered ${response.status}`);
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
  cache.certs = await response.json();
  cache.until = Date.now() + maxAge * 1000;
  return /** @type {Record<string, string>} */ (cache.certs);
}

/** @param {string} part */
const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * The user's id if the ID token is good; otherwise it throws, saying why.
 * @param {string | null | undefined} token
 * @param {{ projectId: string | undefined, certs?: () => Promise<Record<string, string>>, now?: number }} options
 * @returns {Promise<{ uid: string }>}
 */
export async function verifyFirebaseIdToken(token, { projectId, certs = googleCerts, now = Date.now() }) {
  if (!projectId) throw new Error('No Firebase project is set');
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) throw new Error('Not a token');
  let header;
  let payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new Error('Not a token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Wrong kind of token');
  const pem = (await certs())[header.kid];
  if (!pem) throw new Error('Unknown signing key');
  const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), pem, Buffer.from(parts[2], 'base64url'));
  if (!signed) throw new Error('Bad signature');

  const seconds = Math.floor(now / 1000);
  if (payload.aud !== projectId) throw new Error('Token for another project');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Token from somewhere else');
  if (typeof payload.sub !== 'string' || payload.sub === '' || payload.sub.length > 128) throw new Error('No user in the token');
  if (typeof payload.exp !== 'number' || payload.exp <= seconds) throw new Error('Token has expired');
  if (typeof payload.iat !== 'number' || payload.iat > seconds + CLOCK_SKEW_SECONDS) throw new Error('Token issued in the future');
  if (typeof payload.auth_time !== 'number' || payload.auth_time > seconds + CLOCK_SKEW_SECONDS) throw new Error('Signed in in the future');
  return { uid: payload.sub };
}

/**
 * The bearer token from a request's Authorization header, or null.
 * @param {Request} request
 */
export const bearerToken = (request) => request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1] ?? null;
