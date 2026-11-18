import data from '#lib/dentists/north-east.json' with { type: 'json' };
import { asPractice, parseDentistFile } from '#lib/dentists/england.js';
import { nearestAnywhere } from '#lib/gp/finder.js';

// What the finder's Dentist tab works out on the phone, the way its GP tab does with surgeries
// (gp/finder.js), with the same search (gp/search.svelte.js): the North East list is part of the page,
// and the all-England list (static/dentists/england.tsv) is loaded only when a search lands outside it,
// the same request for everyone. A location given to these functions is only used for the sums, never
// kept or sent.

/** The North East's NHS dental practices (NE, DH and SR postcode areas) that have an NHS page. */
export const DENTISTS = data.practices.map(asPractice);
/** The all-England list's address: the same for every search. */
export const DENTIST_FILE = '/dentists/england.tsv';

/** When the list was last downloaded with a change, such as "18 November 2026". */
export const DENTIST_LIST_DATE = new Date(`${data.dataFrom}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/London'
});

/** What the search says when the list or a lookup fails, in a dentist's words (gp/search.svelte.js). */
export const DENTIST_WORDS = Object.freeze({
  listFailed: 'We couldn’t load the list of dentists in England just now. Please try again, or use NHS Find a dentist.',
  lookupFailed: 'We couldn’t look that up just now. Please try again, or use NHS Find a dentist.'
});

/**
 * Where to look for a dentist in the rest of the UK, for searches outside England. Northern Ireland has
 * no search: nidirect's page says how to find one (contact practices near you).
 */
export const DENTIST_NATIONS = /** @type {const} */ ({
  Scotland: { label: 'NHS inform: dental services in Scotland', href: 'https://www.nhsinform.scot/scotlands-service-directory/dental-services/' },
  Wales: { label: 'NHS 111 Wales: services near you, including dentists', href: 'https://111.wales.nhs.uk/localservices/' },
  'Northern Ireland': { label: 'nidirect: seeing a dentist in Northern Ireland', href: 'https://www.nidirect.gov.uk/articles/seeing-dentist' }
});

/** @type {Promise<import('#lib/dentists/england.js').DentalPractice[]> | null} */
let englandList = null;

/**
 * The all-England list, downloaded once (the same request whoever asks).
 * @param {typeof fetch} [fetchImpl]
 */
export function loadDentists(fetchImpl = fetch) {
  englandList ??= fetchImpl(DENTIST_FILE).then(async (response) => {
    if (!response.ok) throw new Error(`The England dentist list answered ${response.status}`);
    return parseDentistFile(await response.text());
  });
  englandList.catch(() => (englandList = null));
  return englandList;
}

/**
 * The nearest NHS dental practices to a point, anywhere in England: from the North East list when it
 * has one close by, otherwise from the all-England list (nearestAnywhere, as for GP surgeries).
 * @param {number} lat
 * @param {number} lng
 * @param {{ load?: () => Promise<import('#lib/dentists/england.js').DentalPractice[]> }} [options]
 */
export const nearestDentists = (lat, lng, { load = loadDentists } = {}) => nearestAnywhere(lat, lng, { load, northEast: DENTISTS });
