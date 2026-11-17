import { doc, getDoc } from 'firebase/firestore';
import { db } from '#lib/firebase/client.js';

/**
 * A society's NSU page, from Firestore at societies/{nsuId} (copied there by
 * scripts/import-society-pages.mjs). Only signed-in users can read it (firestore.rules).
 * @typedef {{ description: string[], memberships: { name: string, price: number }[],
 *   socials: { platform: string, url: string }[], eventsUrl: string | null, email: string | null,
 *   committee: unknown[], collectedAt: string | null }} SocietyPage
 */

const isHttps = (/** @type {unknown} */ value) => typeof value === 'string' && value.startsWith('https://');

/**
 * Loads a society's page, or null if it hasn't been imported yet. Anything malformed is dropped
 * rather than shown (a link that isn't https, a price that isn't a number), so the page can trust it.
 * @param {number} nsuId
 * @returns {Promise<SocietyPage | null>}
 */
export async function loadSocietyPage(nsuId) {
  const snapshot = await getDoc(doc(db, 'societies', String(nsuId)));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  return {
    description: list(data.description).filter((paragraph) => typeof paragraph === 'string' && paragraph.trim() !== ''),
    memberships: list(data.memberships).filter(
      (membership) => typeof membership?.name === 'string' && typeof membership?.price === 'number' && membership.price >= 0
    ),
    socials: list(data.socials).filter((social) => typeof social?.platform === 'string' && isHttps(social?.url)),
    eventsUrl: isHttps(data.eventsUrl) ? data.eventsUrl : null,
    email: typeof data.email === 'string' && data.email.includes('@') ? data.email : null,
    committee: list(data.committee),
    collectedAt: typeof data.collectedAt === 'string' ? data.collectedAt : null
  };
}
