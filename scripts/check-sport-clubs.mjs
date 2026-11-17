// Checks Northumbria Sport's club list (src/lib/sport/sport-clubs.json) and src/lib/sport/clubs.js:
// the data is what we expect and holds no contact details, lookups work, and no club has exactly the
// same name as a society or an NSU service, so a name in a chat reply can only mean one thing (a
// later refresh that adds a clash fails here). No Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-sport-clubs.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLUBS, CLUBS_COLLECTED_AT, CLUBS_SOURCE, clubBySlug, findClub, searchClubs } from '#lib/sport/clubs.js';
import { findSociety, SOCIETIES } from '#lib/societies/societies.js';
import { SERVICES } from '#lib/nsu/services.js';

const key = (/** @type {string} */ name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/** @type {[string, () => void][]} */
const checks = [
  ['38 clubs, each with a unique slug, a name, a northumbriasport.com link, and an https picture or none', () => {
    assert.equal(CLUBS.length, 38);
    assert.equal(new Set(CLUBS.map((club) => club.slug)).size, 38);
    for (const club of CLUBS) {
      assert.match(club.slug, /^[a-z0-9-]+$/, club.name);
      assert.ok(club.name.trim() !== '', `${club.slug} has no name`);
      assert.match(club.url, /^https:\/\/northumbriasport\.com\//, club.name);
      assert.ok(club.image === null || club.image.startsWith('https://'), `${club.name}: picture link isn't https`);
    }
    assert.deepEqual(CLUBS.filter((club) => club.image === null).map((club) => club.name), ['Dodgeball', 'Padel', 'Rounders']);
    assert.match(CLUBS_SOURCE, /^https:\/\/northumbriasport\.com\//);
    assert.ok(!Number.isNaN(new Date(CLUBS_COLLECTED_AT).getTime()));
  }],
  ['The list file holds no contact details: no "@" anywhere in it', () => {
    assert.ok(!readFileSync('src/lib/sport/sport-clubs.json', 'utf8').includes('@'));
  }],
  ['Looking up by slug and by exact name (ignoring capitals); search by part of a name', () => {
    assert.equal(clubBySlug('swimming')?.name, 'Swimming');
    assert.equal(clubBySlug('nope'), null);
    assert.equal(findClub('  table   TENNIS ')?.slug, 'table-tennis');
    assert.equal(findClub('Swim'), null, 'part of a name is not enough');
    assert.deepEqual(searchClubs('foot').map((club) => club.name), ['American Football', 'Football', 'Gaelic Football']);
  }],
  ['No club has exactly the same name as a society (on either campus) or an NSU service', () => {
    const societies = new Set(SOCIETIES.map((society) => key(society.name)));
    const services = new Set(SERVICES.map((service) => key(service.name)));
    const clashes = CLUBS.filter((club) => societies.has(key(club.name)) || services.has(key(club.name))).map((club) => club.name);
    assert.deepEqual(clashes, []);
  }],
  ['Hockey is the club and Ice Hockey the society, never the other way round', () => {
    assert.equal(findClub('Hockey')?.slug, 'hockey');
    assert.equal(findClub('Ice Hockey'), null);
    assert.equal(findSociety('Ice Hockey', 'Newcastle')?.name, 'Ice Hockey');
    assert.equal(findSociety('Hockey', 'Newcastle'), null);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n')[0]}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
