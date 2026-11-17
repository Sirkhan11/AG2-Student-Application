import data from '#lib/gp/gp-practices.json' with { type: 'json' };
import { distanceKm } from '#lib/gp/distance.js';

// What the GP finder works out on the phone: the nearest surgeries to a point, and links to the NHS
// website. The list is src/lib/gp/gp-practices.json (refresh-gp-practices.mjs). No Firebase or
// network here: a location given to nearestPractices() is only used for the sums, never kept.

/** @typedef {typeof data.practices[number]} GpPractice */
/** @typedef {GpPractice & { distanceKm: number }} NearbyPractice */

export const PRACTICES = data.practices;
export const CENTRE = data.centre;
export const RADIUS_KM = data.radiusKm;
/** How many surgeries a search shows. */
export const RESULTS = 5;
/** When the list was last downloaded with a change, such as "17 November 2026". */
export const LIST_DATE = new Date(`${data.dataFrom}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/London'
});

/**
 * The nearest surgeries to a point, closest first. A point more than RADIUS_KM from the campus is
 * outside the list (for example a London postcode), so it gets none: the NHS's own search has them.
 * @param {number} lat
 * @param {number} lng
 * @param {{ limit?: number, practices?: GpPractice[], centre?: { lat: number, lng: number }, radiusKm?: number }} [options]
 * @returns {{ inArea: boolean, practices: NearbyPractice[] }}
 */
export function nearestPractices(lat, lng, { limit = RESULTS, practices = PRACTICES, centre = CENTRE, radiusKm = RADIUS_KM } = {}) {
  if (distanceKm(centre.lat, centre.lng, lat, lng) > radiusKm) return { inArea: false, practices: [] };
  return {
    inArea: true,
    practices: practices
      .map((practice) => ({ ...practice, distanceKm: distanceKm(lat, lng, practice.lat, practice.lng) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit)
  };
}

/** A postcode in capitals with one space before the last three characters: "ne18st" → "NE1 8ST". @param {string} text */
export function normalisePostcode(text) {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

/** True for a full UK postcode in the form normalisePostcode() gives. @param {string} postcode */
export const isPostcode = (postcode) => /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode);

/** "Saville Medical Group" → "saville-medical-group". The NHS website redirects if it writes it differently. @param {string} name */
const slug = (name) =>
  name.toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The surgery's page on the NHS website: catchment area, new patients and registering. @param {GpPractice} practice */
export const practicePageUrl = (practice) => `https://www.nhs.uk/services/gp-surgery/${slug(practice.name)}/${practice.code}`;

/** NHS Find a GP: results for the postcode, or the search page. @param {string | null} [postcode] */
export const findAGpUrl = (postcode) =>
  postcode ? `https://www.nhs.uk/service-search/find-a-gp/results?location=${encodeURIComponent(postcode)}` : 'https://www.nhs.uk/service-search/find-a-gp/';

/** NHS Find a dentist: results for the postcode, or the search page. @param {string | null} [postcode] */
export const findADentistUrl = (postcode) =>
  postcode ? `https://www.nhs.uk/service-search/find-a-dentist/results?location=${encodeURIComponent(postcode)}` : 'https://www.nhs.uk/service-search/find-a-dentist/';

/** "650 m" or "1.4 km". @param {number} km */
export const distanceText = (km) => (km < 0.95 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`);

/** A tel: link for a phone number as ODS writes it ("0191 2324274"). @param {string} phone */
export const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;
