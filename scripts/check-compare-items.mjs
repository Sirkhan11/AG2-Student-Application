// Checks the matching maths: item-by-item comparison (compare-items.js), how rankMentors,
// coordinatorReason and needsCoordinator use it (match.js), and the reasons students are shown
// (explain.js). It uses tiny made-up vectors whose answers can be worked out by hand, so nothing is
// downloaded and neither Gemini nor Firebase is involved.
//
// Run from the project folder:
//   node scripts/check-compare-items.mjs

import assert from 'node:assert/strict';
import { bestMatches, compareItems } from '#lib/matching/compare-items.js';
import { coordinatorReason, needsCoordinator, rankMentors } from '#lib/matching/match.js';
import { explainMatch } from '#lib/matching/explain.js';

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
    assert.equal(needsCoordinator([{ score: 0.9, questionsCompared: 4 }]), false)],

  // ---------- coordinatorReason (saved with the request, so the coordinator knows why) ----------
  ['coordinatorReason names each reason, and is null for a good match', () => {
    assert.equal(coordinatorReason([]), 'no-mentors');
    assert.equal(coordinatorReason([{ score: null, questionsCompared: 0 }]), 'nothing-to-compare');
    assert.equal(coordinatorReason([{ score: 0.2, questionsCompared: 6 }]), 'weak-match');
    assert.equal(coordinatorReason([{ score: 0.9, questionsCompared: 3 }]), 'too-few-questions');
    assert.equal(coordinatorReason([{ score: 0.8, questionsCompared: 6 }, { score: 0.78, questionsCompared: 6 }]), 'near-tie');
    assert.equal(coordinatorReason([{ score: 0.9, questionsCompared: 6 }, { score: 0.5, questionsCompared: 6 }]), null);
  }],

  // ---------- explainMatch (the reasons a student sees) ----------
  // Each check has six questions, in order; most are left empty.
  ['A reason names the student\'s phrase that the mentor shares, and leaves out the one they don\'t', () => {
    const reasons = explainMatch(
      [[], ['gigs', 'football'], [], [], [], []],
      [[], [music, sport], [], [], [], []],
      [[], [music], [], [], [], []],
      [null, 0.5, null, null, null, null]
    );
    assert.deepEqual(reasons, ['You share interests: gigs']);
  }],
  ['Nothing similar enough (under 0.6): one fallback reason naming the closest question', () => {
    const halfLikeMusic = [0.5, Math.sqrt(0.75)]; // similarity 0.5 with music
    const reasons = explainMatch(
      [['finding societies'], ['gigs'], [], [], [], []],
      [[sport], [music], [], [], [], []],
      [[music], [halfLikeMusic], [], [], [], []],
      [0, 0.5, null, null, null, null]
    );
    assert.deepEqual(reasons, ['Your answers about what you enjoy were the closest match']);
  }],
  ['At most 3 reasons, best first, and a phrase is never repeated', () => {
    const reasons = explainMatch(
      [['making friends'], ['gigs'], ['gigs'], ['planning ahead'], ['making friends'], ['patient']],
      [[music], [music], [music], [music], [music], [music]],
      [[music], [music], [music], [music], [music], [music]],
      [1, 1, 1, 1, 1, 1]
    );
    assert.deepEqual(reasons, [
      'They can help with what you need: making friends',
      'You share interests: gigs',
      'You work in a similar way: planning ahead'
    ]);
  }],
  ['Two shared phrases in one question become one reason', () => {
    const reasons = explainMatch(
      [[], ['gigs', 'live music'], [], [], [], []],
      [[], [music, music], [], [], [], []],
      [[], [music], [], [], [], []],
      [null, 1, null, null, null, null]
    );
    assert.deepEqual(reasons, ['You share interests: gigs and live music']);
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
