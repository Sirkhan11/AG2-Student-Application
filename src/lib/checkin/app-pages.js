// The app's own pages the check-in chat can link, written [[Name]] like societies, clubs and services
// (see reply-links.js). The chat's instructions list them by name (chat-prompt.js). No Firebase here,
// so the checks can use it in Node.

/**
 * A page: name is what Gemini is told to write and what the button says; also holds other ways
 * Gemini might write it (in any capitals), such as the bottom bar's "Mentor".
 * @typedef {{ name: string, href: string, also: string[] }} AppPage
 */

/** @type {AppPage[]} */
export const APP_PAGES = [
  { name: 'Checklist', href: '/checklist', also: ['Your checklist', 'My checklist', 'Settling-in checklist'] },
  { name: 'NHS Guide', href: '/nhs-guide', also: [] },
  { name: 'GP Finder', href: '/gp-finder', also: ['GP and Dentist Finder', 'Find a GP', 'Find a GP or Dentist'] },
  { name: 'Your Mentor', href: '/mentor', also: ['Mentor', 'Your Mentor page', 'Mentor page'] },
  { name: 'Find a mentor', href: '/find-mentor', also: [] },
  { name: 'Need Help Now', href: '/need-help', also: ['Need help now page', 'Need Help'] }
];

/** Lower case with single spaces, so "your  mentor" finds "Your Mentor". @param {string} name */
const simple = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The page with this name or one of its other names (ignoring capitals and extra spaces), or null.
 * @param {string} name
 * @returns {AppPage | null}
 */
export function findPage(name) {
  const wanted = simple(name);
  return APP_PAGES.find((page) => simple(page.name) === wanted || page.also.some((other) => simple(other) === wanted)) ?? null;
}
