// Checks the Students' Union societies list (src/lib/societies/nsu-societies.json) and the functions
// that use it (src/lib/societies/societies.js): the data is what we expect, searching, filtering and
// lookups work, and only real, suggestible societies written as [[Name]] in a chat reply become
// links. No Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-societies.mjs

import assert from 'node:assert/strict';
import {
  AUDIENCE, CAMPUSES, CATEGORIES, COLLECTED_AT, findSociety, GROUP_ONLY, initials, MAX_SUGGESTED,
  searchSocieties, SOCIETIES, societiesInReply, societyById, SOURCE_URL, suggestible
} from '#lib/societies/societies.js';

/** @type {[string, () => void][]} */
const checks = [
  ['154 societies, each with a unique NSU id, a name, an NSU link, and a picture link or none', () => {
    assert.equal(SOCIETIES.length, 154);
    assert.equal(new Set(SOCIETIES.map((society) => society.nsuId)).size, 154);
    for (const society of SOCIETIES) {
      assert.ok(society.name.trim() !== '', `society ${society.nsuId} has no name`);
      assert.match(society.url, /^https:\/\/mynsu\.co\.uk\/activities\/view\/\d+$/, society.name);
      assert.ok(society.image === null || society.image.startsWith('https://'), `${society.name}: picture link isn't https`);
    }
  }],
  ['Campuses are Newcastle (140) and London (14); NSU\'s 10 categories; where and when it was collected', () => {
    assert.deepEqual(CAMPUSES, ['Newcastle', 'London']);
    assert.equal(SOCIETIES.filter((society) => society.campus === 'Newcastle').length, 140);
    assert.equal(SOCIETIES.filter((society) => society.campus === 'London').length, 14);
    assert.equal(CATEGORIES.length, 10);
    assert.ok(CATEGORIES.includes('Recreational Sport'));
    assert.match(SOURCE_URL, /^https:\/\/mynsu\.co\.uk\//);
    assert.ok(!Number.isNaN(new Date(COLLECTED_AT).getTime()));
  }],
  ['Searching matches names and categories, on one campus, alphabetically', () => {
    assert.deepEqual(searchSocieties('CLIMB', 'Newcastle').map((society) => society.name), ['Climbing', 'Outdoor Climbing']);
    assert.equal(searchSocieties('', 'Newcastle').length, 140);
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
  ['Every GROUP_ONLY and AUDIENCE id is a real society; the nine "everyone welcome" ones say so', () => {
    for (const id of [...Object.keys(GROUP_ONLY), ...Object.keys(AUDIENCE)]) assert.ok(societyById(Number(id)), `${id} isn't on the list`);
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
  ['A chat reply: real [[societies]] become links, made-up ones stay plain text without a link', () => {
    const { text, societies } = societiesInReply('Try [[Climbing]] or [[Walking]]. Or [[Underwater Basket Weaving]].', 'Newcastle');
    assert.equal(text, 'Try Climbing or Walking. Or Underwater Basket Weaving.');
    assert.deepEqual(societies.map((society) => society.nsuId), [15, 221]);
  }],
  ['A society named twice gets one link; plain words like "music" are never turned into links', () => {
    assert.deepEqual(societiesInReply('[[Music]] is great. [[music]] again.', 'Newcastle').societies.map((s) => s.name), ['Music']);
    assert.deepEqual(societiesInReply('I love music and art.', 'Newcastle').societies, []);
  }],
  [`At most ${MAX_SUGGESTED} links, and never one for a society with a restricted audience`, () => {
    assert.equal(societiesInReply('[[Music]], [[Rock]], [[Dance]], [[Film]], [[Book]]', 'Newcastle').societies.length, MAX_SUGGESTED);
    const { text, societies } = societiesInReply('Maybe [[Girls Who Run]].', 'Newcastle');
    assert.equal(text, 'Maybe Girls Who Run.');
    assert.deepEqual(societies, []);
    assert.equal(suggestible(/** @type {any} */ (societyById(185))), false);
    assert.equal(suggestible(/** @type {any} */ (societyById(214))), true, 'everyone-welcome societies can be suggested');
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
