// Refreshes the GP finder's two lists:
// - src/lib/gp/gp-practices.json: every active GP practice in the NE, DH and SR postcode areas (Tyne
//   and Wear, Northumberland and County Durham), with its NHS England (ODS) code, name, address,
//   postcode, coordinates, and the phone number, email address and website from its page on the NHS
//   website. It's part of the page.
// - static/gp/england.tsv: every active GP practice in England, compact (code, name, first address line
//   and town, postcode, phone, coordinates), which the page loads only when a search lands outside the
//   North East list. The request is the same for everyone.
// How:
// - 1 request to ODS Data Search and Export for the "epraccur" report (Open Government Licence, no
//   key). Only active practices with the GP practice role (RO76) in an NHS England region are kept, so
//   out-of-hours services, walk-in centres, prisons and Wales's practices are left out.
// - postcodes.io for coordinates, 100 postcodes a request (about 60 requests), no key. These are
//   surgeries' postcodes only: a student's location is never sent anywhere.
// - Each North East practice's "contact details and opening times" page on the NHS website, one every
//   1.5 to 2.5 seconds (about 200 pages, 7 minutes; robots.txt allows them). An email address is kept
//   only if it looks like the practice's own mailbox (isPracticeMailbox); one that might be a person's
//   is left out, and only counted. --reuse-contacts skips these pages and keeps the contacts from the
//   last gp-practices.json (for a quick rebuild).
// It writes a file only if it changed, and stops without writing if a request fails, a site refuses or
// challenges it, or a list looks wrong. It prints counts, sizes and which practices changed (by ODS
// code), never an email address.
//
// Run from the project folder:
//   node scripts/refresh-gp-practices.mjs [--reuse-contacts]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { blockedReason, maskEmails } from './lib/nsu-collect.mjs';
import {
  activeGpPractices, AREAS, buildFile, CENTRE, checkBeforeWriting, contactPageUrl, englandBody, englandFile, isPracticeMailbox,
  listChanges, parseContactPage, parseCsv, POSTCODES_URL, REPORT_URL, sameList, USER_AGENT
} from './lib/gp-practices.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(REPO, 'src/lib/gp/gp-practices.json');
const ENGLAND_FILE = resolve(REPO, 'static/gp/england.tsv');
/** Fewer practices in England than this means the report has probably changed (6,157 in November 2026). */
const MIN_ENGLAND = 5500;
const reuseContacts = process.argv.includes('--reuse-contacts');
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
/** Prints a line, masking anything shaped like an email address as a last guard. */
const say = (text = '') => console.log(maskEmails(text));

/**
 * Stops the run without writing anything.
 * @param {string} reason
 * @returns {never}
 */
function stop(reason) {
  say(`\nStopped, and nothing was written: ${reason}`);
  process.exit(1);
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ okIfMissing?: boolean }} [options]
 */
async function request(url, init = {}, { okIfMissing = false } = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    return stop(`${new URL(url).host} didn't answer (${/** @type {Error} */ (err).name})`);
  }
  if (okIfMissing && response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    stop(`${new URL(url).host} ${blockedReason(response.status, response.headers, body) ?? `answered ${response.status}`}. The script doesn't try to get round that.`);
  }
  return response;
}

/** @type {import('./lib/gp-practices.mjs').PracticesFile | null} */
const last = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;

say('Downloading NHS England\'s list of GP practices (ODS epraccur report)...');
const rows = parseCsv(await (await /** @type {Promise<Response>} */ (request(REPORT_URL))).text());
const england = activeGpPractices(rows);
const northEast = new Set(activeGpPractices(rows, AREAS).map((practice) => practice.code));
say(`  ${rows.length} rows; ${england.length} active GP practices in England, ${northEast.size} of them in ${AREAS.join(', ')}.`);
if (england.length < MIN_ENGLAND) stop(`only ${england.length} practices in England (at least ${MIN_ENGLAND} expected), so the report may have changed`);

const postcodes = [...new Set([CENTRE.postcode, ...england.map((practice) => practice.postcode)])];
say(`Placing ${postcodes.length} postcodes with postcodes.io, 100 at a time...`);
/** @type {Map<string, { lat: number, lng: number }>} */
const places = new Map();
for (let i = 0; i < postcodes.length; i += 100) {
  await sleep(1000);
  const reply = await (await /** @type {Promise<Response>} */ (request(POSTCODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postcodes: postcodes.slice(i, i + 100) })
  }))).json();
  for (const found of reply.result ?? []) {
    if (found.result) places.set(found.query.toUpperCase(), { lat: found.result.latitude, lng: found.result.longitude });
  }
}
const centre = places.get(CENTRE.postcode);
if (!centre) stop(`postcodes.io couldn't place the campus postcode ${CENTRE.postcode}`);
const placed = england.filter((practice) => places.has(practice.postcode)).map((practice) => ({ ...practice, ...(/** @type {{ lat: number, lng: number }} */ (places.get(practice.postcode))) }));
const unplaced = england.length - placed.length;
say(`  Placed ${placed.length} practices (${unplaced} postcodes not found).`);
if (unplaced / england.length > 0.05) stop(`postcodes.io couldn't place ${unplaced} of ${england.length} practices`);

// The North East list, with each practice's contacts from its NHS page.
const local = placed.filter((practice) => northEast.has(practice.code));
const counts = { phones: 0, emails: 0, emailsLeftOut: 0, websites: 0, missing: 0 };
/** @type {Map<string, import('./lib/gp-practices.mjs').PlacedPractice>} */
const lastByCode = new Map((last?.practices ?? []).map((practice) => [practice.code, practice]));
say(reuseContacts
  ? `Keeping the contacts from the last list for ${local.length} North East practices (--reuse-contacts).`
  : `Reading ${local.length} contact pages on the NHS website, 1.5 to 2.5 seconds apart (about ${Math.ceil((local.length * 2) / 60)} minutes)...`);
/** @type {import('./lib/gp-practices.mjs').PlacedPractice[]} */
const kept = [];
for (const [i, practice] of local.entries()) {
  /** @type {import('./lib/gp-practices.mjs').Contact} */
  let contact;
  if (reuseContacts) {
    const before = lastByCode.get(practice.code);
    contact = { phone: before?.phone ?? null, email: before?.email ?? null, website: before?.website ?? null };
    if (!before) counts.missing++;
  } else {
    await sleep(1500 + Math.floor(Math.random() * 1000));
    const response = await request(contactPageUrl(practice.code), { headers: { Accept: 'text/html' } }, { okIfMissing: true });
    contact = response ? parseContactPage(await response.text()) : { phone: null, email: null, website: null };
    if (!response) counts.missing++;
    if ((i + 1) % 25 === 0 || i + 1 === local.length) say(`  ${i + 1}/${local.length} contact pages read`);
  }
  let email = contact.email;
  if (email && !isPracticeMailbox(email, practice)) {
    email = null;
    counts.emailsLeftOut++;
  }
  const phone = contact.phone ?? practice.phone;
  if (phone) counts.phones++;
  if (email) counts.emails++;
  if (contact.website) counts.websites++;
  kept.push({ ...practice, phone, email, website: contact.website });
}
say(`  North East: ${kept.length} practices; with a phone number: ${counts.phones}; email: ${counts.emails} (${counts.emailsLeftOut} left out as they might be a person's); website: ${counts.websites}; contacts not found: ${counts.missing}.`);

const problems = checkBeforeWriting({ kept: kept.length, candidates: northEast.size, unplaced: northEast.size - local.length, contactsMissing: counts.missing });
if (problems.length) stop(problems.join('; '));

const today = new Date().toISOString().slice(0, 10);
const file = buildFile(kept, { ...CENTRE, ...centre }, today);
const { added, removed, changed } = listChanges(last, file);
say(`\nNorth East list: ${added.length} new, ${removed.length} gone, ${changed.length} changed.`);
if (sameList(last, file)) {
  say('gp-practices.json: unchanged, so left as it is.');
} else {
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  say('gp-practices.json: updated. Check the change with git diff before committing it.');
}

const englandText = englandFile(placed, today);
const size = (/** @type {number} */ bytes) => `${Math.round(bytes / 1024)} KB`;
say(`England file: ${placed.length} practices, ${size(Buffer.byteLength(englandText))} (${size(gzipSync(englandText, { level: 9 }).length)} gzipped).`);
if (existsSync(ENGLAND_FILE) && englandBody(readFileSync(ENGLAND_FILE, 'utf8')) === englandBody(englandText)) {
  say('england.tsv: unchanged, so left as it is.');
} else {
  mkdirSync(dirname(ENGLAND_FILE), { recursive: true });
  writeFileSync(ENGLAND_FILE, englandText);
  say('england.tsv: updated.');
}
