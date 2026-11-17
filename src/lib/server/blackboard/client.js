// Talks to Blackboard Learn's REST API as the student, with three-legged OAuth and PKCE. Paths and
// versions are from the API reference for Learn 4001.4.0, which elp.northumbria.ac.uk runs. Server
// only: the app secret and the tokens never leave the server.
//
// The fetch it uses is passed in: the real one for Northumbria's Blackboard, mockFetch (mock.js) for
// the pretend one, so the code is the same for both and switching is only a setting.

/** Read access, plus offline, which Learn needs to give a refresh token. Nothing that can change anything. */
export const SCOPE = 'read offline';
const BASE = '/learn/api/public';

/** Why a Blackboard request didn't work. Its message never holds a token or the secret. */
export class BlackboardError extends Error {
  /**
   * @param {'expired' | 'refused' | 'forbidden' | 'not-found' | 'unavailable'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * @typedef {{ accessToken: string, refreshToken: string | null, expiresAt: number, userId: string | null }} Tokens
 */

/**
 * @param {{ host: string, browserHost?: string, appKey: string, appSecret: string, fetch?: typeof fetch,
 *   timeoutMs?: number, maxPages?: number }} options host is where the server calls; browserHost is
 *   where the student signs in (the same, apart from the mock)
 */
export function blackboardClient({ host, browserHost = host, appKey, appSecret, fetch: fetchImpl = fetch, timeoutMs = 10_000, maxPages = 10 }) {
  const basic = `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`;

  /** @param {string} url @param {RequestInit} init */
  async function call(url, init) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new BlackboardError('unavailable', `Blackboard didn't answer (${/** @type {Error} */ (err).name})`);
    }
  }

  /**
   * The token endpoint, as Learn documents it: the code (or refresh token) and redirect address in
   * the query, the grant type in a form body, and the app key and secret as Basic authentication.
   * @param {Record<string, string>} query
   * @param {'authorization_code' | 'refresh_token'} grant
   * @returns {Promise<Tokens>}
   */
  async function token(query, grant) {
    const response = await call(`${host}${BASE}/v1/oauth2/token?${new URLSearchParams(query)}`, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: grant }).toString()
    });
    if (response.status >= 500) throw new BlackboardError('unavailable', `Blackboard's token endpoint answered ${response.status}`);
    if (!response.ok) throw new BlackboardError('refused', `Blackboard refused the ${grant} (${response.status})`);
    const body = await response.json();
    if (typeof body.access_token !== 'string') throw new BlackboardError('refused', 'Blackboard sent no access token');
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      userId: typeof body.user_id === 'string' ? body.user_id : null
    };
  }

  /** @param {Response} response */
  function failIfBad(response) {
    if (response.ok) return;
    if (response.status === 401) throw new BlackboardError('expired', 'Blackboard said the access token is no good');
    if (response.status === 403) throw new BlackboardError('forbidden', 'Blackboard won’t show this to the student');
    if (response.status === 404) throw new BlackboardError('not-found', 'Blackboard has no such thing');
    throw new BlackboardError('unavailable', `Blackboard answered ${response.status}`);
  }

  return {
    /** Where the student goes to sign in to Blackboard and allow read access. */
    authoriseUrl(/** @type {{ redirectUri: string, state: string, codeChallenge: string }} */ { redirectUri, state, codeChallenge }) {
      const query = new URLSearchParams({
        redirect_uri: redirectUri,
        response_type: 'code',
        client_id: appKey,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });
      return `${browserHost}${BASE}/v1/oauth2/authorizationcode?${query}`;
    },
    /** Swaps the sign-in's code for tokens. @param {{ code: string, redirectUri: string, verifier: string }} options */
    exchangeCode: ({ code, redirectUri, verifier }) => token({ code, redirect_uri: redirectUri, code_verifier: verifier }, 'authorization_code'),
    /** A new access token from the refresh token. @param {{ refreshToken: string, redirectUri: string }} options */
    refresh: ({ refreshToken, redirectUri }) => token({ refresh_token: refreshToken, redirect_uri: redirectUri }, 'refresh_token'),
    /**
     * Every result of a list, following Learn's paging (at most maxPages pages).
     * @param {string} path such as "/v1/calendars/items"
     * @param {string} accessToken
     * @param {Record<string, string>} [query]
     * @returns {Promise<any[]>}
     */
    async list(path, accessToken, query = {}) {
      const results = [];
      /** @type {string | null} */
      let next = `${BASE}${path}?${new URLSearchParams(query)}`;
      for (let page = 0; next && page < maxPages; page++) {
        const response = await call(`${host}${next}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
        failIfBad(response);
        const body = await response.json();
        results.push(...(Array.isArray(body.results) ? body.results : []));
        next = typeof body.paging?.nextPage === 'string' ? body.paging.nextPage : null;
      }
      return results;
    },
    /**
     * One thing, such as a term.
     * @param {string} path
     * @param {string} accessToken
     * @param {Record<string, string>} [query]
     */
    async one(path, accessToken, query = {}) {
      const response = await call(`${host}${BASE}${path}?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      failIfBad(response);
      return response.json();
    }
  };
}

/** @typedef {ReturnType<typeof blackboardClient>} BlackboardClient */
