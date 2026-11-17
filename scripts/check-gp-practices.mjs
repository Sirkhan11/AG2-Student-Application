// Checks the GP finder's data and sums, offline: the list (src/lib/gp/gp-practices.json) loads with
// coordinates and only holds active GP practices near the campus; refresh-gp-practices.mjs's reading
// and tidying, with made-up rows; finding the nearest surgeries, with made-up practices; the NHS links;
// and, from the page's source, that a location is never stored or sent (the browser check,
// check-gp-finder-privacy.mjs, proves that in Chrome). Nothing here goes to the network.
//
// Run from the project folder:
//   node scripts/check-gp-practices.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import data from '#lib/gp/gp-practices.json' with { type: 'json' };
import { distanceKm } from '#lib/gp/distance.js';
import {
  distanceText, findADentistUrl, findAGpUrl, isPostcode, nearestPractices, normalisePostcode, practicePageUrl, PRACTICES, telHref
} from '#lib/gp/finder.js';
import {
  activeGpPractices, buildFile, checkBeforeWriting, GP_PRACTICE_ROLE, listChanges, MIN_PRACTICES, parseCsv, RADIUS_KM, sameList, tidyName
} from './lib/gp-practices.mjs';

const PAGE = readFileSync('src/routes/gp-finder/+page.svelte', 'utf8');
const SCRIPT = PAGE.slice(PAGE.indexOf('<script>'), PAGE.indexOf('</script>'));

/** A row shaped like the ODS epraccur report (27 columns), made up. */
const row = (/** @type {Record<string, string>} */ fields) => {
  const cells = Array(27).fill('');
  const at = { code: 0, name: 1, a1: 4, a2: 5, a3: 6, a4: 7, a5: 8, postcode: 9, status: 12, phone: 17, role: 25 };
  for (const [key, value] of Object.entries(fields)) cells[/** @type {number} */ (at[/** @type {keyof typeof at} */ (key)])] = value;
  return cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');
};
const CSV = [
  row({ code: 'A99001', name: 'MADE-UP MEDICAL GROUP', a1: '1 PRETEND STREET', a4: 'NEWCASTLE UPON TYNE', postcode: 'NE1 1AA', status: 'ACTIVE', phone: '0191 0000001', role: GP_PRACTICE_ROLE }),
  row({ code: 'A99002', name: 'THE "QUOTED", SURGERY', a1: 'FLAT 2A, OLD ROAD', a4: 'CHESTER-LE-STREET', postcode: 'dh3 1aa', status: 'ACTIVE', role: GP_PRACTICE_ROLE }),
  row({ code: 'A99003', name: 'CLOSED SURGERY', postcode: 'NE2 1AA', status: 'INACTIVE', role: GP_PRACTICE_ROLE }),
  row({ code: 'A99004', name: 'OUT OF HOURS SERVICE', postcode: 'NE3 1AA', status: 'ACTIVE', role: 'RO80' }),
  row({ code: 'A99005', name: 'LONDON PRACTICE', postcode: 'N1 1AA', status: 'ACTIVE', role: GP_PRACTICE_ROLE })
].join('\r\n') + '\r\n';

/** Made-up practices around a made-up centre. */
const CENTRE = { lat: 54.97, lng: -1.6 };
const MADE_UP = [
  { code: 'A00001', name: 'Far', address: '', postcode: 'NE1 1AA', phone: null, lat: 55.02, lng: -1.6 },
  { code: 'A00002', name: 'Near', address: '', postcode: 'NE1 1AB', phone: null, lat: 54.971, lng: -1.6 },
  { code: 'A00003', name: 'Middle', address: '', postcode: 'NE1 1AD', phone: null, lat: 54.99, lng: -1.6 }
];

/** @type {[string, () => void][]} */
const checks = [
  ['The list loads: active GP practices with coordinates, all within 10 km of the city campus, no repeats', () => {
    assert.ok(data.count >= MIN_PRACTICES, `only ${data.count}`);
    assert.equal(data.count, PRACTICES.length);
    assert.equal(data.centre.postcode, 'NE1 8ST');
    assert.equal(data.radiusKm, RADIUS_KM);
    assert.equal(new Set(PRACTICES.map((practice) => practice.code)).size, PRACTICES.length);
    for (const practice of PRACTICES) {
      assert.match(practice.code, /^[A-Z]\d{5}$/, practice.name);
      assert.ok(practice.name && practice.address, practice.code);
      assert.ok(isPostcode(practice.postcode), `${practice.code} postcode`);
      assert.ok(Number.isFinite(practice.lat) && Number.isFinite(practice.lng), `${practice.code} has no coordinates`);
      assert.ok(distanceKm(data.centre.lat, data.centre.lng, practice.lat, practice.lng) <= RADIUS_KM + 0.01, `${practice.code} is too far`);
    }
    assert.match(data.dataFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(data.licence, /Open Government Licence/);
    assert.ok(!JSON.stringify(data).includes('@'), 'no email addresses');
  }],
  ['Reading the report: quoted fields, commas and quotes inside them, Windows line ends', () => {
    const rows = parseCsv(CSV);
    assert.equal(rows.length, 5);
    assert.ok(rows.every((cells) => cells.length === 27));
    assert.equal(rows[1][1], 'THE "QUOTED", SURGERY');
  }],
  ['Only active GP practices (role RO76) in the NE and DH areas: not closed ones, out-of-hours services or London\'s N area', () => {
    assert.deepEqual(activeGpPractices(parseCsv(CSV), ['NE', 'DH']), [
      { code: 'A99001', name: 'Made-Up Medical Group', address: '1 Pretend Street, Newcastle upon Tyne', postcode: 'NE1 1AA', phone: '0191 0000001' },
      { code: 'A99002', name: 'The "Quoted", Surgery', address: 'Flat 2A, Old Road, Chester-le-Street', postcode: 'DH3 1AA', phone: null }
    ]);
  }],
  ['Names in capitals are tidied', () => {
    assert.equal(tidyName('SAVILLE MEDICAL GROUP'), 'Saville Medical Group');
    assert.equal(tidyName('THE GROVE MEDICAL CENTRE'), 'The Grove Medical Centre');
    assert.equal(tidyName("ST. GEORGE'S SURGERY"), "St. George's Surgery");
    assert.equal(tidyName("DR O'BRIEN AND PARTNERS"), "Dr O'Brien and Partners");
    assert.equal(tidyName('UNIT 4B NHS HEALTH CENTRE'), 'Unit 4B NHS Health Centre');
  }],
  ['The file: sorted by name, coordinates to 5 places, and the download date doesn\'t count as a change', () => {
    const file = buildFile([{ ...MADE_UP[2], lat: 54.9912345678 }, MADE_UP[1]], { name: 'Centre', postcode: 'NE1 8ST', ...CENTRE }, '2026-11-17');
    assert.deepEqual(file.practices.map((practice) => practice.name), ['Middle', 'Near']);
    assert.equal(file.practices[0].lat, 54.99123);
    assert.equal(sameList({ ...file, dataFrom: '2026-12-01' }, file), true);
    assert.deepEqual(listChanges({ ...file, practices: [file.practices[0], { ...MADE_UP[0] }] }, file), { added: ['A00002'], removed: ['A00001'], changed: [] });
    assert.deepEqual(checkBeforeWriting({ kept: 78, candidates: 169, unplaced: 0 }), []);
    assert.equal(checkBeforeWriting({ kept: 20, candidates: 169, unplaced: 0 }).length, 1);
    assert.equal(checkBeforeWriting({ kept: 78, candidates: 169, unplaced: 30 }).length, 1);
  }],
  ['The nearest surgeries, closest first, at most 5; a point outside the list\'s area gets none', () => {
    const near = nearestPractices(54.972, -1.6, { practices: MADE_UP, centre: CENTRE, radiusKm: 10 });
    assert.equal(near.inArea, true);
    assert.deepEqual(near.practices.map((practice) => practice.name), ['Near', 'Middle', 'Far']);
    assert.equal(nearestPractices(54.972, -1.6, { practices: MADE_UP, centre: CENTRE, radiusKm: 10, limit: 2 }).practices.length, 2);
    assert.deepEqual(nearestPractices(51.5, -0.14, { practices: MADE_UP, centre: CENTRE, radiusKm: 10 }), { inArea: false, practices: [] });
    assert.equal(nearestPractices(data.centre.lat, data.centre.lng).practices.length, 5, 'the real list gives 5 by the campus');
  }],
  ['Postcodes are tidied and checked before anything is looked up', () => {
    assert.equal(normalisePostcode(' ne18st '), 'NE1 8ST');
    assert.equal(normalisePostcode('sw1a1aa'), 'SW1A 1AA');
    assert.equal(isPostcode('NE1 8ST'), true);
    assert.equal(isPostcode('NE1'), false);
    assert.equal(isPostcode('NOT A POSTCODE'), false);
  }],
  ['NHS links: the surgery\'s page by its ODS code, and Find a GP and Find a dentist for the postcode (or the search page)', () => {
    assert.equal(practicePageUrl({ ...MADE_UP[1], name: "St. George's & Partners", code: 'A12345' }), 'https://www.nhs.uk/services/gp-surgery/st-georges-and-partners/A12345');
    assert.equal(findAGpUrl('NE1 8ST'), 'https://www.nhs.uk/service-search/find-a-gp/results?location=NE1%208ST');
    assert.equal(findAGpUrl(null), 'https://www.nhs.uk/service-search/find-a-gp/');
    assert.equal(findADentistUrl('NE1 8ST'), 'https://www.nhs.uk/service-search/find-a-dentist/results?location=NE1%208ST');
    assert.equal(findADentistUrl(undefined), 'https://www.nhs.uk/service-search/find-a-dentist/');
    assert.equal(distanceText(0.43), '450 m');
    assert.equal(distanceText(1.26), '1.3 km');
    assert.equal(telHref('0191 2324274'), 'tel:01912324274');
  }],
  ['The page never stores a location or sends it anywhere: one lookup, for a typed postcode only', () => {
    assert.doesNotMatch(PAGE, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    const imports = SCRIPT.match(/^\s*import [^;]+;/gm) ?? [];
    assert.ok(imports.length > 0);
    for (const line of imports) assert.doesNotMatch(line, /firebase|firestore|gemini|checkin|ai\.js/i, `no Firebase or Gemini on this page: ${line.trim()}`);
    const fetches = [...SCRIPT.matchAll(/fetch\((`[^`]*`|'[^']*'|[^)]*)/g)].map((m) => m[1]);
    assert.deepEqual(fetches, ['`https://api.postcodes.io/postcodes/${encodeURIComponent(wanted)}`']);
    // The phone's location goes straight into the sums and nowhere else.
    assert.match(SCRIPT, /showNearest\(position\.coords\.latitude, position\.coords\.longitude, null\)/);
    assert.equal([...SCRIPT.matchAll(/coords/g)].length, 2);
    for (const call of SCRIPT.match(/console\.\w+\([^)]*\)/g) ?? []) assert.doesNotMatch(call, /coords|position|lat|lng/i, call);
    assert.match(PAGE, /Your location stays on your phone: it isn’t saved or sent anywhere/);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
