// Checks safeNextPath() (src/lib/next-path.js): after logging in, the login page only follows a
// ?next= that stays on our own site, so a shared link can't send people to another website.
// Nothing here needs Firebase or a browser.
//
// Run from the project folder:
//   node scripts/check-redirects.mjs

import assert from 'node:assert/strict';
import { loginPathFor, safeNextPath } from '#lib/next-path.js';

/** @type {[string, () => void][]} */
const checks = [
  ['Paths on our own site are kept, with their ?query and #part', () => {
    for (const path of ['/check-in', '/find-mentor?from=find-mentor', '/mentor#top', '/checklist']) {
      assert.equal(safeNextPath(path), path, path);
    }
  }],
  ['Other websites are refused, however they are written', () => {
    for (const raw of [
      'https://evil.example',
      'http://evil.example/check-in',
      '//evil.example',
      '//evil.example/check-in',
      '/\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      'javascript:alert(1)',
      'evil.example'
    ]) assert.equal(safeNextPath(raw), null, JSON.stringify(raw));
  }],
  ['Missing, empty, or not quite a path: refused', () => {
    for (const raw of [null, undefined, '', ' /check-in', 'check-in', 42]) {
      assert.equal(safeNextPath(raw), null, JSON.stringify(raw));
    }
  }],
  ['The login page itself is refused (going back there would be pointless)', () => {
    for (const raw of ['/', '/?next=%2Fmentor', '/#top']) assert.equal(safeNextPath(raw), null, raw);
  }],
  ['An encoded "//" stays a harmless path on our site', () =>
    assert.equal(safeNextPath('/%2F%2Fevil.example'), '/%2F%2Fevil.example')],
  ['loginPathFor encodes the page, and the login page reads it back unchanged', () => {
    const link = loginPathFor('/find-mentor?from=x');
    assert.equal(link, '/?next=%2Ffind-mentor%3Ffrom%3Dx');
    const next = new URL(link, 'https://ag2.invalid').searchParams.get('next');
    assert.equal(safeNextPath(next), '/find-mentor?from=x');
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
