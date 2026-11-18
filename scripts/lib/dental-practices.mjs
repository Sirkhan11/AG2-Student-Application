// The offline part of refresh-dental-practices.mjs: reading NHS England's list of dental practices (the
// "egdpprac" report from ODS Data Search and Export, Open Government Licence), keeping England's active
// ones, and building the two files the finder's Dentist tab uses (src/lib/dentists/england.js says
// what they hold):
// - src/lib/dentists/north-east.json: those in the NE, DH and SR postcode areas (Tyne and Wear,
//   Northumberland and County Durham). It's part of the page.
// - static/dentists/england.tsv: all of them in England, compact, loaded only when a search lands
//   outside the North East.
// Only practices with a page on the NHS website are kept, from the NHS website's own list of its
// dentist pages (its sitemap): about a third of the report's active practices have none (nor are they
// in NHS Find a dentist), and each result links to its page. The report has no phone numbers; the
// page has the phone number and whether it's taking new NHS patients, which changes too often to copy.
// Tested with made-up rows by check-dental-practices.mjs. Nothing here goes to the network.

import { DENTIST_COLUMNS } from '#lib/dentists/england.js';
import { AREAS, parseCsv, shortAddress, tidyName } from './gp-practices.mjs';

export { AREAS, parseCsv };
export const DENTAL_REPORT_URL = 'https://www.odsdatasearchandexport.nhs.uk/api/getReport?report=egdpprac';
/** The NHS website's list of its dentist pages, one request (robots.txt names its sitemaps). */
export const DENTIST_SITEMAP_URL = 'https://www.nhs.uk/sitemap-profiles-dentist.xml';
/** Says what's asking, so the services can tell it apart from people and other bots. */
export const DENTAL_USER_AGENT = 'AG2StudentApp-dentist-refresh/1.0 (Northumbria University student project)';
/** Fewer practices with an NHS page in England than this means something has changed (6,378 of the report's 9,406 in November 2026). */
export const MIN_ENGLAND_DENTISTS = 5000;
/** Fewer in the North East than this means something has changed (199 of the report's 297 in November 2026). */
export const MIN_NORTH_EAST_DENTISTS = 150;
/** Fewer pages in the NHS website's list than this means the list has changed (6,393 in November 2026). */
export const MIN_LISTED = 5000;

/** Where things are in each row of the report (counting from 0). It has no header row. */
const COLUMN = { code: 0, name: 1, grouping: 2, address: [4, 5, 6, 7, 8], postcode: 9, status: 12 };

/**
 * True for a practice in England: it sits in an NHS England region (national grouping Y56 to Y63). The
 * report also has Wales's practices, with no grouping; the finder sends people in Wales to Wales's own.
 * @param {string[]} row
 */
const inEngland = (row) => /^Y\d\d$/.test(row[COLUMN.grouping] ?? '');

/** The letters a postcode starts with ("NE" for NE1 8DQ). @param {string} postcode */
const areaOf = (postcode) => postcode.trim().toUpperCase().match(/^([A-Z]{1,2})\d/)?.[1] ?? '';

/**
 * @typedef {{ code: string, name: string, address: string, postcode: string }} Practice
 * @typedef {Practice & { lat: number, lng: number }} PlacedPractice
 * @typedef {{ source: string, licence: string, dataFrom: string, areas: string[], count: number, practices: PlacedPractice[] }} NorthEastFile
 */

/**
 * The practices the NHS website has a page for, from its list of dentist pages: each page's address
 * ends in the ODS code's digits, six of them, after V (/services/dentist/some-name/V012345 is V12345).
 * @param {string} xml the sitemap
 * @returns {Set<string>} the six digits of each
 */
export function listedOnNhs(xml) {
  return new Set([...xml.matchAll(/\/services\/dentist\/[^/<\s]+\/V(\d{6})(?:_\d+)?\s*</g)].map((m) => m[1]));
}

/**
 * True for a specialist a student can't register with, going by the name: orthodontists and oral
 * surgeons (agent1.md A11; "Neo Orthodontics" was fifth near the campus). The report doesn't say which
 * practices are specialists, so one whose name doesn't say so stays in.
 * @param {string} name
 */
export const isSpecialist = (name) => /orthodont|oral surg|maxillofacial/i.test(name);

/** True if the NHS website has a page for the practice. @param {{ code: string }} practice @param {Set<string>} listed */
export const hasNhsPage = (practice, listed) => listed.has(practice.code.slice(1).padStart(6, '0'));

/**
 * England's active dental practices, tidied: all of them, or those in the given postcode areas.
 * @param {string[][]} rows the report's rows
 * @param {string[] | null} [areas] such as ['NE', 'DH']; null for all of England
 * @returns {Practice[]}
 */
export function activeDentalPractices(rows, areas = null) {
  return rows
    .filter((row) => row[COLUMN.status] === 'ACTIVE' && inEngland(row) && /^V\d{5,6}$/.test(row[COLUMN.code]?.trim() ?? ''))
    .filter((row) => !areas || areas.includes(areaOf(row[COLUMN.postcode] ?? '')))
    .map((row) => ({
      code: row[COLUMN.code].trim(),
      name: tidyName(row[COLUMN.name]),
      address: COLUMN.address.map((i) => row[i]?.trim()).filter(Boolean).map((line) => tidyName(/** @type {string} */ (line))).join(', '),
      postcode: row[COLUMN.postcode].trim().toUpperCase()
    }));
}

const SOURCE =
  'NHS England Organisation Data Service: dental practices (egdpprac), from https://www.odsdatasearchandexport.nhs.uk/, ' +
  'those with a page on the NHS website (its list of dentist pages, https://www.nhs.uk/sitemap-profiles-dentist.xml).';
const LICENCE =
  'Contains NHS England data, Open Government Licence v3.0. Coordinates from postcodes.io (ONS Postcode Directory): ' +
  'contains OS data © Crown copyright and database right; contains Royal Mail data © Royal Mail copyright and database right; ' +
  'contains National Statistics data © Crown copyright and database right.';

/**
 * The North East file the page holds: practices sorted by name, coordinates to 5 decimal places.
 * @param {PlacedPractice[]} practices
 * @param {string} dataFrom the day the report was downloaded, such as "2026-11-18"
 * @returns {NorthEastFile}
 */
export function northEastFile(practices, dataFrom) {
  const round = (/** @type {number} */ n) => Math.round(n * 1e5) / 1e5;
  const sorted = [...practices].sort((a, b) => a.name.localeCompare(b.name, 'en-GB') || a.code.localeCompare(b.code));
  return {
    source: SOURCE,
    licence: LICENCE,
    dataFrom,
    areas: AREAS,
    count: sorted.length,
    practices: sorted.map((practice) => ({ code: practice.code, name: practice.name, address: practice.address, postcode: practice.postcode, lat: round(practice.lat), lng: round(practice.lng) }))
  };
}

/**
 * The all-England file (static/dentists/england.tsv, read by src/lib/dentists/england.js): a note line,
 * the column names, then one practice per line, tab-separated, sorted by ODS code, coordinates to 4
 * places (about 10 m).
 * @param {PlacedPractice[]} practices
 * @param {string} dataFrom
 */
export function englandDentistFile(practices, dataFrom) {
  const clean = (/** @type {unknown} */ value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const lines = [...practices]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => [p.code, p.name, shortAddress(p.address), p.postcode, p.lat.toFixed(4), p.lng.toFixed(4)].map(clean).join('\t'));
  return [
    `# NHS dental practices in England, ${dataFrom}: NHS England Organisation Data Service (egdpprac), those with a page on the NHS website, Open Government Licence v3.0. ` +
      'Coordinates from postcodes.io (ONS Postcode Directory): contains OS data © Crown copyright and database right; ' +
      'contains Royal Mail data © Royal Mail copyright and database right; contains National Statistics data © Crown copyright and database right.',
    DENTIST_COLUMNS.join('\t'),
    ...lines
  ].join('\n') + '\n';
}

/** The England file's text without its dated note line, to see whether anything really changed. @param {string} text */
export const englandDentistBody = (text) => text.split('\n').filter((line) => !line.startsWith('#')).join('\n');

/**
 * True if the two North East files hold the same practices (the download date doesn't count).
 * @param {NorthEastFile | null} a
 * @param {NorthEastFile} b
 */
export function sameNorthEast(a, b) {
  if (!a) return false;
  const strip = (/** @type {NorthEastFile} */ file) => JSON.stringify({ ...file, dataFrom: null });
  return strip(a) === strip(b);
}

/**
 * Reasons not to write the files: a short list of NHS pages, too few practices with one, or too many
 * postcodes postcodes.io couldn't place.
 * @param {{ listed: number, england: number, northEast: number, candidates: number, unplaced: number }} counts
 */
export function checkDentistsBeforeWriting({ listed, england, northEast, candidates, unplaced }) {
  const problems = [];
  if (listed < MIN_LISTED) problems.push(`the NHS website's list has only ${listed} dentist pages (at least ${MIN_LISTED} expected), so it may have changed`);
  if (england < MIN_ENGLAND_DENTISTS) problems.push(`only ${england} practices in England with an NHS page (at least ${MIN_ENGLAND_DENTISTS} expected)`);
  if (northEast < MIN_NORTH_EAST_DENTISTS) problems.push(`only ${northEast} in the North East (at least ${MIN_NORTH_EAST_DENTISTS} expected)`);
  if (candidates > 0 && unplaced / candidates > 0.05) problems.push(`postcodes.io couldn't place ${unplaced} of ${candidates} practices`);
  return problems;
}
