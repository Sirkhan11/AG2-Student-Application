import { error } from '@sveltejs/kit';

/** A development-only page for checking the Blackboard section's layout with made-up modules. */
export function load() {
  if (!import.meta.env.DEV) error(404, 'Not found');
}
