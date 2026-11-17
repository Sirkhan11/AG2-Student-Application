import data from '#lib/sport/sport-clubs.json' with { type: 'json' };

// Northumbria Sport's student sports clubs (the university's teams, such as Swimming), collected from
// northumbriasport.com/sports (see sport-clubs.json for where and when): names, links and pictures.
// Each club's details (about, memberships and training, contacts, socials, booking link) are in
// Firestore at sportClubs/{slug}, imported by scripts/import-sport-club-pages.mjs. Every club is at
// the Newcastle campus. No Firebase here, so the check scripts can use it.

/** @typedef {{ slug: string, name: string, url: string, image: string | null }} Club */

/** Where the list came from, and when. */
export const CLUBS_SOURCE = data.source;
export const CLUBS_COLLECTED_AT = data.collectedAt;

/** @type {Club[]} */
export const CLUBS = data.clubs.map((club) => ({ slug: club.slug, name: club.name, url: club.url, image: club.image ?? null }));

/** Lower case with single spaces, for comparing names. @param {string} text */
const simple = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The club with this slug (such as "swimming"), or null.
 * @param {string} slug
 */
export function clubBySlug(slug) {
  return CLUBS.find((club) => club.slug === slug) ?? null;
}

/**
 * Finds a club by its exact name, ignoring capitals and spacing, or null. "Hockey" is the club;
 * "Ice Hockey" isn't (that's a society).
 * @param {string} name
 */
export function findClub(name) {
  return CLUBS.find((club) => simple(club.name) === simple(name)) ?? null;
}

/**
 * The clubs whose name contains the search text, alphabetically.
 * @param {string} search
 */
export function searchClubs(search) {
  const wanted = simple(search);
  return CLUBS.filter((club) => simple(club.name).includes(wanted)).sort((a, b) => a.name.localeCompare(b.name));
}
