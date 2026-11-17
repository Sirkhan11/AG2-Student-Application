import { error } from '@sveltejs/kit';
import { clubBySlug } from '#lib/sport/clubs.js';

/**
 * Finds the club in the list before the page shows, so an unknown address is a proper 404. The
 * details from Northumbria Sport load in the page, as they need a signed-in user.
 * @type {import('./$types').PageLoad}
 */
export function load({ params }) {
  const club = clubBySlug(params.slug);
  if (!club) error(404, 'We couldn’t find that sports club.');
  return { club };
}
