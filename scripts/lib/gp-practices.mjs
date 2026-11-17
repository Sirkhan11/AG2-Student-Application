// The offline part of refresh-gp-practices.mjs: reading NHS England's list of GP practices (the
// "epraccur" report from ODS Data Search and Export, Open Government Licence), keeping the active GP
// practices near the Newcastle city campus, and building src/lib/gp/gp-practices.json. Tested with
// made-up rows by check-gp-practices.mjs. Nothing here goes to the network.

export const REPORT_URL = 'https://www.odsdatasearchandexport.nhs.uk/api/getReport?report=epraccur';
export const POSTCODES_URL = 'https://api.postcodes.io/postcodes';
/** Says what's asking, so the services can tell it apart from people and other bots. */
export const USER_AGENT = 'AG2StudentApp-GP-refresh/1.0 (Northumbria University student project)';
/** The point distances are measured from. */
export const CENTRE = { name: 'Northumbria University city campus', postcode: 'NE1 8ST' };
/** How far from the campus the list goes, in a straight line. */
export const RADIUS_KM = 10;
/** Postcode areas that reach within 10 km of the campus: only practices in these are looked up. */
export const AREAS = ['NE', 'DH'];
/** Fewer practices than this means the report has probably changed (78 within 10 km in November 2026). */
export const MIN_PRACTICES = 60;
/** ODS's role code for a GP practice. Other roles in the report are out-of-hours services, prisons, walk-in centres and so on. */
export const GP_PRACTICE_ROLE = 'RO76';

/** Where things are in each row of the report (counting from 0). It has no header row. */
const COLUMN = { code: 0, name: 1, address: [4, 5, 6, 7, 8], postcode: 9, status: 12, phone: 17, role: 25 };

/**
 * @typedef {{ code: string, name: string, address: string, postcode: string, phone: string | null }} Practice
 * @typedef {Practice & { lat: number, lng: number }} PlacedPractice
 * @typedef {{ source: string, licence: string, dataFrom: string, centre: { name: string, postcode: string, lat: number, lng: number },
 *   radiusKm: number, count: number, practices: PlacedPractice[] }} PracticesFile
 */

/**
 * Splits CSV text into rows of fields. Handles quoted fields, "" inside them, and Windows line ends.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Words that stay lower case inside a name ("Newcastle upon Tyne", "Chester-le-Street"). */
const SMALL_WORDS = new Set(['and', 'of', 'the', 'upon', 'on', 'in', 'at', 'by', 'with', 'for', 'to', 'le']);
/** Short words that stay in capitals. */
const KEEP_CAPITALS = new Set(['NHS', 'GP', 'GPS', 'PCN', 'UK']);

/**
 * ODS writes names in capitals ("SAVILLE MEDICAL GROUP"); this gives "Saville Medical Group".
 * @param {string} raw
 */
export function tidyName(raw) {
  /** @param {string} part @param {boolean} first */
  const tidyPart = (part, first) => {
    if (/\d/.test(part) || KEEP_CAPITALS.has(part)) return part;
    const lower = part.toLowerCase();
    if (!first && SMALL_WORDS.has(lower)) return lower;
    // A capital after an apostrophe only when more than one letter follows (O'Brien, but Smith's).
    return lower.replace(/^([^a-z]*)([a-z])/, (_, before, letter) => before + letter.toUpperCase()).replace(/'([a-z])(?=[a-z])/g, (_, letter) => `'${letter.toUpperCase()}`);
  };
  return raw
    .trim()
    .split(/\s+/)
    .map((word, i) => word.split('-').map((part, j) => tidyPart(part, i === 0 && j === 0)).join('-'))
    .join(' ');
}

/** The letters a postcode starts with ("NE" for NE1 8DQ, "N" for N1 9GU). @param {string} postcode */
const areaOf = (postcode) => postcode.trim().toUpperCase().match(/^([A-Z]{1,2})\d/)?.[1] ?? '';

/**
 * The active GP practices in the given postcode areas, tidied.
 * @param {string[][]} rows the report's rows
 * @param {string[]} areas such as ['NE', 'DH']
 * @returns {Practice[]}
 */
export function activeGpPractices(rows, areas) {
  return rows
    .filter((row) => row[COLUMN.status] === 'ACTIVE' && row[COLUMN.role] === GP_PRACTICE_ROLE && areas.includes(areaOf(row[COLUMN.postcode] ?? '')))
    .map((row) => ({
      code: row[COLUMN.code].trim(),
      name: tidyName(row[COLUMN.name]),
      address: COLUMN.address.map((i) => row[i]?.trim()).filter(Boolean).map((line) => tidyName(/** @type {string} */ (line))).join(', '),
      postcode: row[COLUMN.postcode].trim().toUpperCase(),
      phone: row[COLUMN.phone]?.trim() || null
    }));
}

/**
 * The file the app reads: practices sorted by name, coordinates to 5 decimal places (about a metre).
 * @param {PlacedPractice[]} practices
 * @param {{ name: string, postcode: string, lat: number, lng: number }} centre
 * @param {string} dataFrom the day the report was downloaded, such as "2026-11-17"
 * @returns {PracticesFile}
 */
export function buildFile(practices, centre, dataFrom) {
  const round = (/** @type {number} */ n) => Math.round(n * 1e5) / 1e5;
  const sorted = [...practices].sort((a, b) => a.name.localeCompare(b.name, 'en-GB') || a.code.localeCompare(b.code));
  return {
    source: 'NHS England Organisation Data Service: GP practices (epraccur), from https://www.odsdatasearchandexport.nhs.uk/',
    licence:
      'Contains NHS England data, Open Government Licence v3.0. Coordinates from postcodes.io (ONS Postcode Directory): ' +
      'contains OS data © Crown copyright and database right; contains Royal Mail data © Royal Mail copyright and database right; ' +
      'contains National Statistics data © Crown copyright and database right.',
    dataFrom,
    centre: { ...centre, lat: round(centre.lat), lng: round(centre.lng) },
    radiusKm: RADIUS_KM,
    count: sorted.length,
    practices: sorted.map((practice) => ({ ...practice, lat: round(practice.lat), lng: round(practice.lng) }))
  };
}

/**
 * True if the two files hold the same practices (the download date doesn't count).
 * @param {PracticesFile | null} a
 * @param {PracticesFile} b
 */
export function sameList(a, b) {
  if (!a) return false;
  const strip = (/** @type {PracticesFile} */ file) => JSON.stringify({ ...file, dataFrom: null });
  return strip(a) === strip(b);
}

/**
 * What changed since the last file, by ODS code.
 * @param {PracticesFile | null} last
 * @param {PracticesFile} next
 */
export function listChanges(last, next) {
  const before = new Map((last?.practices ?? []).map((practice) => [practice.code, JSON.stringify(practice)]));
  const after = new Map(next.practices.map((practice) => [practice.code, JSON.stringify(practice)]));
  return {
    added: [...after.keys()].filter((code) => !before.has(code)),
    removed: [...before.keys()].filter((code) => !after.has(code)),
    changed: [...after.keys()].filter((code) => before.has(code) && before.get(code) !== after.get(code))
  };
}

/**
 * Reasons not to write the file: too few practices, or too many postcodes postcodes.io couldn't place.
 * @param {{ kept: number, candidates: number, unplaced: number }} counts
 */
export function checkBeforeWriting({ kept, candidates, unplaced }) {
  const problems = [];
  if (kept < MIN_PRACTICES) problems.push(`only ${kept} practices within ${RADIUS_KM} km (at least ${MIN_PRACTICES} expected), so the report may have changed`);
  if (candidates > 0 && unplaced / candidates > 0.05) problems.push(`postcodes.io couldn't place ${unplaced} of ${candidates} postcodes`);
  return problems;
}
