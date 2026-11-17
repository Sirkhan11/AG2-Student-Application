// Refreshes src/lib/gp/gp-practices.json, the GP surgeries the GP finder shows: every active GP
// practice within 10 km of the Newcastle city campus, with its NHS England (ODS) code, name, address,
// postcode, phone number and coordinates.
// - 1 request to ODS Data Search and Export for the "epraccur" report (every GP practice in England,
//   Open Government Licence, no key). Only active practices with the GP practice role (RO76) are kept,
//   so out-of-hours services, walk-in centres and prisons are left out.
// - postcodes.io for coordinates, 100 postcodes a request (2 requests for the NE and DH areas), no key.
//   These are surgeries' postcodes only: a student's location is never sent anywhere.
// It writes the file only if the list changed, and stops without writing if a request fails or the
// list looks wrong (see checkBeforeWriting in lib/gp-practices.mjs). It prints counts and which
// practices changed, by ODS code.
//
// Run from the project folder (a few seconds):
//   node scripts/refresh-gp-practices.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm } from '../src/lib/gp/distance.js';
import {
  activeGpPractices, AREAS, buildFile, CENTRE, checkBeforeWriting, listChanges, parseCsv, POSTCODES_URL, RADIUS_KM,
  REPORT_URL, sameList, USER_AGENT
} from './lib/gp-practices.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(REPO, 'src/lib/gp/gp-practices.json');

/**
 * Stops the run without writing anything.
 * @param {string} reason
 * @returns {never}
 */
function stop(reason) {
  console.log(`\nStopped, and nothing was written: ${reason}`);
  process.exit(1);
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function request(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    return stop(`${new URL(url).host} didn't answer (${/** @type {Error} */ (err).name})`);
  }
  if (!response.ok) stop(`${new URL(url).host} answered ${response.status}`);
  return response;
}

console.log('Downloading NHS England\'s list of GP practices (ODS epraccur report)...');
const rows = parseCsv(await (await request(REPORT_URL)).text());
const candidates = activeGpPractices(rows, AREAS);
console.log(`  ${rows.length} rows; ${candidates.length} active GP practices in the ${AREAS.join(' and ')} postcode areas.`);

const postcodes = [...new Set([CENTRE.postcode, ...candidates.map((practice) => practice.postcode)])];
/** @type {Map<string, { lat: number, lng: number }>} */
const places = new Map();
for (let i = 0; i < postcodes.length; i += 100) {
  await new Promise((done) => setTimeout(done, 1000));
  const reply = await (await request(POSTCODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postcodes: postcodes.slice(i, i + 100) })
  })).json();
  for (const found of reply.result ?? []) {
    if (found.result) places.set(found.query.toUpperCase(), { lat: found.result.latitude, lng: found.result.longitude });
  }
}
const centre = places.get(CENTRE.postcode);
if (!centre) stop(`postcodes.io couldn't place the campus postcode ${CENTRE.postcode}`);

const placed = candidates.filter((practice) => places.has(practice.postcode)).map((practice) => ({ ...practice, .../** @type {{ lat: number, lng: number }} */ (places.get(practice.postcode)) }));
const unplaced = candidates.length - placed.length;
const kept = placed.filter((practice) => distanceKm(centre.lat, centre.lng, practice.lat, practice.lng) <= RADIUS_KM);
console.log(`  postcodes.io placed ${placed.length} (${unplaced} not found); ${kept.length} within ${RADIUS_KM} km of ${CENTRE.postcode}.`);

const problems = checkBeforeWriting({ kept: kept.length, candidates: candidates.length, unplaced });
if (problems.length) stop(problems.join('; '));

/** @type {import('./lib/gp-practices.mjs').PracticesFile | null} */
const last = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
const file = buildFile(kept, { ...CENTRE, ...centre }, new Date().toISOString().slice(0, 10));
const { added, removed, changed } = listChanges(last, file);
console.log(`\nChanges since the last list: ${added.length} new, ${removed.length} gone, ${changed.length} changed.`);
if (added.length) console.log(`  New: ${added.join(', ')}`);
if (removed.length) console.log(`  Gone: ${removed.join(', ')}`);
if (changed.length) console.log(`  Changed: ${changed.join(', ')}`);
if (sameList(last, file)) {
  console.log('gp-practices.json: unchanged, so left as it is.');
} else {
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  console.log('gp-practices.json: updated. Check the change with git diff before committing it.');
}
