// Checks "← Back" (src/lib/back.js and src/lib/components/BackLink.svelte): it returns to the page the
// student came from within the app; if they opened the page directly (a link from elsewhere, a typed
// address) it goes Home, or to log in when they're logged out; and a signed-in student is never sent
// back to a log-in or sign-up page. The pages that had a fixed Back (GP finder, NHS guide and Late
// arrivals went to More, Need help to log in) use it; the sign-up pages keep "Back to log in".
// Chrome presses Back too: scripts/check-signed-in.mjs (signed in) and check-live-site.mjs (logged out).
// Run from the project folder:
//   node scripts/check-back.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backTarget, createTrail } from '#lib/back.js';

/** A trail after these navigations: [type, to] or ['popstate', to, delta], or 'replace' before the next. @param {(string[] | [string, string, number] | 'replace')[]} steps */
function after(steps) {
  const trail = createTrail();
  for (const step of steps) {
    if (step === 'replace') trail.willReplace();
    else trail.record({ type: step[0], to: step[1], delta: step.length > 2 ? Number(step[2]) : null });
  }
  return trail;
}
const HISTORY = { kind: 'history' };
const home = { kind: 'open', href: '/home' };
const logIn = { kind: 'open', href: '/' };

/** @type {[string, () => void][]} */
const checks = [
  ['From Home to the GP finder, Back returns to Home (the browser’s own back)', () => {
    const trail = after([['enter', '/home'], ['link', '/gp-finder']]);
    assert.equal(trail.previous(), '/home');
    assert.deepEqual(backTarget(trail.previous(), true), HISTORY);
  }],
  ['From More to the NHS guide, Back returns to More, not a fixed page', () => {
    const trail = after([['enter', '/home'], ['link', '/more'], ['link', '/nhs-guide']]);
    assert.equal(trail.previous(), '/more');
    assert.deepEqual(backTarget(trail.previous(), true), HISTORY);
  }],
  ['Opened directly (a link from elsewhere, a typed address): Back goes Home, or to log in when logged out', () => {
    for (const page of ['/gp-finder', '/nhs-guide', '/late-arrivals', '/need-help']) {
      const trail = after([['enter', page]]);
      assert.equal(trail.previous(), null, page);
      assert.deepEqual(backTarget(trail.previous(), true), home, `${page} signed in`);
      assert.deepEqual(backTarget(trail.previous(), false), logIn, `${page} logged out`);
    }
  }],
  ['Logged out, Need help reached from the log-in page goes back to it', () => {
    const trail = after([['enter', '/'], ['link', '/need-help']]);
    assert.deepEqual(backTarget(trail.previous(), false), HISTORY);
  }],
  ['Sent to log in and back: Back goes Home, never to the log-in or sign-up pages once signed in', () => {
    const trail = after([['enter', '/gp-finder'], 'replace', ['goto', '/?next=%2Fgp-finder'], ['goto', '/gp-finder']]);
    assert.equal(trail.previous(), '/?next=%2Fgp-finder', 'the log-in page replaced the GP finder');
    assert.deepEqual(backTarget(trail.previous(), true), home);
    for (const page of ['/', '/signup', '/forgot-password', '/mentor-signup', '/?next=%2Fhome']) assert.deepEqual(backTarget(page, true), home, page);
  }],
  ['It keeps in step with the browser’s back and forward: Back on the first page they opened goes Home, not out of the app', () => {
    const trail = after([['enter', '/nhs-guide'], ['link', '/gp-finder'], ['popstate', '/nhs-guide', -1]]);
    assert.equal(trail.previous(), null);
    assert.deepEqual(backTarget(trail.previous(), true), home);
    trail.record({ type: 'popstate', to: '/gp-finder', delta: 1 });
    assert.equal(trail.previous(), '/nhs-guide', 'forward again');
    trail.record({ type: 'link', to: '/late-arrivals' });
    assert.equal(trail.previous(), '/gp-finder', 'a new page after going back drops what was ahead');
  }],
  ['Back or forward past what the app has seen in this tab (a page from before a reload) starts the trail again', () => {
    const trail = after([['enter', '/home'], ['popstate', '/gp-finder', -1]]);
    assert.equal(trail.previous(), null);
  }],
  ['The four pages use it; the sign-up pages keep "Back to log in"; the layout records every navigation; sending to log in replaces', () => {
    for (const file of ['src/routes/gp-finder/+page.svelte', 'src/routes/nhs-guide/+page.svelte', 'src/routes/late-arrivals/+page.svelte', 'src/routes/need-help/+page.svelte']) {
      const page = readFileSync(file, 'utf8');
      assert.match(page, /import BackLink from '#lib\/components\/BackLink\.svelte';/, file);
      assert.match(page, /<BackLink \/>/, file);
      assert.doesNotMatch(page, /<a href="[^"]*">← Back<\/a>/, `${file}: no fixed Back`);
    }
    assert.match(readFileSync('src/routes/signup/+page.svelte', 'utf8'), /<a href="\/">← Back to log in<\/a>/);
    assert.match(readFileSync('src/routes/mentor-signup/+page.svelte', 'utf8'), /<a href="\/">← Back to log in<\/a>/);
    assert.match(readFileSync('src/routes/forgot-password/+page.svelte', 'utf8'), /<a href="\/">Back to login<\/a>/);
    const link = readFileSync('src/lib/components/BackLink.svelte', 'utf8');
    assert.match(link, /if \(target\.kind === 'history'\) history\.back\(\);\s*else goto\(target\.href\);/);
    assert.match(link, /event\.metaKey \|\| event\.ctrlKey/, 'opening it in a new tab still works');
    assert.match(readFileSync('src/routes/+layout.svelte', 'utf8'), /afterNavigate\(\(navigation\) =>\s*trail\.record\(/);
    assert.match(readFileSync('src/lib/login-redirect.js', 'utf8'), /trail\.willReplace\(\);\s*goto\(loginPathFor\(/);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
