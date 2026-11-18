// Checks the NHS guide (src/lib/nhs/guide.js, nhs-costs.json and the page): every fact links to its
// official source, every money figure comes from the data file (with the date it was checked), the
// Student GP Registration website has its sources (the site and Northumbria's page), app links go to
// real pages, and the chat can link the guide. Offline by default.
//
// With --links it also opens every source link (one a second) and says which don't answer:
//   node scripts/check-nhs-guide.mjs --links
// Run from the project folder:
//   node scripts/check-nhs-guide.mjs

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import costs from '#lib/nhs/nhs-costs.json' with { type: 'json' };
import { COSTS_CHECKED_ON, REGISTERING, SECTIONS, SOURCES, withFigures } from '#lib/nhs/guide.js';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { CHAT_PAGES, chatTools } from '#lib/checkin/chat-tools.js';

/**
 * Where official sources live: GOV.UK, the NHS website, the NHSBSA, Northumbria University, and the
 * Student GP Registration website (run on behalf of Newcastle and Northumbria universities).
 */
const OFFICIAL = /^https:\/\/(?:www\.)?(?:gov\.uk|nhs\.uk|nhsbsa\.nhs\.uk|northumbria\.ac\.uk|studentgpreg\.org\.uk)\//;
/** @type {Record<string, { amount: string, label: string, source: string }>} */
const FIGURES = costs.figures;
const PAGE = readFileSync('src/routes/nhs-guide/+page.svelte', 'utf8');

/** Every piece of text in the guide, before figures are filled in. */
const texts = SECTIONS.flatMap((section) => [section.title, section.intro, ...section.points.map((point) => point.text), ...(section.terms ?? []).map((term) => term.meaning)]);

/** @type {[string, () => void][]} */
const checks = [
  ['The eight sections, in order', () => {
    assert.deepEqual(SECTIONS.map((section) => section.id), ['paid', 'gp', 'where', 'hub', 'costs', 'app', 'mental-health', 'words']);
    for (const section of SECTIONS) assert.ok(section.points.length + (section.terms?.length ?? 0) > 0, `${section.id} is empty`);
  }],
  ['Every point is a fact with an official source, a link to a page in the app, or marked "to be confirmed"', () => {
    for (const section of SECTIONS) {
      for (const point of section.points) {
        const where = `${section.id}: "${point.text.slice(0, 50)}"`;
        if (point.source) {
          assert.match(point.source.href, OFFICIAL, where);
          if (point.link) assert.match(point.link.href, OFFICIAL, `${where}: its further link`);
        } else if (point.app) assert.ok(existsSync(`src/routes${point.app.href}/+page.svelte`), `${where}: no page at ${point.app.href}`);
        else assert.ok(point.toBeConfirmed && point.link?.href.startsWith('https://'), `${where} has no source`);
      }
      for (const term of section.terms ?? []) assert.match(term.source.href, OFFICIAL, term.term);
    }
    for (const source of Object.values(SOURCES)) assert.match(source.href, OFFICIAL, source.label);
  }],
  ['Student GP Registration: confirmed (its own site says it\'s run for both universities), with Northumbria\'s page linked too', () => {
    const point = /** @type {import('#lib/nhs/guide.js').Point} */ (REGISTERING.studentRegistration);
    assert.equal(point.toBeConfirmed, undefined);
    assert.equal(point.source?.href, 'https://www.studentgpreg.org.uk/');
    assert.equal(point.link?.href, 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/international-student-support/registering-with-a-doctor/');
    assert.deepEqual(SECTIONS.flatMap((section) => section.points).filter((p) => p.toBeConfirmed), [], 'nothing is left to be confirmed');
  }],
  ['No money figure is written in the guide or the page: each comes from nhs-costs.json', () => {
    for (const text of texts) assert.doesNotMatch(text, /£|\bpounds?\b/i, text);
    assert.doesNotMatch(PAGE.replace(/<style>[\s\S]*<\/style>/, ''), /£/);
    const used = new Set(texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
    for (const name of used) assert.ok(FIGURES[name], `{${name}} isn't in nhs-costs.json`);
    assert.deepEqual(Object.keys(FIGURES).filter((name) => !used.has(name)), [], 'every figure in the file is used');
    for (const text of texts) assert.doesNotMatch(withFigures(text), /\{\w+\}/, text);
  }],
  ['Each figure has an amount, a label and an official source; the file says when they were checked, and the page shows it', () => {
    for (const [name, figure] of Object.entries(FIGURES)) {
      assert.match(figure.amount, /^£\d{1,3}(?:,\d{3})*(?:\.\d\d)?$/, name);
      assert.ok(figure.label.trim(), name);
      assert.match(figure.source, OFFICIAL, name);
    }
    const checked = new Date(`${costs.checkedOn}T12:00:00Z`);
    assert.ok(!Number.isNaN(checked.getTime()) && checked.getTime() <= Date.now(), 'checkedOn is a date, not in the future');
    assert.match(COSTS_CHECKED_ON, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    assert.match(PAGE, /COSTS_CHECKED_ON/);
  }],
  ['The chat can link the guide, and is told to answer NHS questions briefly with no prices', () => {
    assert.equal(CHAT_PAGES['NHS guide'].href, '/nhs-guide');
    const tools = Object.fromEntries(chatTools({ match: null, tasks: null })[0].functionDeclarations.map((/** @type {any} */ tool) => [tool.name, tool.description]));
    assert.match(tools.show_page, /the NHS guide when they ask how the NHS works or whether they pay to see a doctor \(answer in one short sentence yourself, without prices or other figures: seeing a GP is free, but they'll still pay for some things, such as prescriptions, dental treatment and eye tests, and the guide has the details\)/);
    assert.match(tools.show_finder, /Shows the GP finder \(surgeries near where they live\)/, 'registering with a GP: the finder, in the chat');
    assert.doesNotMatch(chatInstructions('(about)') + JSON.stringify(tools), /£/, 'the chat is never given the figures');
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
  const links = [...new Set([
    ...Object.values(SOURCES).map((source) => source.href),
    ...Object.values(FIGURES).map((figure) => figure.source)
  ])];
  console.log(`\nOpening ${links.length} links, one a second...`);
  let broken = 0;
  for (const link of links) {
    let status;
    try {
      const response = await fetch(link, { headers: { 'User-Agent': 'AG2StudentApp-link-check/1.0 (Northumbria University student project)' }, signal: AbortSignal.timeout(30_000) });
      status = response.status;
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
