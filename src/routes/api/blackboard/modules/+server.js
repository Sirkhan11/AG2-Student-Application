import { error, json } from '@sveltejs/kit';
import { clientFor, linksFor, settings, signedInUser } from '#lib/server/blackboard/connection.js';
import { readView, SESSION_COOKIE, SESSION_MAX_AGE, SESSION_PATH } from '#lib/server/blackboard/flow.js';

/**
 * What the Blackboard section shows for the signed-in student: their modules, or that they need to
 * connect (or reconnect), or that Blackboard isn't answering. Only what the page shows is sent.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ request, url, cookies }) {
  const noStore = { 'cache-control': 'no-store' };
  if (!settings.ready) return json({ connected: false, reason: 'not-set-up' }, { headers: noStore });
  const user = await signedInUser(request);
  if (!user) error(401, 'Please log in first');
  const { view, session, status } = await readView({
    cookieKey: /** @type {Buffer} */ (settings.cookieKey),
    client: clientFor(url.origin),
    sessionCookie: cookies.get(SESSION_COOKIE),
    uid: user.uid,
    origin: url.origin,
    links: linksFor(url.origin),
    mock: settings.mode === 'mock'
  });
  if (session === null) cookies.delete(SESSION_COOKIE, { path: SESSION_PATH });
  else if (session) cookies.set(SESSION_COOKIE, session, { path: SESSION_PATH, httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE });
  return json(view, { status: status ?? 200, headers: noStore });
}
