// Checks the Students' Union societies list (src/lib/societies/nsu-societies.json) and the functions
// that use it (src/lib/societies/societies.js): the data is what we expect, searching, filtering and
// lookups work, and which societies the chat may suggest. (Turning a chat reply's [[Name]]s into
// links is checked in check-checkin.mjs.) No Gemini or Firebase.
//
// The list is refreshed from NSU's site (scripts/collect-nsu-societies.mjs), so the counts here are
// the same rules that script checks, not today's numbers. The checks on particular societies (Music,
// Stitch, Make & Bitch, and the GROUP_ONLY and AUDIENCE ids) are on purpose: if a refresh breaks
// one, a person needs to look, as the chat rules and labels name those societies.
//
// Run from the project folder:
//   node scripts/check-societies.mjs

import assert from 'node:assert/strict';
import { MIN_SOCIETIES } from './lib/nsu-collect.mjs';
import {
  AUDIENCE, CAMPUSES, CATEGORIES, COLLECTED_AT, findSociety, GROUP_ONLY, initials, NAME_NOTES,
  searchSocieties, SOCIETIES, societyById, SOURCE_URL, suggestible
} from '#lib/societies/societies.js';

/** @type {[string, () => void][]} */
const checks = [
  [`At least ${MIN_SOCIETIES} societies, each with a unique NSU id, a name, an NSU link, and a picture link or none`, () => {
    assert.ok(SOCIETIES.length >= MIN_SOCIETIES, `only ${SOCIETIES.length}`);
    assert.equal(new Set(SOCIETIES.map((society) => society.nsuId)).size, SOCIETIES.length);
    for (const society of SOCIETIES) {
      assert.ok(society.name.trim() !== '', `society ${society.nsuId} has no name`);
      assert.match(society.url, /^https:\/\/mynsu\.co\.uk\/activities\/view\/\d+$/, society.name);
      assert.ok(society.image === null || society.image.startsWith('https://'), `${society.name}: picture link isn't https`);
    }
  }],
  ['Every society is at the Newcastle or London campus (Newcastle first); NSU\'s categories include Recreational Sport; where and when it was collected', () => {
    assert.equal(CAMPUSES[0], 'Newcastle');
    assert.ok(CAMPUSES.every((campus) => ['Newcastle', 'London'].includes(campus)), CAMPUSES.join(', '));
    assert.ok(CATEGORIES.length > 0);
    // The chat's Sport rule names this category.
    assert.ok(CATEGORIES.includes('Recreational Sport'));
    assert.match(SOURCE_URL, /^https:\/\/mynsu\.co\.uk\//);
    assert.ok(!Number.isNaN(new Date(COLLECTED_AT).getTime()));
  }],
  ['Searching matches names and categories, on one campus, alphabetically', () => {
    const climbing = searchSocieties('CLIMB', 'Newcastle').map((society) => society.name);
    assert.ok(climbing.includes('Climbing') && climbing.includes('Outdoor Climbing'), climbing.join(', '));
    assert.ok(climbing.every((name) => /climb/i.test(name)));
    assert.deepEqual(climbing, [...climbing].sort((a, b) => a.localeCompare(b)));
    assert.equal(searchSocieties('', 'Newcastle').length, SOCIETIES.filter((society) => society.campus === 'Newcastle').length);
    const sport = searchSocieties('recreational sport', 'Newcastle');
    assert.ok(sport.length > 0 && sport.every((society) => society.category === 'Recreational Sport'));
  }],
  ['The category filter shows only that category, and combines with search', () => {
    const faith = searchSocieties('', 'Newcastle', 'Faith and Belief');
    assert.ok(faith.length > 0 && faith.every((society) => society.category === 'Faith and Belief'));
    assert.deepEqual(searchSocieties('climb', 'Newcastle', 'Academic'), []);
  }],
  ['Looking up by id, and by exact name on the right campus', () => {
    assert.equal(societyById(64)?.name, 'Music');
    assert.equal(societyById(999999), null);
    assert.equal(findSociety('stitch, make & bitch', 'Newcastle')?.nsuId, 99);
    assert.equal(findSociety('Climb', 'Newcastle'), null, 'part of a name is not enough');
    assert.equal(societyById(242)?.campus, 'London', 'Bangladesh Synergy Network moved to London');
  }],
  ['Every GROUP_ONLY, AUDIENCE and NAME_NOTES id is a real society; the nine "everyone welcome" ones say so', () => {
    for (const id of [...Object.keys(GROUP_ONLY), ...Object.keys(AUDIENCE), ...Object.keys(NAME_NOTES)]) assert.ok(societyById(Number(id)), `${id} isn't on the list`);
    assert.equal(societyById(18)?.name, 'Conservation of Fine Art', 'the misleading names are the societies the notes were written for');
    assert.equal(societyById(180)?.name, 'Formula Student');
    const welcoming = Object.entries(GROUP_ONLY).filter(([, group]) => group.everyoneWelcome).map(([id]) => Number(id)).sort((a, b) => a - b);
    assert.deepEqual(welcoming, [50, 56, 57, 120, 168, 175, 214, 247, 272]);
    assert.equal(GROUP_ONLY[214].note, 'Ukrainian community, everyone welcome');
  }],
  ['Initials for societies without a picture', () => {
    assert.equal(initials('Outdoor Climbing'), 'OC');
    assert.equal(initials('Music'), 'M');
    assert.equal(initials('Accountancy, Finance & Economics'), 'AF');
    assert.equal(initials('Stitch, Make & Bitch'), 'SM');
  }],
  ['The chat may suggest any society except those with a restricted audience', () => {
    assert.equal(suggestible(/** @type {any} */ (societyById(185))), false, 'Girls Who Run');
    assert.equal(suggestible(/** @type {any} */ (societyById(213))), false, 'Women in Business');
    assert.equal(suggestible(/** @type {any} */ (societyById(214))), true, 'everyone-welcome societies can be suggested');
    assert.equal(suggestible(/** @type {any} */ (societyById(15))), true);
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
