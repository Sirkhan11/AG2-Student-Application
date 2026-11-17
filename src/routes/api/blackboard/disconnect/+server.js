import { error, json } from '@sveltejs/kit';
import { fromThisApp } from '#lib/server/blackboard/connection.js';
import { FLOW_COOKIE, FLOW_PATH, SESSION_COOKIE, SESSION_PATH } from '#lib/server/blackboard/flow.js';

/**
 * Disconnect: deletes both Blackboard cookies, which is everything the app holds about the
 * connection (the page deletes what it keeps on the phone). It doesn't need the sign-in, so logging
 * out can use it too. Learn has no way for an app to cancel a token, so the page also says how to
 * remove the app in Blackboard itself (Tools, Application Authorization, Revoke).
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, url, cookies }) {
  if (!fromThisApp(request, url)) error(403, 'Not from this app');
  cookies.delete(SESSION_COOKIE, { path: SESSION_PATH });
  cookies.delete(FLOW_COOKIE, { path: FLOW_PATH });
  return json({ disconnected: true }, { headers: { 'cache-control': 'no-store' } });
}
