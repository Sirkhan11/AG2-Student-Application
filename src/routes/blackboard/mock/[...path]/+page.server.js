import { error } from '@sveltejs/kit';
import { settings } from '#lib/server/blackboard/connection.js';

/**
 * Where the mock's links go (a module or an item "on Blackboard"), as there's no real Blackboard
 * behind it. Only while BLACKBOARD_HOST is "mock".
 * @type {import('./$types').PageServerLoad}
 */
export function load({ params }) {
  if (settings.mode !== 'mock') error(404, 'Not found');
  return { path: `/${params.path}` };
}
