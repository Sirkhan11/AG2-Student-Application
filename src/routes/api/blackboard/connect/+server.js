import { error, json } from '@sveltejs/kit';
import { clientFor, fromThisApp, settings, signedInUser } from '#lib/server/blackboard/connection.js';
import { FLOW_COOKIE, FLOW_MAX_AGE, FLOW_PATH, startConnect } from '#lib/server/blackboard/flow.js';

/**
 * Starts connecting Blackboard for the signed-in student: sets the sealed flow cookie and answers
 * with Blackboard's sign-in address, which the page then opens. The student signs in there, never here.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, url, cookies }) {
  if (!fromThisApp(request, url)) error(403, 'Not from this app');
  if (!settings.ready) return json({ error: 'not-set-up' }, { status: 503 });
  const user = await signedInUser(request);
  if (!user) error(401, 'Please log in first');
  const { url: signIn, flow } = startConnect({ cookieKey: /** @type {Buffer} */ (settings.cookieKey), client: clientFor(url.origin), uid: user.uid, origin: url.origin });
  cookies.set(FLOW_COOKIE, flow, { path: FLOW_PATH, httpOnly: true, sameSite: 'lax', maxAge: FLOW_MAX_AGE });
  return json({ url: signIn }, { headers: { 'cache-control': 'no-store' } });
}
