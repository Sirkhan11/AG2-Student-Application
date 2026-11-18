import data from '#lib/gp/gp-practices.json' with { type: 'json' };
import { distanceKm } from '#lib/gp/distance.js';
import { parseEnglandFile } from '#lib/gp/england.js';

// What the GP finder works out on the phone. Two lists:
// - the North East list (gp-practices.json, part of the page): Tyne and Wear, Northumberland and County
//   Durham, with each surgery's phone, email and website;
// - the all-England list (static/gp/england.tsv), loaded only when a search lands outside the North
//   East list. The request is the same for everyone, so it never says where someone is.
// A location given to these functions is only used for the sums, never kept or sent.

/** @typedef {typeof data.practices[number]} GpPractice */
/** @typedef {GpPractice | import('#lib/gp/england.js').EnglandPractice} AnyPractice */
/** @typedef {AnyPractice & { distanceKm: number }} NearbyPractice */

export const PRACTICES = data.practices;
export const CENTRE = data.centre;
/** The postcode areas the North East list covers (NE, DH and SR). */
export const AREAS = data.areas;
/** How many surgeries a search shows at first, and how many more each "Show more" adds. */
export const RESULTS = 10;
/** The most a search can show. */
export const MAX_RESULTS = 30;
/** If the nearest North East surgery is further than this, the search uses the all-England list. */
export const NORTH_EAST_KM = 15;
/** If even the nearest surgery in England is further than this, the point is probably not in England. */
export const BEYOND_ENGLAND_KM = 30;
/** The all-England list's address: the same for every search. */
export const ENGLAND_FILE = '/gp/england.tsv';

/** When the North East list was last downloaded with a change, such as "17 November 2026". */
export const LIST_DATE = new Date(`${data.dataFrom}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/London'
});

/** The official GP finders for the rest of the UK, for searches outside England. */
export const OTHER_NATIONS = /** @type {const} */ ({
  Scotland: { label: 'NHS inform: GP practices in Scotland', href: 'https://www.nhsinform.scot/scotlands-service-directory/gp-practices/' },
  Wales: { label: 'NHS 111 Wales: services near you, including GPs', href: 'https://111.wales.nhs.uk/localservices/' },
  'Northern Ireland': { label: 'nidirect: find a GP practice in Northern Ireland', href: 'https://www.nidirect.gov.uk/services/gp-practices' }
});

/**
 * The nearest practices in a list to a point, closest first.
 * @template {AnyPractice} P
 * @param {number} lat
 * @param {number} lng
 * @param {P[]} practices
 * @param {number} [limit]
 * @returns {(P & { distanceKm: number })[]}
 */
export function nearestIn(lat, lng, practices, limit = MAX_RESULTS) {
  return practices
    .map((practice) => ({ ...practice, distanceKm: distanceKm(lat, lng, practice.lat, practice.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/** @type {Promise<import('#lib/gp/england.js').EnglandPractice[]> | null} */
let englandList = null;

/**
 * The all-England list, downloaded once (the same request whoever asks).
 * @param {typeof fetch} [fetchImpl]
 */
export function loadEngland(fetchImpl = fetch) {
  englandList ??= fetchImpl(ENGLAND_FILE).then(async (response) => {
    if (!response.ok) throw new Error(`The England GP list answered ${response.status}`);
    return parseEnglandFile(await response.text());
  });
  englandList.catch(() => (englandList = null));
  return englandList;
}

/**
 * The nearest surgeries to a point, anywhere in England: from the North East list (with emails and
 * websites) when it has one within NORTH_EAST_KM, otherwise from the all-England list. farFromEngland
 * is true when even the nearest is more than BEYOND_ENGLAND_KM away (probably not in England).
 * @param {number} lat
 * @param {number} lng
 * The finder's Dentist tab passes its own two lists (dentists/finder.js).
 * @param {{ load?: () => Promise<import('#lib/gp/england.js').EnglandPractice[]>, northEast?: AnyPractice[] }} [options]
 * @returns {Promise<{ source: 'north-east' | 'england', practices: NearbyPractice[], farFromEngland: boolean }>}
 */
export async function nearestAnywhere(lat, lng, { load = loadEngland, northEast = PRACTICES } = {}) {
  const near = nearestIn(lat, lng, northEast);
  if (near.length && near[0].distanceKm <= NORTH_EAST_KM) return { source: 'north-east', practices: near, farFromEngland: false };
  const all = nearestIn(lat, lng, await load());
  return { source: 'england', practices: all, farFromEngland: !all.length || all[0].distanceKm > BEYOND_ENGLAND_KM };
}

/** A postcode in capitals with one space before the last three characters: "ne18st" → "NE1 8ST". @param {string} text */
export function normalisePostcode(text) {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

/** True for a full UK postcode in the form normalisePostcode() gives. @param {string} postcode */
export const isPostcode = (postcode) => /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode);

/**
 * What someone typed: a full postcode ("NE1 8ST"), a postcode district ("NE6", "DH1") or a place
 * ("Heaton"), in any case or spacing. Empty or too long gives kind "empty".
 * @param {string} text
 * @returns {{ kind: 'postcode' | 'district' | 'place' | 'empty', value: string }}
 */
export function classifySearch(text) {
  const tidy = text.replace(/\s+/g, ' ').trim();
  if (!tidy || tidy.length > 60) return { kind: 'empty', value: '' };
  const postcode = normalisePostcode(tidy);
  if (isPostcode(postcode)) return { kind: 'postcode', value: postcode };
  const compact = tidy.toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(compact)) return { kind: 'district', value: compact };
  return { kind: 'place', value: tidy };
}

/**
 * @typedef {{ label: string, county: string, country: string, lat: number, lng: number }} PlaceChoice
 */

/** The kinds of place in postcodes.io's list (Ordnance Survey's names) that people live in. */
const LIVED_IN = new Set(['City', 'Town', 'Village', 'Hamlet', 'Suburban Area', 'Other Settlement']);

/**
 * The places postcodes.io found for a name, as choices: places people live in, whose name is what was
 * typed (any case), each named with its county, once each.
 * @param {any[]} results postcodes.io's /places results
 * @param {string} typed
 * @param {{ lat: number, lng: number }} [near] choices nearest this come first (the campus, so
 *   Newcastle's Heaton comes before Bradford's)
 * @returns {PlaceChoice[]}
 */
export function placeChoices(results, typed, near = CENTRE) {
  const wanted = typed.toLowerCase().replace(/\s+/g, ' ').trim();
  /** @type {PlaceChoice[]} */
  const choices = [];
  for (const place of results ?? []) {
    if (!LIVED_IN.has(place.local_type) || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') continue;
    const names = [place.name_1, place.name_2].filter(Boolean).map((name) => String(name).toLowerCase());
    if (!names.includes(wanted)) continue;
    const county = place.county_unitary || place.district_borough || place.region || '';
    if (choices.some((choice) => choice.label === place.name_1 && choice.county === county)) continue;
    choices.push({ label: place.name_1, county, country: place.country ?? '', lat: place.latitude, lng: place.longitude });
  }
  return choices.sort((a, b) => distanceKm(near.lat, near.lng, a.lat, a.lng) - distanceKm(near.lat, near.lng, b.lat, b.lng));
}

/** "Saville Medical Group" → "saville-medical-group". The NHS website redirects if it writes it differently. @param {string} name */
const slug = (name) =>
  name.toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The surgery's page on the NHS website: catchment area, new patients, registering and contacts. @param {{ name: string, code: string }} practice */
export const practicePageUrl = (practice) => `https://www.nhs.uk/services/gp-surgery/${slug(practice.name)}/${practice.code}`;

/** NHS Find a GP: results for the postcode, or the search page. @param {string | null} [postcode] */
export const findAGpUrl = (postcode) =>
  postcode ? `https://www.nhs.uk/service-search/find-a-gp/results?location=${encodeURIComponent(postcode)}` : 'https://www.nhs.uk/service-search/find-a-gp/';

/** NHS Find a dentist: results for the postcode, or the search page. @param {string | null} [postcode] */
export const findADentistUrl = (postcode) =>
  postcode ? `https://www.nhs.uk/service-search/find-a-dentist/results?location=${encodeURIComponent(postcode)}` : 'https://www.nhs.uk/service-search/find-a-dentist/';

/** "650 m" or "1.4 km". @param {number} km */
export const distanceText = (km) => (km < 0.95 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`);

/** A tel: link for a phone number as written ("0191 232 4274"). @param {string} phone */
export const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** A mailto: link for a surgery's email address. @param {string} email */
export const mailHref = (email) => `mailto:${email}`;
