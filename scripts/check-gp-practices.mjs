// Checks the GP finder's data and sums, offline: the North East list (src/lib/gp/gp-practices.json)
// and the all-England file (static/gp/england.tsv) load and hold what they should; refresh-gp-practices
// .mjs's reading, tidying and contact pages, with made-up rows and pages; what a search box entry
// means; place choices; the nearest surgeries anywhere, from the right list; the links for the rest of
// the UK; and, from the page's source, that a location is never stored or sent (check-gp-finder-
// privacy.mjs proves that in Chrome). Nothing here goes to the network, except with --links, which
// opens the outside-England GP finders and NHS Find a GP to check they answer.
//
// Run from the project folder:
//   node scripts/check-gp-practices.mjs [--links]

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import data from '#lib/gp/gp-practices.json' with { type: 'json' };
import { parseEnglandFile } from '#lib/gp/england.js';
import {
  AREAS, BEYOND_ENGLAND_KM, classifySearch, distanceText, ENGLAND_FILE, findADentistUrl, findAGpUrl, isPostcode, nearestAnywhere, nearestIn,
  NORTH_EAST_KM, normalisePostcode, OTHER_NATIONS, placeChoices, practicePageUrl, PRACTICES, telHref
} from '#lib/gp/finder.js';
import {
  activeGpPractices, buildFile, checkBeforeWriting, englandBody, englandFile, GP_PRACTICE_ROLE, isPracticeMailbox, listChanges, MIN_PRACTICES,
  parseContactPage, parseCsv, sameList, shortAddress, tidyName
} from './lib/gp-practices.mjs';

const PAGE = readFileSync('src/routes/gp-finder/+page.svelte', 'utf8');
const SCRIPT = PAGE.slice(PAGE.indexOf('<script>'), PAGE.indexOf('</script>'));
/** The search itself, shared by the page and the chat's GP card. */
const SEARCH = readFileSync('src/lib/gp/search.svelte.js', 'utf8');
const ENGLAND_TEXT = readFileSync('static/gp/england.tsv', 'utf8');
const ENGLAND = parseEnglandFile(ENGLAND_TEXT);

/** A row shaped like the ODS epraccur report (27 columns), made up. */
const row = (/** @type {Record<string, string>} */ fields) => {
  const cells = Array(27).fill('');
  const at = { code: 0, name: 1, grouping: 2, a1: 4, a2: 5, a3: 6, a4: 7, a5: 8, postcode: 9, status: 12, phone: 17, role: 25 };
  for (const [key, value] of Object.entries(fields)) cells[/** @type {number} */ (at[/** @type {keyof typeof at} */ (key)])] = value;
  return cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');
};
const CSV = [
  row({ code: 'A99001', name: 'MADE-UP MEDICAL GROUP', grouping: 'Y63', a1: '1 PRETEND STREET', a4: 'NEWCASTLE UPON TYNE', postcode: 'NE1 1AA', status: 'ACTIVE', phone: '0191 0000001', role: GP_PRACTICE_ROLE }),
  row({ code: 'A99002', name: 'THE "QUOTED", SURGERY', grouping: 'Y63', a1: 'FLAT 2A, OLD ROAD', a4: 'CHESTER-LE-STREET', postcode: 'dh3 1aa', status: 'ACTIVE', role: GP_PRACTICE_ROLE }),
  row({ code: 'A99003', name: 'CLOSED SURGERY', grouping: 'Y63', postcode: 'NE2 1AA', status: 'INACTIVE', role: GP_PRACTICE_ROLE }),
  row({ code: 'A99004', name: 'OUT OF HOURS SERVICE', grouping: 'Y63', postcode: 'NE3 1AA', status: 'ACTIVE', role: 'RO80' }),
  row({ code: 'A99005', name: 'LONDON PRACTICE', grouping: 'Y56', a1: '5 MADE UP ROAD', a4: 'LONDON', postcode: 'N1 1AA', status: 'ACTIVE', role: GP_PRACTICE_ROLE }),
  row({ code: 'W99006', name: 'WELSH PRACTICE', grouping: '', postcode: 'CF10 1AA', status: 'ACTIVE', role: GP_PRACTICE_ROLE })
].join('\r\n') + '\r\n';

/** Made-up practices: three around Newcastle, one in London. */
const NORTH_EAST = [
  { code: 'A00001', name: 'Far', address: '', postcode: 'NE1 1AA', phone: null, email: null, website: null, lat: 55.02, lng: -1.6 },
  { code: 'A00002', name: 'Near', address: '', postcode: 'NE1 1AB', phone: null, email: null, website: null, lat: 54.971, lng: -1.6 },
  { code: 'A00003', name: 'Middle', address: '', postcode: 'NE1 1AD', phone: null, email: null, website: null, lat: 54.99, lng: -1.6 }
];
const MADE_UP_ENGLAND = [...NORTH_EAST, { code: 'A00004', name: 'Aldgate', address: '', postcode: 'E1 1AA', phone: null, email: null, website: null, lat: 51.514, lng: -0.075 }];

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  ['The North East list: active GP practices in NE, DH and SR, each with coordinates and a phone number; emails only practice mailboxes', () => {
    assert.ok(data.count >= MIN_PRACTICES, `only ${data.count}`);
    assert.equal(data.count, PRACTICES.length);
    assert.deepEqual(AREAS, ['NE', 'DH', 'SR']);
    assert.equal(new Set(PRACTICES.map((practice) => practice.code)).size, PRACTICES.length);
    for (const practice of PRACTICES) {
      assert.match(practice.code, /^[A-Z]\d{5}$/, practice.name);
      assert.ok(AREAS.includes(/** @type {string} */ (practice.postcode.match(/^[A-Z]{1,2}/)?.[0])), `${practice.code} is outside the areas`);
      assert.ok(isPostcode(practice.postcode), `${practice.code} postcode`);
      assert.ok(Number.isFinite(practice.lat) && Number.isFinite(practice.lng), `${practice.code} has no coordinates`);
      assert.ok(practice.phone, `${practice.code} has no phone number`);
      if (practice.email) assert.ok(isPracticeMailbox(practice.email, practice), `${practice.code}'s email might be a person's`);
      if (practice.website) assert.match(practice.website, /^https?:\/\//, practice.code);
    }
    assert.ok(PRACTICES.filter((practice) => practice.email).length > 50, 'most have an email');
    assert.match(data.licence, /Open Government Licence/);
  }],
  ['The England file: every active practice in England, compact, none in Wales, coordinates in England', () => {
    const bytes = statSync('static/gp/england.tsv').size;
    console.log(`      (static/gp/england.tsv: ${ENGLAND.length} practices, ${Math.round(bytes / 1024)} KB)`);
    assert.ok(ENGLAND.length >= 5500, `only ${ENGLAND.length}`);
    assert.ok(bytes < 700 * 1024, 'small enough');
    assert.match(ENGLAND_TEXT.split('\n')[0], /^# .*Open Government Licence/);
    assert.equal(new Set(ENGLAND.map((practice) => practice.code)).size, ENGLAND.length);
    for (const practice of ENGLAND) {
      // Wales's practices are left out by region, not code: a few English practices near the border
      // have W codes (such as W93019 in Lydney, Gloucestershire).
      assert.ok(!/^(CF|SA|LL|NP|LD)\d/.test(practice.postcode), `${practice.code} has a Welsh postcode`);
      assert.ok(practice.lat > 49.8 && practice.lat < 55.9 && practice.lng > -6.5 && practice.lng < 1.9, `${practice.code} isn't in England`);
      assert.ok(practice.name && practice.postcode, practice.code);
    }
    const saville = ENGLAND.find((practice) => practice.code === 'A86003');
    assert.equal(saville?.name, 'Saville Medical Group');
  }],
  ['Reading the report: quoted fields, commas and quotes inside them, Windows line ends', () => {
    const rows = parseCsv(CSV);
    assert.equal(rows.length, 6);
    assert.ok(rows.every((cells) => cells.length === 27));
    assert.equal(rows[1][1], 'THE "QUOTED", SURGERY');
  }],
  ['Only England\'s active GP practices (role RO76, in an NHS England region): not closed ones, out-of-hours services or Wales\'s; and by area', () => {
    const rows = parseCsv(CSV);
    assert.deepEqual(activeGpPractices(rows).map((practice) => practice.code), ['A99001', 'A99002', 'A99005']);
    assert.deepEqual(activeGpPractices(rows, ['NE', 'DH']), [
      { code: 'A99001', name: 'Made-Up Medical Group', address: '1 Pretend Street, Newcastle upon Tyne', postcode: 'NE1 1AA', phone: '0191 0000001' },
      { code: 'A99002', name: 'The "Quoted", Surgery', address: 'Flat 2A, Old Road, Chester-le-Street', postcode: 'DH3 1AA', phone: null }
    ]);
  }],
  ['Names in capitals are tidied', () => {
    assert.equal(tidyName('SAVILLE MEDICAL GROUP'), 'Saville Medical Group');
    assert.equal(tidyName("ST. GEORGE'S SURGERY"), "St. George's Surgery");
    assert.equal(tidyName("DR O'BRIEN AND PARTNERS"), "Dr O'Brien and Partners");
    assert.equal(tidyName('UNIT 4B NHS HEALTH CENTRE'), 'Unit 4B NHS Health Centre');
  }],
  ['A practice\'s NHS contact page: the phone as written, its email and website (not NHS links); only mailboxes that name the practice or a role are kept', () => {
    assert.deepEqual(parseContactPage(`<p>Reception <a href="tel:01910000001">0191 000 0001</a></p>
      <a href="https://www.made-up-surgery.example">Visit GP surgery website</a> <a href="https://www.nhs.uk/nhs-app/">NHS App website</a>
      <a href="mailto:Made.Up@nhs.net?subject=Hello">Email this GP surgery</a>`), { phone: '0191 000 0001', email: 'made.up@nhs.net', website: 'https://www.made-up-surgery.example' });
    assert.deepEqual(parseContactPage('<p>No links here</p>'), { phone: null, email: null, website: null });
    const practice = { code: 'A99001', name: 'Made-Up Medical Group' };
    for (const email of ['madeup.medical@nhs.net', 'england.a99001@nhs.net', 'reception.something@nhs.net', 'made-up.admin@nhs.net']) assert.equal(isPracticeMailbox(email, practice), true, email);
    for (const email of ['jane.example5@nhs.net', 'j.bloggs@nhs.net']) assert.equal(isPracticeMailbox(email, practice), false, email);
  }],
  ['The files: the North East list sorted and rounded, the England file compact and round-trips; the download date doesn\'t count as a change', () => {
    const file = buildFile([{ ...NORTH_EAST[2], lat: 54.9912345678 }, NORTH_EAST[1]], { name: 'Centre', postcode: 'NE1 8ST', lat: 54.97, lng: -1.6 }, '2026-11-17');
    assert.deepEqual(file.practices.map((practice) => practice.name), ['Middle', 'Near']);
    assert.equal(file.practices[0].lat, 54.99123);
    assert.equal(sameList({ ...file, dataFrom: '2026-12-01' }, file), true);
    assert.deepEqual(listChanges({ ...file, practices: [file.practices[0], { ...NORTH_EAST[0] }] }, file), { added: ['A00002'], removed: ['A00001'], changed: [] });
    assert.equal(shortAddress('Health Centre, Lawson Street, Stockton-on-Tees'), 'Health Centre, Stockton-on-Tees');
    const text = englandFile([{ ...MADE_UP_ENGLAND[3], name: 'Tab\tName', address: 'One, Two, Town', phone: '020 0000 0000' }], '2026-11-17');
    assert.deepEqual(parseEnglandFile(text), [{ code: 'A00004', name: 'Tab Name', address: 'One, Town', postcode: 'E1 1AA', phone: '020 0000 0000', email: null, website: null, lat: 51.514, lng: -0.075 }]);
    assert.equal(englandBody(text), englandBody(englandFile([{ ...MADE_UP_ENGLAND[3], name: 'Tab\tName', address: 'One, Two, Town', phone: '020 0000 0000' }], '2027-01-01')));
    assert.deepEqual(checkBeforeWriting({ kept: 202, candidates: 202, unplaced: 0 }), []);
    assert.equal(checkBeforeWriting({ kept: 20, candidates: 202, unplaced: 0 }).length, 1);
  }],
  ['The search box takes a full postcode, a district or a place, in any case or spacing', () => {
    assert.deepEqual(classifySearch(' ne18st '), { kind: 'postcode', value: 'NE1 8ST' });
    assert.deepEqual(classifySearch('Sw1a 1aa'), { kind: 'postcode', value: 'SW1A 1AA' });
    assert.deepEqual(classifySearch(' ne 6 '), { kind: 'district', value: 'NE6' });
    assert.deepEqual(classifySearch('dh1'), { kind: 'district', value: 'DH1' });
    assert.deepEqual(classifySearch('  Heaton '), { kind: 'place', value: 'Heaton' });
    assert.deepEqual(classifySearch('high   heaton'), { kind: 'place', value: 'high heaton' });
    assert.deepEqual(classifySearch('   '), { kind: 'empty', value: '' });
    assert.equal(normalisePostcode('ne18st'), 'NE1 8ST');
  }],
  ['A place with several matches: one choice each, with its county, places people live in, the exact name, nearest the campus first', () => {
    const results = [
      { name_1: 'Heaton', local_type: 'Suburban Area', county_unitary: null, district_borough: 'Bradford', region: 'Yorkshire and the Humber', country: 'England', latitude: 53.81, longitude: -1.78 },
      { name_1: 'Heaton', local_type: 'Suburban Area', county_unitary: null, district_borough: 'Newcastle upon Tyne', region: 'North East', country: 'England', latitude: 54.98, longitude: -1.58 },
      { name_1: 'High Heaton', local_type: 'Suburban Area', district_borough: 'Newcastle upon Tyne', country: 'England', latitude: 54.99, longitude: -1.58 },
      { name_1: 'Heaton', local_type: 'Other Feature', county_unitary: 'Somewhere', country: 'England', latitude: 52, longitude: -1 },
      { name_1: 'Heaton', local_type: 'Hamlet', county_unitary: 'Staffordshire', country: 'England', latitude: 53.15, longitude: -2.08 }
    ];
    assert.deepEqual(placeChoices(results, 'heaton').map((choice) => `${choice.label}, ${choice.county}`), ['Heaton, Newcastle upon Tyne', 'Heaton, Bradford', 'Heaton, Staffordshire']);
    assert.deepEqual(placeChoices([], 'heaton'), []);
  }],
  ['Nearest anywhere: the North East list near Newcastle (nothing downloaded); the England list elsewhere, loaded with the same request; far from England flagged', async () => {
    let loads = 0;
    const load = async () => (loads++, MADE_UP_ENGLAND);
    const newcastle = await nearestAnywhere(54.972, -1.6, { load, northEast: NORTH_EAST });
    assert.equal(newcastle.source, 'north-east');
    assert.deepEqual(newcastle.practices.map((practice) => practice.name), ['Near', 'Middle', 'Far']);
    assert.equal(loads, 0, 'nothing downloaded for Newcastle');
    const london = await nearestAnywhere(51.515, -0.074, { load, northEast: NORTH_EAST });
    assert.equal(london.source, 'england');
    assert.equal(london.practices[0].name, 'Aldgate');
    assert.equal(london.farFromEngland, false);
    const edinburgh = await nearestAnywhere(55.95, -3.19, { load, northEast: NORTH_EAST });
    assert.equal(edinburgh.farFromEngland, true);
    assert.equal(ENGLAND_FILE, '/gp/england.tsv', 'one address for everyone, with nothing about where they are');
    assert.ok(NORTH_EAST_KM <= 20 && BEYOND_ENGLAND_KM >= 20);
    assert.equal(nearestIn(54.972, -1.6, NORTH_EAST, 2).length, 2);
  }],
  ['Outside England: Scotland, Wales and Northern Ireland each have their own official GP finder', () => {
    assert.deepEqual(Object.keys(OTHER_NATIONS), ['Scotland', 'Wales', 'Northern Ireland']);
    assert.equal(OTHER_NATIONS.Scotland.href, 'https://www.nhsinform.scot/scotlands-service-directory/gp-practices/');
    assert.equal(OTHER_NATIONS.Wales.href, 'https://111.wales.nhs.uk/localservices/');
    assert.equal(OTHER_NATIONS['Northern Ireland'].href, 'https://www.nidirect.gov.uk/services/gp-practices');
  }],
  ['NHS links: the surgery\'s page by its ODS code, and Find a GP and Find a dentist for the postcode (or the search page)', () => {
    assert.equal(practicePageUrl({ name: "St. George's & Partners", code: 'A12345' }), 'https://www.nhs.uk/services/gp-surgery/st-georges-and-partners/A12345');
    assert.equal(findAGpUrl('NE1 8ST'), 'https://www.nhs.uk/service-search/find-a-gp/results?location=NE1%208ST');
    assert.equal(findAGpUrl(null), 'https://www.nhs.uk/service-search/find-a-gp/');
    assert.equal(findADentistUrl('NE6'), 'https://www.nhs.uk/service-search/find-a-dentist/results?location=NE6');
    assert.equal(distanceText(0.43), '450 m');
    assert.equal(telHref('0191 232 4274'), 'tel:01912324274');
  }],
  ['The page never stores or sends a location: typed searches go to postcodes.io, and the England file is the same request for everyone', () => {
    assert.doesNotMatch(PAGE, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    for (const line of (SCRIPT + SEARCH).match(/^\s*import [^;]+;/gm) ?? []) assert.doesNotMatch(line, /firebase|firestore|gemini|checkin|ai\.js/i, line.trim());
    assert.deepEqual([...(SCRIPT + SEARCH).matchAll(/fetch\((`[^`]*`|'[^']*'|[^)]*)/g)].map((m) => m[1]), ['`https://api.postcodes.io${path}`']);
    assert.doesNotMatch(SEARCH, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    assert.match(SEARCH, /showNearest\(position\.coords\.latitude, position\.coords\.longitude, 'you', null\)/);
    assert.equal([...(SCRIPT + SEARCH).matchAll(/coords/g)].length, 2, 'the location goes only into the sums');
    for (const call of (SCRIPT + SEARCH).match(/console\.\w+\([^)]*\)/g) ?? []) assert.doesNotMatch(call, /coords|position|lat|lng/i, call);
    const finder = readFileSync('src/lib/gp/finder.js', 'utf8');
    assert.match(finder, /fetchImpl\(ENGLAND_FILE\)/);
    assert.match(PAGE, /Your location stays on your phone: it isn’t saved or sent anywhere. A postcode or place you type is\s+looked up on postcodes\.io\./);
    assert.match(SEARCH, /async search\(query\) \{\s*this\.startOver\(\);/, 'every new search clears the last');
    assert.match(SEARCH, /useMyLocation\(\) \{\s*this\.startOver\(\);/);
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

if (process.argv.includes('--links')) {
  const links = [...Object.values(OTHER_NATIONS).map((link) => link.href), findAGpUrl('NE1 8ST'), findADentistUrl('NE1 8ST')];
  console.log(`\nOpening ${links.length} links, one a second...`);
  let broken = 0;
  for (const link of links) {
    let status;
    try {
      status = (await fetch(link, { headers: { 'User-Agent': 'AG2StudentApp-link-check/1.0 (Northumbria University student project)' }, signal: AbortSignal.timeout(30_000) })).status;
    } catch (err) {
      status = /** @type {Error} */ (err).name;
    }
    if (status !== 200) broken++;
    console.log(`  ${status === 200 ? 'ok ' : 'BAD'}  ${status}  ${link}`);
    await new Promise((done) => setTimeout(done, 1000));
  }
  console.log(`\n${links.length - broken}/${links.length} links answer`);
  if (broken) failed++;
}
process.exit(failed === 0 ? 0 : 1);
