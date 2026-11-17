import { error } from '@sveltejs/kit';
import { societyById } from '#lib/societies/societies.js';

/**
 * Finds the society in the list before the page shows, so an unknown number is a proper 404.
 * The details from NSU (description and so on) load in the page, as they need a signed-in user.
 * @type {import('./$types').PageLoad}
 */
export function load({ params }) {
  const society = /^\d+$/.test(params.nsuId) ? societyById(Number(params.nsuId)) : null;
  if (!society) error(404, 'We couldn’t find that society.');
  return { society };
}
