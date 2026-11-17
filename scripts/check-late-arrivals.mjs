// Checks the Late arrivals page (src/lib/late-arrivals/guide.js): every fact links to the
// Northumbria page it comes from, the catch-up steps no Northumbria page lists are marked as advice,
// the page links the Blackboard section of the checklist, and it's no longer a copy of the NHS guide.
// Offline by default; with --links it also opens every link (one a second) and says which don't answer.
//   node scripts/check-late-arrivals.mjs [--links]

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLACKBOARD_SECTION, LINKS, SECTIONS, SOURCES } from '#lib/late-arrivals/guide.js';

/** Northumbria's own sites: its website, the Student Portal, and the form it links. */
const NORTHUMBRIA = /^https:\/\/(?:www\.northumbria\.ac\.uk|corp\.northumbria\.ac\.uk|myportal\.northumbria\.ac\.uk|forms\.cloud\.microsoft)\//;
const PAGE = readFileSync('src/routes/late-arrivals/+page.svelte', 'utf8');

/** @type {[string, () => void][]} */
const checks = [
  ['Three sections: the CAS deadline, what to do if you\'ll be late, and catching up', () => {
    assert.deepEqual(SECTIONS.map((section) => section.id), ['deadline', 'worried', 'catch-up']);
  }],
  ['Every point is a fact with a Northumbria source, or marked as advice; every link is Northumbria\'s', () => {
    for (const point of SECTIONS.flatMap((section) => section.points)) {
      assert.ok(point.source || point.advice, `"${point.text.slice(0, 50)}" has no source`);
      if (point.source) assert.match(point.source.href, NORTHUMBRIA, point.text);
      if (point.link) assert.match(point.link.href, NORTHUMBRIA, point.text);
    }
  }],
  ['The CAS deadline says not to travel after it, as Northumbria\'s page does', () => {
    const deadline = SECTIONS[0].points.map((point) => point.text).join(' ');
    assert.match(deadline, /before the deadline shown on your Confirmation of Acceptance for Studies \(CAS\)/);
    assert.match(deadline, /Don’t travel to the UK after that deadline/);
  }],
  ['"Managing your delayed arrival" and Ask4Help are linked; catching up links the Blackboard section', () => {
    const links = SECTIONS.flatMap((section) => section.points).flatMap((point) => [point.link?.href, point.app?.href]);
    assert.ok(links.includes(LINKS.delayedArrival.href));
    assert.ok(links.includes(LINKS.ask4HelpOnline.href));
    assert.ok(links.includes(BLACKBOARD_SECTION.href));
    assert.equal(BLACKBOARD_SECTION.href, '/checklist#blackboard');
  }],
  ['The page is no longer a copy of the NHS guide', () => {
    assert.doesNotMatch(PAGE, /NHS Guide|NHS 111/);
    assert.match(PAGE, /<h1>Arriving late<\/h1>/);
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

if (process.argv.includes('--links')) {
  const links = [...new Set([...Object.values(SOURCES), ...Object.values(LINKS)].map((link) => link.href))];
  console.log(`\nOpening ${links.length} links, one a second (Student Portal links may answer with its log-in page)...`);
  let broken = 0;
  for (const link of links) {
    let status;
    try {
      status = (await fetch(link, { headers: { 'User-Agent': 'AG2StudentApp-link-check/1.0 (Northumbria University student project)' }, signal: AbortSignal.timeout(30_000) })).status;
    } catch (err) {
      status = /** @type {Error} */ (err).name;
    }
    if (status !== 200) broken++;
    console.log(`  ${status === 200 ? 'ok ' : 'BAD'}  ${status}  ${link}`);
    await new Promise((done) => setTimeout(done, 1000));
  }
  console.log(`\n${links.length - broken}/${links.length} links answer`);
  if (broken) failed++;
}
process.exit(failed === 0 ? 0 : 1);
