import { doc, getDoc } from 'firebase/firestore';
import { db } from '#lib/firebase/client.js';

/**
 * A club's details from Northumbria Sport, from Firestore at sportClubs/{slug} (copied there by
 * scripts/import-sport-club-pages.mjs). Only signed-in users can read them (firestore.rules), as the
 * contacts are people's names and emails. Gemini never sees any of this.
 * @typedef {{ role: string | null, note: string | null, people: { name: string | null, email: string }[] }} ClubContact
 * @typedef {{ about: string[], membership: { kind: 'text' | 'item', text: string }[],
 *   socials: { platform: string, url: string }[], contacts: ClubContact[], bookUrl: string | null,
 *   collectedAt: string | null }} ClubPage
 */

const isHttps = (/** @type {unknown} */ value) => typeof value === 'string' && value.startsWith('https://');
const isText = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';

/**
 * Loads a club's details, or null if they haven't been imported yet. Anything malformed is dropped
 * rather than shown (a link that isn't https, a contact with no email), so the pages can trust it.
 * @param {string} slug
 * @returns {Promise<ClubPage | null>}
 */
export async function loadClubPage(slug) {
  const snapshot = await getDoc(doc(db, 'sportClubs', slug));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  return {
    about: list(data.about).filter(isText),
    membership: list(data.membership)
      .filter((line) => (line?.kind === 'text' || line?.kind === 'item') && isText(line?.text))
      .map((line) => ({ kind: line.kind, text: line.text })),
    socials: list(data.socials).filter((social) => typeof social?.platform === 'string' && isHttps(social?.url)),
    contacts: list(data.contacts)
      .map((contact) => ({
        role: isText(contact?.role) ? contact.role : null,
        note: isText(contact?.note) ? contact.note : null,
        people: list(contact?.people)
          .filter((person) => typeof person?.email === 'string' && person.email.includes('@'))
          .map((person) => ({ name: isText(person.name) ? person.name : null, email: person.email }))
      }))
      .filter((contact) => contact.people.length > 0 && (contact.role || contact.note)),
    bookUrl: isHttps(data.bookUrl) ? data.bookUrl : null,
    collectedAt: typeof data.collectedAt === 'string' ? data.collectedAt : null
  };
}

/** Pages already asked for in this visit, by slug (the promise, so two cards asking at once share one read). */
/** @type {Map<string, Promise<ClubPage | null>>} */
const loaded = new Map();

/**
 * loadClubPage, remembered for the rest of the visit, for the check-in chat's club cards: a club
 * suggested twice is only read once. A failed read isn't remembered, so a later card can try again.
 * @param {string} slug
 * @returns {Promise<ClubPage | null>}
 */
export function loadClubPageOnce(slug) {
  let page = loaded.get(slug);
  if (!page) {
    page = loadClubPage(slug).catch((err) => {
      loaded.delete(slug);
      throw err;
    });
    loaded.set(slug, page);
  }
  return page;
}
