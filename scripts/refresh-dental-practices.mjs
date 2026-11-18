// Refreshes the two lists the finder's Dentist tab searches (src/lib/dentists/england.js says what they
// hold; scripts/lib/dental-practices.mjs builds them):
// - src/lib/dentists/north-east.json: the NHS dental practices in the NE, DH and SR postcode areas. It's
//   part of the page.
// - static/dentists/england.tsv: all of them in England, which the page loads only when a search lands
//   outside the North East. The request is the same for everyone.
// How:
// - 1 request to ODS Data Search and Export for the "egdpprac" report (Open Government Licence, no key).
//   Only active practices in an NHS England region are kept.
// - 1 request for the NHS website's list of its dentist pages (the sitemap its robots.txt names): only
//   practices with a page are kept, so every result's "NHS page" link works. About a third of the
//   report's active practices have none, and NHS Find a dentist doesn't list them either.
// - postcodes.io for coordinates, 100 postcodes a request (about 65 requests), no key. These are the
//   practices' postcodes only: a student's location is never sent anywhere.
// It writes a file only if it changed, and stops without writing if a request fails, a site refuses or
// challenges it, or a list looks wrong. It prints counts and sizes, never names or addresses.
//
// Run from the project folder:
//   node scripts/refresh-dental-practices.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { blockedReason } from './lib/nsu-collect.mjs';
import { POSTCODES_URL } from './lib/gp-practices.mjs';
import {
  activeDentalPractices, AREAS, checkDentistsBeforeWriting, DENTAL_REPORT_URL, DENTAL_USER_AGENT, DENTIST_SITEMAP_URL, englandDentistBody,
  englandDentistFile, hasNhsPage, listedOnNhs, northEastFile, parseCsv, sameNorthEast
} from './lib/dental-practices.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(REPO, 'src/lib/dentists/north-east.json');
const ENGLAND_FILE = resolve(REPO, 'static/dentists/england.tsv');
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Stops the run without writing anything.
 * @param {string} reason
 * @returns {never}
 */
function stop(reason) {
  console.log(`\nStopped, and nothing was written: ${reason}`);
  process.exit(1);
}

/** @param {string} url @param {RequestInit} [init] */
async function request(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, headers: { 'User-Agent': DENTAL_USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    return stop(`${new URL(url).host} didn't answer (${/** @type {Error} */ (err).name})`);
  }
  if (!response.ok) {
    const body = await response.text();
    stop(`${new URL(url).host} ${blockedReason(response.status, response.headers, body) ?? `answered ${response.status}`}. The script doesn't try to get round that.`);
  }
  return response;
}

/** @type {import('./lib/dental-practices.mjs').NorthEastFile | null} */
const last = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;

console.log('Downloading NHS England\'s list of dental practices (ODS egdpprac report)...');
const rows = parseCsv(await (await request(DENTAL_REPORT_URL)).text());
const active = activeDentalPractices(rows);
console.log(`  ${rows.length} rows; ${active.length} active dental practices in England.`);

await sleep(1000);
console.log('Downloading the NHS website\'s list of its dentist pages...');
const listed = listedOnNhs(await (await request(DENTIST_SITEMAP_URL, { headers: { Accept: 'application/xml' } })).text());
const england = active.filter((practice) => hasNhsPage(practice, listed));
console.log(`  ${listed.size} dentist pages; ${england.length} of the active practices have one (${active.length - england.length} don't, so they're left out).`);

const postcodes = [...new Set(england.map((practice) => practice.postcode))];
console.log(`Placing ${postcodes.length} postcodes with postcodes.io, 100 at a time...`);
/** @type {Map<string, { lat: number, lng: number }>} */
const places = new Map();
for (let i = 0; i < postcodes.length; i += 100) {
  await sleep(1000);
  const reply = await (await request(POSTCODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postcodes: postcodes.slice(i, i + 100) })
  })).json();
  for (const found of reply.result ?? []) {
    if (found.result) places.set(found.query.toUpperCase(), { lat: found.result.latitude, lng: found.result.longitude });
  }
}
const placed = england.filter((practice) => places.has(practice.postcode)).map((practice) => ({ ...practice, ...(/** @type {{ lat: number, lng: number }} */ (places.get(practice.postcode))) }));
const unplaced = england.length - placed.length;
console.log(`  Placed ${placed.length} practices (${unplaced} postcodes not found).`);

const northEastCodes = new Set(activeDentalPractices(rows, AREAS).map((practice) => practice.code));
const local = placed.filter((practice) => northEastCodes.has(practice.code));
console.log(`  North East (${AREAS.join(', ')}): ${local.length} practices.`);

const problems = checkDentistsBeforeWriting({ listed: listed.size, england: placed.length, northEast: local.length, candidates: england.length, unplaced });
if (problems.length) stop(problems.join('; '));

const today = new Date().toISOString().slice(0, 10);
const file = northEastFile(local, today);
if (sameNorthEast(last, file)) console.log('north-east.json: unchanged, so left as it is.');
else {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`north-east.json: ${last ? 'updated' : 'written'}. Check the change with git diff before committing it.`);
}

const englandText = englandDentistFile(placed, today);
const size = (/** @type {number} */ bytes) => `${Math.round(bytes / 1024)} KB`;
console.log(`England file: ${placed.length} practices, ${size(Buffer.byteLength(englandText))} (${size(gzipSync(englandText, { level: 9 }).length)} gzipped).`);
if (existsSync(ENGLAND_FILE) && englandDentistBody(readFileSync(ENGLAND_FILE, 'utf8')) === englandDentistBody(englandText)) {
  console.log('england.tsv: unchanged, so left as it is.');
} else {
  mkdirSync(dirname(ENGLAND_FILE), { recursive: true });
  writeFileSync(ENGLAND_FILE, englandText);
  console.log('england.tsv: written.');
}
