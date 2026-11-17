import { error, redirect } from '@sveltejs/kit';
import { settings } from '#lib/server/blackboard/connection.js';
import { approve, deny, MOCK_APP_KEY, MOCK_SCENARIOS } from '#lib/server/blackboard/mock.js';

// The mock's pretend "Allow" page, at the same path as Learn's real one, so the app's code is the
// same for both. Only while BLACKBOARD_HOST is "mock"; otherwise it doesn't exist. It never asks for
// a username or password: in the real flow, the student signs in on Northumbria's Blackboard.

/** The sign-in request, checked: our app, sent back only to this app's own callback. @param {URL} url */
function request(url) {
  if (settings.mode !== 'mock') error(404, 'Not found');
  const q = url.searchParams;
  const redirectUri = q.get('redirect_uri') ?? '';
  let back;
  try {
    back = new URL(redirectUri);
  } catch {
    error(400, 'No redirect address');
  }
  if (back.origin !== url.origin || back.pathname !== '/blackboard/callback') error(400, 'Not this app’s callback');
  if (q.get('client_id') !== MOCK_APP_KEY || q.get('response_type') !== 'code') error(400, 'Unknown app');
  return { redirectUri, state: q.get('state'), clientId: q.get('client_id'), codeChallenge: q.get('code_challenge'), method: q.get('code_challenge_method'), scope: q.get('scope') ?? '' };
}

/** @type {import('./$types').PageServerLoad} */
export function load({ url }) {
  const { scope } = request(url);
  return { scope, scenarios: Object.entries(MOCK_SCENARIOS).map(([id, label]) => ({ id, label })) };
}

/** @type {import('./$types').Actions} */
export const actions = {
  allow: async ({ request: req, url }) => {
    const sign = request(url);
    const scenario = String((await req.formData()).get('scenario') ?? 'normal');
    redirect(303, approve({ ...sign, scenario }));
  },
  deny: ({ url }) => {
    const sign = request(url);
    redirect(303, deny(sign));
  }
};
