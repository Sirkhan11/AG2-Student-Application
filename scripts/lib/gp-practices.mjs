// The offline part of refresh-gp-practices.mjs: reading NHS England's list of GP practices (the
// "epraccur" report from ODS Data Search and Export, Open Government Licence), keeping England's active
// GP practices, and building the two files the GP finder uses:
// - src/lib/gp/gp-practices.json: the North East list (NE, DH and SR postcode areas), with each
//   practice's phone, email and website from its page on the NHS website. It's part of the page.
// - static/gp/england.tsv: every active practice in England, compact, loaded only when a search lands
//   outside the North East list.
// Tested with made-up rows and pages by check-gp-practices.mjs. Nothing here goes to the network.

export const REPORT_URL = 'https://www.odsdatasearchandexport.nhs.uk/api/getReport?report=epraccur';
export const POSTCODES_URL = 'https://api.postcodes.io/postcodes';
/** Says what's asking, so the services can tell it apart from people and other bots. */
export const USER_AGENT = 'AG2StudentApp-GP-refresh/1.0 (Northumbria University student project)';
/** The campus, for the page's wording. */
export const CENTRE = { name: 'Northumbria University city campus', postcode: 'NE1 8ST' };
/**
 * The postcode areas the list covers: Tyne and Wear, Northumberland and County Durham (NE, DH, SR),
 * where Newcastle-campus students live. A search elsewhere gets NHS Find a GP instead.
 */
export const AREAS = ['NE', 'DH', 'SR'];
/** Fewer practices than this means the report has probably changed (202 in November 2026). */
export const MIN_PRACTICES = 150;
/** ODS's role code for a GP practice. Other roles in the report are out-of-hours services, prisons, walk-in centres and so on. */
export const GP_PRACTICE_ROLE = 'RO76';

/** Where things are in each row of the report (counting from 0). It has no header row. */
const COLUMN = { code: 0, name: 1, grouping: 2, address: [4, 5, 6, 7, 8], postcode: 9, status: 12, phone: 17, role: 25 };

/**
 * True for a practice in England: it sits in an NHS England region (national grouping Y56 to Y63).
 * The report also has Wales's practices (codes starting W, no grouping); the finder sends people in
 * Wales to Wales's own GP finder instead.
 * @param {string[]} row
 */
const inEngland = (row) => /^Y\d\d$/.test(row[COLUMN.grouping] ?? '');

/**
 * @typedef {{ code: string, name: string, address: string, postcode: string, phone: string | null }} Practice
 * @typedef {{ phone: string | null, email: string | null, website: string | null }} Contact
 * @typedef {Practice & Contact & { lat: number, lng: number }} PlacedPractice
 * @typedef {{ source: string, licence: string, dataFrom: string, centre: { name: string, postcode: string, lat: number, lng: number },
 *   areas: string[], count: number, practices: PlacedPractice[] }} PracticesFile
 */

/**
 * A practice's "contact details and opening times" page on the NHS website. The part before the
 * ODS code can be anything: the NHS website redirects to the right one.
 * @param {string} code
 */
export const contactPageUrl = (code) => `https://www.nhs.uk/services/gp-surgery/gp/${code}/contact-details-and-opening-times`;

/**
 * The phone number, email address and website from a practice's NHS contact page, or null for any
 * it doesn't give. The phone is as the page writes it ("0191 232 4274").
 * @param {string} html
 * @returns {Contact}
 */
export function parseContactPage(html) {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    href: (m[1].match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? '').replace(/&amp;/g, '&').trim(),
    text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }));
  const tel = links.find((link) => /^tel:/i.test(link.href));
  const mail = links.find((link) => /^mailto:/i.test(link.href));
  const site = links.find((link) => /website/i.test(link.text) && /^https?:\/\//i.test(link.href) && !/(^|\.)nhs\.uk\//i.test(link.href.replace(/^https?:\/\//i, '')));
  const digits = tel ? tel.href.replace(/^tel:/i, '').replace(/[^\d+]/g, '') : '';
  const shown = tel && tel.text.replace(/\D/g, '') === digits.replace(/^\+44/, '0') ? tel.text : digits;
  let email = null;
  if (mail) {
    try {
      email = decodeURIComponent(mail.href.replace(/^mailto:/i, '')).split('?')[0].trim().toLowerCase() || null;
    } catch {
      email = null;
    }
  }
  return { phone: shown || null, email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, website: site?.href ?? null };
}

/** Words that mark a shared mailbox rather than a person's own. */
const MAILBOX_WORDS = new Set(['practice', 'surgery', 'surgeries', 'medical', 'med', 'medicalcentre', 'reception', 'admin', 'administration', 'enquiries', 'enquiry', 'info', 'contact', 'patients', 'patient', 'gp', 'gps', 'health', 'healthcentre', 'centre', 'center', 'group', 'office', 'appointments', 'secretaries', 'team', 'mc', 'hc', 'nhs']);

/**
 * True if an email address looks like the practice's own mailbox (it names the practice, its ODS code,
 * or a word such as "reception"), not a person's. Anything else is left out of the public list.
 * @param {string} email
 * @param {{ code: string, name: string }} practice
 */
export function isPracticeMailbox(email, practice) {
  const local = email.split('@')[0].toLowerCase();
  if (local.includes(practice.code.toLowerCase())) return true;
  const parts = local.split(/[._+-]+/).map((part) => part.replace(/\d+$/, '')).filter(Boolean);
  const nameWords = new Set(practice.name.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 4));
  return parts.some((part) => MAILBOX_WORDS.has(part) || nameWords.has(part) || [...nameWords].some((word) => part.startsWith(word) || word.startsWith(part) && part.length >= 5));
}

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
 * England's active GP practices, tidied: all of them, or those in the given postcode areas.
 * @param {string[][]} rows the report's rows
 * @param {string[] | null} [areas] such as ['NE', 'DH']; null for all of England
 * @returns {Practice[]}
 */
export function activeGpPractices(rows, areas = null) {
  return rows
    .filter((row) => row[COLUMN.status] === 'ACTIVE' && row[COLUMN.role] === GP_PRACTICE_ROLE && inEngland(row))
    .filter((row) => !areas || areas.includes(areaOf(row[COLUMN.postcode] ?? '')))
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
    source:
      'NHS England Organisation Data Service: GP practices (epraccur), from https://www.odsdatasearchandexport.nhs.uk/. ' +
      'Phone numbers, email addresses and websites from each practice\'s contact page on the NHS website (nhs.uk).',
    licence:
      'Contains NHS England data, Open Government Licence v3.0. Coordinates from postcodes.io (ONS Postcode Directory): ' +
      'contains OS data © Crown copyright and database right; contains Royal Mail data © Royal Mail copyright and database right; ' +
      'contains National Statistics data © Crown copyright and database right.',
    dataFrom,
    centre: { ...centre, lat: round(centre.lat), lng: round(centre.lng) },
    areas: AREAS,
    count: sorted.length,
    practices: sorted.map((practice) => ({ ...practice, lat: round(practice.lat), lng: round(practice.lng) }))
  };
}

/** The first address line and the town, for the compact England file: "Lawson Street, Stockton-on-Tees". @param {string} address */
export function shortAddress(address) {
  const parts = address.split(', ').filter(Boolean);
  return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : address;
}

/**
 * The all-England file (static/gp/england.tsv, read by src/lib/gp/england.js): a note line, the
 * column names, then one practice per line, tab-separated, sorted by ODS code, coordinates to 4
 * places (about 10 m).
 * @param {PlacedPractice[]} practices
 * @param {string} dataFrom
 */
export function englandFile(practices, dataFrom) {
  const clean = (/** @type {unknown} */ value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const lines = [...practices]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => [p.code, p.name, shortAddress(p.address), p.postcode, p.phone ?? '', p.lat.toFixed(4), p.lng.toFixed(4)].map(clean).join('\t'));
  return [
    `# GP practices in England, ${dataFrom}: NHS England Organisation Data Service (epraccur), Open Government Licence v3.0. ` +
      'Coordinates from postcodes.io (ONS Postcode Directory): contains OS data © Crown copyright and database right; ' +
      'contains Royal Mail data © Royal Mail copyright and database right; contains National Statistics data © Crown copyright and database right.',
    ['code', 'name', 'address', 'postcode', 'phone', 'lat', 'lng'].join('\t'),
    ...lines
  ].join('\n') + '\n';
}

/** The England file's text without its dated note line, to see whether anything really changed. @param {string} text */
export const englandBody = (text) => text.split('\n').filter((line) => !line.startsWith('#')).join('\n');

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
 * Reasons not to write the file: too few practices, too many postcodes postcodes.io couldn't place,
 * or too many contact pages that didn't read.
 * @param {{ kept: number, candidates: number, unplaced: number, contactsMissing?: number }} counts
 */
export function checkBeforeWriting({ kept, candidates, unplaced, contactsMissing = 0 }) {
  const problems = [];
  if (kept < MIN_PRACTICES) problems.push(`only ${kept} practices in ${AREAS.join(', ')} (at least ${MIN_PRACTICES} expected), so the report may have changed`);
  if (candidates > 0 && unplaced / candidates > 0.05) problems.push(`postcodes.io couldn't place ${unplaced} of ${candidates} postcodes`);
  if (kept > 0 && contactsMissing / kept > 0.1) problems.push(`${contactsMissing} of ${kept} NHS contact pages didn't read, so the NHS website may have changed`);
  return problems;
}
