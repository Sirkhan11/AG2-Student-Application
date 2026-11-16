// Checks the matching maths: item-by-item comparison (compare-items.js) and how rankMentors and
// needsCoordinator use it (match.js). It uses tiny made-up vectors whose answers can be worked out
// by hand, so nothing is downloaded and neither Gemini nor Firebase is involved.
//
// Run from the project folder:
//   node scripts/check-compare-items.mjs

import assert from 'node:assert/strict';
import { bestMatches, compareItems } from '#lib/matching/compare-items.js';
import { needsCoordinator, rankMentors } from '#lib/matching/match.js';

// Two-number "vectors" at right angles: identical items score 1, unrelated items score 0.
const music = [1, 0];
const sport = [0, 1];

/** @type {[string, () => void][]} */
const checks = [
  // ---------- compareItems and bestMatches ----------
  ['Student side: extra mentor items don\'t lower the score', () =>
    assert.equal(compareItems([music], [music, sport], 'student'), 1)],
  ['Both directions: (1 + (1 + 0) / 2) / 2 = 0.75', () =>
    assert.equal(compareItems([music], [music, sport], 'both'), 0.75)],
  ['Saying the same thing more times doesn\'t change the score', () =>
    assert.equal(compareItems([music, music, music], [music], 'student'), 1)],
  ['An empty list on either side gives null (nothing to compare)', () => {
    assert.equal(compareItems([], [music], 'student'), null);
    assert.equal(compareItems([music], [], 'both'), null);
  }],
  ['bestMatches points at the closest mentor item', () =>
    assert.deepEqual(bestMatches([sport], [music, sport]), [{ index: 1, score: 1 }])],

  // ---------- rankMentors ----------
  ['A question with an empty summary is left out of the average, not counted as 0', () => {
    // Question 1 matches perfectly; question 2 is empty on the mentor's side.
    const [result] = rankMentors([[music], [sport]], [{ id: 'a', name: 'A', itemVectors: [[music], []] }]);
    assert.deepEqual(result.perQuestion, [1, null]);
    assert.equal(result.score, 1);
    assert.equal(result.questionsCompared, 1);
  }],
  ['An empty summary on the student\'s side is skipped for every mentor', () => {
    const ranked = rankMentors([[], [music]], [
      { id: 'a', name: 'A', itemVectors: [[music], [music]] },
      { id: 'b', name: 'B', itemVectors: [[sport], [music]] }
    ]);
    assert.deepEqual(ranked.map((m) => m.perQuestion), [[null, 1], [null, 1]]);
  }],
  ['Uses the student side: a mentor\'s extra interests don\'t count against them', () => {
    const [result] = rankMentors([[music]], [{ id: 'a', name: 'A', itemVectors: [[music, sport]] }]);
    assert.equal(result.score, 1);
  }],
  ['Mentors come out best first, and one with nothing to compare comes last with score null', () => {
    const ranked = rankMentors([[music]], [
      { id: 'empty', name: 'Empty', itemVectors: [[]] },
      { id: 'weak', name: 'Weak', itemVectors: [[sport]] },
      { id: 'strong', name: 'Strong', itemVectors: [[music]] }
    ]);
    assert.deepEqual(ranked.map((m) => m.id), ['strong', 'weak', 'empty']);
    assert.equal(ranked[2].score, null);
  }],

  // ---------- needsCoordinator ----------
  // Results here were compared on all 6 questions unless a check says otherwise.
  ['needsCoordinator: no mentors, or nothing compared, goes to the coordinator', () => {
    assert.equal(needsCoordinator([]), true);
    assert.equal(needsCoordinator([{ score: null, questionsCompared: 0 }]), true);
  }],
  ['needsCoordinator: a clear, strong match does not', () =>
    assert.equal(needsCoordinator([{ score: 0.9, questionsCompared: 6 }, { score: 0.5, questionsCompared: 6 }]), false)],
  ['needsCoordinator: weak (under 0.3) or close (gap under 0.05) does', () => {
    assert.equal(needsCoordinator([{ score: 0.2, questionsCompared: 6 }]), true);
    assert.equal(needsCoordinator([{ score: 0.8, questionsCompared: 6 }, { score: 0.78, questionsCompared: 6 }]), true);
  }],
  ['needsCoordinator: a runner-up with nothing compared doesn\'t make it "close"', () =>
    assert.equal(needsCoordinator([{ score: 0.8, questionsCompared: 6 }, { score: null, questionsCompared: 0 }]), false)],
  ['needsCoordinator: a perfect score from only 3 of 6 questions goes to the coordinator', () =>
    assert.equal(needsCoordinator([{ score: 1, questionsCompared: 3 }]), true)],
  ['needsCoordinator: 4 of 6 questions is enough', () =>
    assert.equal(needsCoordinator([{ score: 0.9, questionsCompared: 4 }]), false)]
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
