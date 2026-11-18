// Checks the five screens laid out like the group's wireframes (design-reference/, ignored by git):
// the bottom bar, Need help now, the GP and dentist finder, the checklist and Home.
// 1. Offline, in Node: the bottom bar's tabs come from one list (nav-tabs.js) that the bar draws and
//    the page transitions crossfade between (Home, Checklist, Chat in the middle, Societies, More),
//    and Mentor stays one tap away on More; Need help now is four one-tap cards, most urgent first,
//    each with the official page its number and words were checked against, then "Not urgent?" with
//    what the page had (with --links, every source page is asked, one a second).
// Run from the project folder:
//   node scripts/check-layout.mjs [--links]
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-layout.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALWAYS_OPEN, PUBLIC_PAGES } from '#lib/account-gate.js';
import { TAB_PATHS, TABS } from '#lib/nav-tabs.js';
import { CHECKED_ON, URGENT_HELP } from '#lib/need-help/urgent.js';
import { TABS as TRANSITION_TABS, transitionFor } from '#lib/page-transitions.js';
import { emulators, sleep } from './lib/emulator-app.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const LINKS = process.argv.includes('--links');

/** @type {[string, () => void][]} */
const offline = [
  ['The bottom bar: Home, Checklist, Chat in the middle, Societies where Mentor was, More; in one list that the bar draws and the transitions crossfade between', () => {
    assert.deepEqual(TABS.map((tab) => tab.name), ['Home', 'Checklist', 'Chat', 'Societies', 'More']);
    assert.deepEqual([...TAB_PATHS], ['/home', '/checklist', '/check-in', '/societies', '/more']);
    assert.equal(TRANSITION_TABS, TAB_PATHS, 'the transitions use the same list');
    assert.equal(transitionFor('/home', '/societies'), 'tab', 'between tabs: a crossfade');
    assert.equal(transitionFor('/home', '/mentor'), 'forward', 'Mentor is a page below the bar now');
    assert.equal(transitionFor('/societies', '/societies/15'), 'forward');
    const bar = source('src/lib/components/BottomNav.svelte');
    assert.match(bar, /import \{ TABS \} from '#lib\/nav-tabs\.js';/);
    assert.match(bar, /const links = TABS;/);
    assert.doesNotMatch(bar, /href: '\/mentor'/, 'no tab list of its own');
    assert.match(source('src/lib/page-transitions.js'), /export const TABS = TAB_PATHS;/);
  }],
  ['Mentor stays one tap away: Your Mentor is first on More', () => {
    const more = source('src/routes/more/+page.svelte');
    assert.match(more, /const menu = \/\*\* @type \{const\} \*\/ \(\[\s*\{ name: 'Your Mentor', href: '\/mentor', icon: 'mentor' \},/);
  }],
  ['Need help now: four one-tap cards, most urgent first (999, NHS 111, Samaritans 116 123, Shout 85258), each a tel: or sms: link with the official page it was checked against, and nothing "to confirm"', () => {
    assert.deepEqual(URGENT_HELP.map((help) => [help.id, help.href]), [['999', 'tel:999'], ['111', 'tel:111'], ['samaritans', 'tel:116123'], ['shout', 'sms:85258?&body=SHOUT']]);
    for (const help of URGENT_HELP) {
      assert.match(help.source.href, /^https:\/\/(?:www\.)?(?:nhs\.uk|samaritans\.org|giveusashout\.org)\//, `${help.id}: an official source`);
      assert.ok(help.title.length > 0 && help.words.length > 0, `${help.id}: a title and a line`);
      assert.doesNotMatch(`${help.title} ${help.words}`, /confirm/i, `${help.id}: a crisis page carries no "to confirm"`);
    }
    assert.equal(URGENT_HELP[0].tone, 'danger', '999 is the filled red card');
    assert.match(URGENT_HELP[1].words, /select the mental health option/, 'as the NHS page puts it: no option number');
    assert.doesNotMatch(URGENT_HELP[1].words, /free|24/, 'the NHS pages don’t say 111 is free or round the clock');
    assert.match(URGENT_HELP[2].words, /free, 24 hours a day, 365 days a year/);
    assert.match(URGENT_HELP[3].words, /free, confidential and 24\/7, for anyone in the UK/);
    assert.match(CHECKED_ON, /^\d{1,2} \w+ 2026$/);
  }],
  ['The Need help page: help first and no questions, the cards from that list, then "Not urgent?" with Ask4Help to call, the counselling page and the Students’ Union, as before; it opens without logging in', () => {
    const page = source('src/routes/need-help/+page.svelte');
    assert.match(page, /\{#each URGENT_HELP as help \(help\.id\)\}[\s\S]*<a class="help-card \{help\.tone\}" href=\{help\.href\}>/);
    assert.ok(page.indexOf('{#each URGENT_HELP') < page.indexOf('<h2>Not urgent?</h2>'), 'the cards come first');
    assert.ok(page.indexOf('<h1>Need help now?</h1>') < page.indexOf('{#each URGENT_HELP'), 'straight after the heading');
    for (const words of ['<BackLink />', 'href="tel:+441912274646"', 'Call Ask4Help on 0191 227 4646', 'counselling-and-mental-health-support/overview-of-support/', '<h3>University support</h3>', '{#each nsuHelp as service (service.id)}', '<a href="/home">Return to Home</a>']) {
      assert.ok(page.includes(words), words);
    }
    assert.doesNotMatch(page, /to confirm|to be confirmed/i);
    assert.ok(PUBLIC_PAGES.includes('/need-help') && ALWAYS_OPEN.includes('/need-help'), 'without logging in, whatever state an account is in');
  }],
  ['One finder for GPs and dentists, with a tab for each: on the GP tab the search and results come first, each result has "How to register", and the Registering facts sit below; the Dentist tab has the postcode box, NHS Find a dentist and the steps; the reminder to check with the practice stays', () => {
    const page = source('src/routes/gp-finder/+page.svelte');
    assert.match(page, /let tab = \$derived\(page\.url\.searchParams\.get\('tab'\) === 'dentist' \? 'dentist' : 'gp'\);/, 'the tab is in the address, so the checklist can open it');
    assert.match(page, /<a href="\/gp-finder" class:active=\{tab === 'gp'\}/);
    assert.match(page, /<a href="\/gp-finder\?tab=dentist" class:active=\{tab === 'dentist'\}/);
    const gpTab = page.slice(page.indexOf("{#if tab === 'gp'}"), page.indexOf('{:else}'));
    const order = ['id="search"', 'Use my location', '{#if finder.results}', 'How to register ↗', 'Phone the practice to check before you visit', '<h2>Registering</h2>', 'More in the NHS Guide'];
    for (let i = 1; i < order.length; i++) assert.ok(gpTab.indexOf(order[i - 1]) !== -1 && gpTab.indexOf(order[i - 1]) < gpTab.indexOf(order[i]), `${order[i - 1]} comes before ${order[i]}`);
    assert.match(gpTab, /href=\{practicePageUrl\(practice\)\}[\s\S]{0,400}How to register ↗/, 'each result’s How to register opens its NHS page');
    for (const kept of ['REGISTERING.free, REGISTERING.documents, REGISTERING.studentRegistration, REGISTERING.healthHub', 'Nearest GP surgeries to', 'More surgeries on NHS Find a GP', 'Show {Math.min(RESULTS', 'Organisation Data Service']) assert.ok(page.includes(kept), `kept: ${kept}`);
    const dentistTab = page.slice(page.indexOf('{:else}'), page.indexOf('<BottomNav />'));
    for (const words of ['id="dentist-search"', 'Find dentists', 'It’s only used to open NHS Find a dentist for it. Nothing is saved.', 'NHS Find a dentist near {dentist.label} ↗', '{#each dentistHowTo.steps as step, i (i)}', 'Phone the practice to check before you visit']) assert.ok(dentistTab.includes(words), words);
    assert.match(page, /const dentistHowTo = HOW_TO\.dentist;/, 'the checklist’s steps, not a second copy');
    assert.match(page, /if \(wanted\.kind === 'postcode' \|\| wanted\.kind === 'district'\) dentist = \{ href: findADentistUrl\(wanted\.value\), label: wanted\.value \};/, 'as the chat’s dentist card does');
    assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB|document\.cookie/, 'nothing typed is stored');
  }]
];

/** With --links: every card's source page still answers (one a second, as the NHS guide check does). */
async function sourcesAnswer() {
  for (const help of URGENT_HELP) {
    const response = await fetch(help.source.href, { redirect: 'follow', signal: AbortSignal.timeout(15000) }).catch((err) => ({ ok: false, status: String(err?.message ?? err) }));
    console.log(`${response.ok ? 'PASS' : 'FAIL'}  ${help.id}: ${help.source.label} answers (${response.status})`);
    if (!response.ok) failed++;
    total++;
    await sleep(1000);
  }
}

let failed = 0;
let total = 0;
for (const [name, check] of offline) {
  total++;
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}

if (LINKS) await sourcesAnswer();

const where = emulators();
if (!where) {
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-layout.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
