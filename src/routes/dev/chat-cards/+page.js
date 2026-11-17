import { error } from '@sveltejs/kit';

// A page for checking the check-in chat's cards at phone width with made-up details, as the real
// chat needs a login. Only while developing (npm run dev): import.meta.env.DEV is false in a
// production build, so there it answers 404.
export function load() {
  if (!import.meta.env.DEV) error(404, 'Not found');
}
