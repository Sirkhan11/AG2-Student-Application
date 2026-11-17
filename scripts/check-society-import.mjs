// Checks the society pages validator (scripts/lib/society-pages.mjs) with MADE-UP data only: the
// real file has personal data and must never be copied into the repo. No Firebase or Gemini.
//
// Run from the project folder:
//   node scripts/check-society-import.mjs

import assert from 'node:assert/strict';
import { checkSocietyPages } from './lib/society-pages.mjs';

/** A made-up page that should pass. */
const page = () => ({
  name: 'Climbing',
  description: ['We climb.', '', 'Beginners welcome.'],
  headerImage: null,
  socials: [{ platform: 'instagram', url: 'https://www.instagram.com/example' }],
  memberships: [{ name: 'Standard', price: 5 }],
  eventsUrl: 'https://mynsu.co.uk/activities/view/15#events',
  email: 'climbing.made-up@example.com',
  otherEmails: ['someone.else@example.com'],
  committee: []
});
const file = (/** @type {Record<string, any>} */ societies) => ({
  source: 'https://mynsu.co.uk/Activities/home', collectedAt: '2026-11-17T12:00:00Z', societies
});
const known = new Set([15, 64]);

/** @type {[string, () => void][]} */
const checks = [
  ['A good file passes, and the documents keep what the app shows', () => {
    const { errors, docs, counts } = checkSocietyPages(file({ 15: page(), 64: { ...page(), email: '' } }), known);
    assert.deepEqual(errors, []);
    assert.equal(docs.size, 2);
    const doc = docs.get(15);
    assert.deepEqual(doc?.description, ['We climb.', 'Beginners welcome.'], 'empty paragraphs are dropped');
    assert.equal(doc?.email, 'climbing.made-up@example.com');
    assert.equal(docs.get(64)?.email, null, 'no email is stored as null');
    assert.equal(doc?.source, 'https://mynsu.co.uk/Activities/home');
    assert.deepEqual(counts, { societies: 2, withDescription: 2, withEmail: 1, socials: 2, memberships: 2, withCommittee: 0 });
  }],
  ['otherEmails is never copied into a document', () => {
    const { docs } = checkSocietyPages(file({ 15: page(), 64: page() }), known);
    assert.ok(!('otherEmails' in /** @type {object} */ (docs.get(15))));
    assert.ok(!JSON.stringify([...docs.values()]).includes('someone.else@example.com'));
  }],
  ['Problems are found: http links, bad prices, unknown ids, missing societies, bad emails', () => {
    const broken = { ...page(), socials: [{ platform: 'instagram', url: 'http://insecure.example' }], memberships: [{ name: 'x', price: -1 }], email: 'not-an-email' };
    const { errors, docs } = checkSocietyPages(file({ 15: broken, 999: page() }), known);
    assert.ok(errors.includes('15.socials[0].url: should be an https link'));
    assert.ok(errors.includes('15.memberships[0].price: should be a number of pounds, 0 or more'));
    assert.ok(errors.includes('15.email: should be an email address, empty or null'));
    assert.ok(errors.includes('999: not an NSU id from nsu-societies.json'));
    assert.ok(errors.includes('64: in nsu-societies.json but missing from this file'));
    assert.equal(docs.size, 0, 'a society with problems is not written');
  }],
  ['Error messages never contain the values themselves (no emails, links or text)', () => {
    const broken = { ...page(), email: 'private person@example.com', socials: [{ platform: 'Bad Platform!', url: 'http://secret.example' }] };
    const { errors } = checkSocietyPages(file({ 15: broken, 64: page() }), known);
    const all = errors.join('\n');
    for (const value of ['private person', 'secret.example', 'Bad Platform']) assert.ok(!all.includes(value), value);
  }],
  ['Real-world shapes are accepted: the "x" platform, email null, and a link with a space in it', () => {
    const odd = { ...page(), email: null, socials: [{ platform: 'x', url: 'https://x.com/made up' }] };
    const { errors, docs } = checkSocietyPages(file({ 15: odd, 64: page() }), known);
    assert.deepEqual(errors, []);
    assert.equal(docs.get(15)?.email, null);
    assert.equal(docs.get(15)?.socials[0].url, 'https://x.com/made%20up', 'the space is encoded');
  }],
  ['A file without a societies object is refused', () => {
    assert.deepEqual(checkSocietyPages({}, known).errors, ['the file needs a "societies" object keyed by NSU id']);
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
