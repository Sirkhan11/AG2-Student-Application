// Checks src/lib/matching/summary-prompt.js, the part of the summary request shared by the app and
// the test fixtures: the reply shape must be exactly what the Firebase SDK's Schema helpers send, so
// fixtures made over REST in Node ask Gemini for the same thing the app does. No Gemini calls.
//
// Run from the project folder:
//   node scripts/check-summary-prompt.mjs

import assert from 'node:assert/strict';
import { Schema } from 'firebase/ai';
import { cleanAnswers, keysFor, MAX_WANTS, readReply, requestText, responseSchema } from '#lib/matching/summary-prompt.js';

/** @type {[string, () => void][]} */
const checks = [
  ['The reply shape is exactly what the SDK\'s Schema helpers produce (1 and 6 answers)', () => {
    for (const count of [1, 6]) {
      const phrases = Schema.array({ items: Schema.string(), maxItems: MAX_WANTS });
      const sdk = Schema.object({ properties: Object.fromEntries(keysFor(count).map((key) => [key, phrases])) });
      assert.deepEqual(JSON.parse(JSON.stringify(responseSchema(count))), JSON.parse(JSON.stringify(sdk)));
    }
  }],
  ['Answers are sent as JSON, one per key, with email addresses blanked out', () => {
    const text = requestText(cleanAnswers(['  I said "hi"\nthen left ', 'mail me on a.person@example.com']));
    assert.deepEqual(JSON.parse(text), { q1: 'I said "hi"\nthen left', q2: 'mail me on [email]' });
  }],
  ['Replies are tidied: trimmed, no blanks or repeats, at most 5', () => {
    const reply = JSON.stringify({ q1: [' gigs ', 'gigs', '', 'a', 'b', 'c', 'd', 'e'], q2: [] });
    assert.deepEqual(readReply(reply, 2), [['gigs', 'a', 'b', 'c', 'd'], []]);
  }],
  ['A reply missing a list, or not JSON, is an error rather than a quiet gap', () => {
    assert.throws(() => readReply(JSON.stringify({ q1: ['gigs'] }), 2));
    assert.throws(() => readReply('not json', 1));
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
