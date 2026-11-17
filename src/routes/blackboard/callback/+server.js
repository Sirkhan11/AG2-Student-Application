import { redirect } from '@sveltejs/kit';
import { clientFor, settings } from '#lib/server/blackboard/connection.js';
import { FLOW_COOKIE, FLOW_PATH, finishConnect, SESSION_COOKIE, SESSION_MAX_AGE, SESSION_PATH } from '#lib/server/blackboard/flow.js';

/**
 * Where Blackboard sends the student back after they allow (or deny) read access. Swaps the code for
 * tokens on the server, keeps them only in the sealed session cookie, and goes back to the checklist.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, cookies }) {
  if (!settings.ready) redirect(303, '/checklist?blackboard=failed#blackboard');
  const flowCookie = cookies.get(FLOW_COOKIE);
  cookies.delete(FLOW_COOKIE, { path: FLOW_PATH });
  const { redirect: back, session } = await finishConnect({
    cookieKey: /** @type {Buffer} */ (settings.cookieKey),
    client: clientFor(url.origin),
    query: { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') },
    flowCookie,
    origin: url.origin
  });
  if (session) cookies.set(SESSION_COOKIE, session, { path: SESSION_PATH, httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE });
  redirect(303, back);
}
