// Checks the NHS dentist lists that the finder's Dentist tab searches (src/lib/dentists/), and how
// they're made (scripts/lib/dental-practices.mjs, run by refresh-dental-practices.mjs):
// 1. Made-up report rows: only active practices in England are kept, tidied, and by postcode area; the
//    England file reads back as it was written.
// 2. The real lists: enough practices; the North East's in NE, DH and SR with coordinates there; every
//    England one inside England, with a unique code; the North East's are in the England list too.
// 3. The links: each practice's NHS page (XV and the code's digits, six of them), NHS Find a dentist,
//    and the rest of the UK's own.
// 4. The search, on the phone: from Newcastle the North East list with nothing loaded; from London the
//    England list, loaded once (the same request for everyone); from Edinburgh, outside England. And the
//    location goes only into the sums: the dentist code never stores or sends it.
// Nothing here goes to the network. Run from the project folder:
//   node scripts/check-dental-practices.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DENTIST_COLUMNS, dentistPageUrl, newPatientsUrl, parseDentistFile } from '#lib/dentists/england.js';
import { DENTIST_FILE, DENTIST_NATIONS, DENTISTS, nearestDentists } from '#lib/dentists/finder.js';
import { findADentistUrl, OTHER_NATIONS } from '#lib/gp/finder.js';
import { activeDentalPractices, englandDentistFile, isSpecialist, MIN_ENGLAND_DENTISTS, MIN_NORTH_EAST_DENTISTS, northEastFile } from './lib/dental-practices.mjs';

const NORTH_EAST = JSON.parse(readFileSync('src/lib/dentists/north-east.json', 'utf8'));
const ENGLAND = parseDentistFile(readFileSync(`static${DENTIST_FILE}`, 'utf8'));
const FINDER = readFileSync('src/lib/dentists/finder.js', 'utf8');
const NEWCASTLE = { lat: 54.9739, lng: -1.6139 };
const LONDON = { lat: 51.5174, lng: -0.0739 };
const EDINBURGH = { lat: 55.9533, lng: -3.1883 };

/**
 * A row shaped like the ODS egdpprac report (27 columns, no header), made up.
 * @param {{ code?: string, name?: string, grouping?: string, postcode?: string, status?: string }} [row]
 */
function reportRow({ code = 'V00001', name = 'CRABTREE ROAD DENTAL PRACTICE', grouping = 'Y63', postcode = 'NE1 8ST', status = 'ACTIVE' } = {}) {
  const fields = Array(27).fill('');
  Object.assign(fields, { 0: code, 1: name, 2: grouping, 4: '25 CRABTREE ROAD', 7: 'NEWCASTLE UPON TYNE', 9: postcode, 12: status });
  return fields;
}

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  ['Made-up report rows: only active practices in an NHS England region with a V code, tidied, and by postcode area', () => {
    const rows = [
      reportRow(),
      reportRow({ code: 'V00002', status: 'INACTIVE' }),
      reportRow({ code: 'V00003', grouping: '' }),
      reportRow({ code: 'X99999' }),
      reportRow({ code: 'V123456', postcode: 'SW1A 1AA', name: 'SMILE STUDIO' })
    ];
    const england = activeDentalPractices(rows);
    assert.deepEqual(england.map((practice) => practice.code), ['V00001', 'V123456'], 'not closed ones, Wales\'s (no region) or other codes');
    assert.deepEqual(england[0], { code: 'V00001', name: 'Crabtree Road Dental Practice', address: '25 Crabtree Road, Newcastle upon Tyne', postcode: 'NE1 8ST' });
    assert.deepEqual(activeDentalPractices(rows, ['NE', 'DH', 'SR']).map((practice) => practice.code), ['V00001'], 'the North East\'s');
  }],
  ['Specialists a student can’t register with are left out by name (orthodontists, oral surgeons); hospitals, implant and community practices stay', () => {
    for (const name of ['Neo Orthodontics', 'Smile Orthodontist Ltd', 'Bright Orthodontic Practice', 'Tyne Oral Surgery', 'Maxillofacial Unit']) assert.ok(isSpecialist(name), name);
    for (const name of ['Saville Dental Practice', 'Newcastle Dental Hospital', 'Smile & Implant Centre', 'Community Dental Service']) assert.ok(!isSpecialist(name), name);
    assert.deepEqual(ENGLAND.filter((practice) => isSpecialist(practice.name)).map((practice) => practice.code), [], 'none in the real list');
    assert.match(readFileSync('src/routes/gp-finder/+page.svelte', 'utf8'), /leaving out orthodontists and oral surgeons, as you can’t register with them\./, 'the tab says so');
  }],
  ['The England file reads back as it was written: a note with the source and licence, the columns, then one practice a line', () => {
    const placed = [{ code: 'V00001', name: 'Crabtree Road Dental Practice', address: '25 Crabtree Road, Gosforth, Newcastle upon Tyne', postcode: 'NE1 8ST', lat: 54.97391, lng: -1.61393 }];
    const text = englandDentistFile(placed, '2026-11-18');
    assert.match(text.split('\n')[0], /^# NHS dental practices in England, 2026-11-18: NHS England Organisation Data Service \(egdpprac\), those with a page on the NHS website, Open Government Licence v3\.0\./);
    assert.equal(text.split('\n')[1], DENTIST_COLUMNS.join('\t'));
    assert.deepEqual(parseDentistFile(text), [{ code: 'V00001', name: 'Crabtree Road Dental Practice', address: '25 Crabtree Road, Newcastle upon Tyne', postcode: 'NE1 8ST', lat: 54.9739, lng: -1.6139, phone: null, email: null, website: null }]);
    assert.deepEqual(Object.keys(northEastFile(placed, '2026-11-18')), ['source', 'licence', 'dataFrom', 'areas', 'count', 'practices']);
  }],
  [`The real lists: at least ${MIN_NORTH_EAST_DENTISTS} North East practices in NE, DH and SR, at least ${MIN_ENGLAND_DENTISTS} in England, all inside England, codes unique, the North East's in the England list too`, () => {
    assert.equal(NORTH_EAST.count, NORTH_EAST.practices.length);
    assert.ok(DENTISTS.length >= MIN_NORTH_EAST_DENTISTS, `only ${DENTISTS.length} in the North East`);
    assert.ok(ENGLAND.length >= MIN_ENGLAND_DENTISTS, `only ${ENGLAND.length} in England`);
    for (const practice of DENTISTS) {
      assert.match(practice.postcode, /^(NE|DH|SR)\d/, practice.code);
      assert.ok(practice.lat > 54.4 && practice.lat < 55.9 && practice.lng > -2.8 && practice.lng < -0.9, `${practice.code} isn't in the North East`);
    }
    for (const practice of ENGLAND) {
      assert.match(practice.code, /^V\d{5,6}$/);
      assert.ok(practice.lat > 49.8 && practice.lat < 55.9 && practice.lng > -6.5 && practice.lng < 1.8, `${practice.code} isn't in England`);
      assert.ok(practice.name && practice.postcode, practice.code);
    }
    assert.equal(new Set(ENGLAND.map((practice) => practice.code)).size, ENGLAND.length, 'unique codes');
    const codes = new Set(ENGLAND.map((practice) => practice.code));
    assert.deepEqual(DENTISTS.filter((practice) => !codes.has(practice.code)).map((practice) => practice.code), []);
  }],
  ['The links: each practice’s NHS page by its code (V12345 is XV012345), NHS Find a dentist, and the rest of the UK’s own', () => {
    assert.equal(dentistPageUrl({ code: 'V12345' }), 'https://www.nhs.uk/services/dentist/dentist/XV012345');
    assert.equal(dentistPageUrl({ code: 'V123456' }), 'https://www.nhs.uk/services/dentist/dentist/XV123456');
    assert.equal(newPatientsUrl({ code: 'V12345' }), 'https://www.nhs.uk/services/dentist/dentist/XV012345/appointments', '"New NHS patients?" opens the appointments section');
    assert.equal(findADentistUrl('NE6'), 'https://www.nhs.uk/service-search/find-a-dentist/results?location=NE6');
    assert.equal(findADentistUrl(null), 'https://www.nhs.uk/service-search/find-a-dentist/');
    assert.deepEqual(Object.keys(DENTIST_NATIONS), Object.keys(OTHER_NATIONS), 'the same three nations as the GP tab');
    for (const link of Object.values(DENTIST_NATIONS)) assert.match(link.href, /^https:\/\//);
  }],
  ['On the phone: from Newcastle the North East list, nothing loaded; from London the England list, loaded once; from Edinburgh, outside England', async () => {
    let loads = 0;
    const load = async () => (loads++, ENGLAND);
    const near = await nearestDentists(NEWCASTLE.lat, NEWCASTLE.lng, { load });
    assert.equal(near.source, 'north-east');
    assert.equal(loads, 0, 'nothing loaded');
    assert.ok(near.practices.length >= 10 && near.practices[0].distanceKm < 2, 'dentists close by');
    assert.ok(near.practices.every((practice, i, all) => i === 0 || all[i - 1].distanceKm <= practice.distanceKm), 'closest first');
    const london = await nearestDentists(LONDON.lat, LONDON.lng, { load });
    assert.equal(london.source, 'england');
    assert.equal(loads, 1);
    assert.ok(london.practices[0].distanceKm < 2 && !london.farFromEngland);
    assert.equal((await nearestDentists(EDINBURGH.lat, EDINBURGH.lng, { load })).farFromEngland, true);
  }],
  ['The dentist code never stores or sends a location: one fetch, the England file, the same for everyone; the page uses the GP tab’s search with it', () => {
    assert.deepEqual([...FINDER.matchAll(/fetchImpl\(([^)]*)\)/g)].map((m) => m[1]), ['DENTIST_FILE']);
    assert.doesNotMatch(FINDER, /localStorage|sessionStorage|indexedDB|document\.cookie|coords|navigator/);
    const page = readFileSync('src/routes/gp-finder/+page.svelte', 'utf8');
    assert.match(page, /const dentists = new GpSearch\(\{ needsTyping: \(\) => dentistBox\?\.focus\(\), nearest: nearestDentists, words: DENTIST_WORDS \}\);/);
    const card = readFileSync('src/lib/components/GpFinderCard.svelte', 'utf8');
    assert.match(card, /new GpSearch\(\{ needsTyping: \(\) => box\?\.focus\(\), \.\.\.\(dentist \? \{ nearest: nearestDentists, words: DENTIST_WORDS \} : \{\}\) \}\)/, 'the chat’s dentist card too');
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
