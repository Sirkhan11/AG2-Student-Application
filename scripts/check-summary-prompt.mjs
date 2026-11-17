// Checks src/lib/matching/summary-prompt.js, the part of the summary request shared by the app and
// the test fixtures: the reply shape must be exactly what the Firebase SDK's Schema helpers send, so
// fixtures made over REST in Node ask Gemini for the same thing the app does; and replies must be
// read safely (tidied, nothing avoided ever kept as a like, broken replies refused). No Gemini calls.
//
// Run from the project folder:
//   node scripts/check-summary-prompt.mjs

import assert from 'node:assert/strict';
import { Schema } from 'firebase/ai';
import {
  cleanAnswers, emptySummary, INSTRUCTIONS, isStyleOnly, keysFor, MAX_WANTS, NOT_SAID, readReply, requestText, responseSchema,
  STYLES, stylesText, summaryToSave
} from '#lib/matching/summary-prompt.js';

/** A reply with every answer's lists and the styles filled in, for changing one part at a time. */
function reply(/** @type {Record<string, unknown>} */ answers, styles = { social: 'going out', planning: NOT_SAID, working: 'both' }) {
  return JSON.stringify({ ...answers, styles });
}

/** @type {[string, () => void][]} */
const checks = [
  ['The reply shape is exactly what the SDK\'s Schema helpers produce (1 and 6 answers)', () => {
    for (const count of [1, 6]) {
      const phrases = Schema.array({ items: Schema.string(), maxItems: MAX_WANTS });
      const answer = Schema.object({ properties: { likes: phrases, avoids: phrases } });
      const style = (/** @type {readonly string[]} */ values) => Schema.enumString({ enum: [...values, NOT_SAID] });
      const styles = Schema.object({
        properties: { social: style(STYLES.social), planning: style(STYLES.planning), working: style(STYLES.working) }
      });
      const sdk = Schema.object({ properties: { ...Object.fromEntries(keysFor(count).map((key) => [key, answer])), styles } });
      assert.deepEqual(JSON.parse(JSON.stringify(responseSchema(count))), JSON.parse(JSON.stringify(sdk)));
    }
  }],
  ['The instructions name every style value, "not said", and the style-only phrases', () => {
    for (const value of [...Object.values(STYLES).flat(), NOT_SAID]) assert.ok(INSTRUCTIONS.includes(`"${value}"`), value);
    for (const phrase of ['nights out', 'nights in', 'partying', 'working alone']) assert.ok(INSTRUCTIONS.includes(phrase), phrase);
  }],
  ['Answers are sent as JSON, one per key, with email addresses blanked out', () => {
    const text = requestText(cleanAnswers(['  I said "hi"\nthen left ', 'mail me on a.person@example.com']));
    assert.deepEqual(JSON.parse(text), { q1: 'I said "hi"\nthen left', q2: 'mail me on [email]' });
  }],
  ['Likes and avoids are tidied: trimmed, no blanks or repeats, at most 5', () => {
    const summary = readReply(reply({
      q1: { likes: [' gigs ', 'gigs', '', 'a', 'b', 'c', 'd', 'e'], avoids: [' rugby', 'rugby'] },
      q2: { likes: [], avoids: [] }
    }), 2);
    assert.deepEqual(summary.likes, [['gigs', 'a', 'b', 'c', 'd'], []]);
    assert.deepEqual(summary.avoids, [['rugby'], []]);
  }],
  ['A phrase in both an answer\'s likes and its avoids is dropped from the likes (any capitals)', () => {
    const summary = readReply(reply({ q1: { likes: ['Sport', 'gigs'], avoids: ['sport'] } }), 1);
    assert.deepEqual(summary.likes, [['gigs']]);
    assert.deepEqual(summary.avoids, [['sport']]);
  }],
  ['Style-only phrases are dropped from likes and avoids (a safety net), but ambiguous ones are left to the instructions', () => {
    const summary = readReply(reply({
      q1: { likes: ['quiet nights in', 'films', 'Last-minute planning', 'going out for food', 'staying in touch'], avoids: ['nights out', 'clubbing', 'partying'] }
    }), 1);
    assert.deepEqual(summary.likes, [['films', 'going out for food', 'staying in touch']]);
    assert.deepEqual(summary.avoids, [['clubbing']]);
    assert.equal(isStyleOnly('Working with others'), true);
    assert.equal(isStyleOnly('outdoor walks'), false);
  }],
  ['Styles are read as they are, with "not said" stored as null', () => {
    const summary = readReply(reply({ q1: { likes: [], avoids: [] } }), 1);
    assert.deepEqual(summary.styles, { social: 'going out', planning: null, working: 'both' });
    assert.equal(stylesText(summary.styles), 'social: going out, planning: not said, working: both');
  }],
  ['A reply missing an answer, a list or the styles, with an unknown style, or not JSON, is an error', () => {
    const ok = { q1: { likes: ['gigs'], avoids: [] } };
    assert.doesNotThrow(() => readReply(reply(ok), 1));
    assert.throws(() => readReply(reply(ok), 2), 'missing answer');
    assert.throws(() => readReply(reply({ q1: { likes: ['gigs'] } }), 1), 'missing avoids');
    assert.throws(() => readReply(JSON.stringify(ok), 1), 'missing styles');
    assert.throws(() => readReply(reply(ok, { social: 'going out', planning: 'sometimes', working: 'both' }), 1), 'unknown style');
    assert.throws(() => readReply(reply(ok, { social: 'going out', working: 'both' }), 1), 'missing style');
    assert.throws(() => readReply('not json', 1));
  }],
  ['Blank answers give an empty summary; summaries are saved with one list per question under q1, q2, ...', () => {
    assert.deepEqual(emptySummary(2), { likes: [[], []], avoids: [[], []], styles: { social: null, planning: null, working: null } });
    const saved = summaryToSave({ likes: [['gigs'], []], avoids: [[], ['rugby']], styles: { social: null, planning: 'last minute', working: null } });
    assert.deepEqual(saved, {
      likes: { q1: ['gigs'], q2: [] },
      avoids: { q1: [], q2: ['rugby'] },
      styles: { social: null, planning: 'last minute', working: null }
    });
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
