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
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ALWAYS_OPEN, PUBLIC_PAGES } from '#lib/account-gate.js';
import { isoDate } from '#lib/checkin/about-you.js';
import { HOW_TO } from '#lib/checklist/how-to.js';
import { nextTask, societiesForYou, weekLine } from '#lib/home/dashboard.js';
import { TAB_PATHS, TABS } from '#lib/nav-tabs.js';
import { CHECKED_ON, URGENT_HELP } from '#lib/need-help/urgent.js';
import { TABS as TRANSITION_TABS, transitionFor } from '#lib/page-transitions.js';
import { emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';

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
  }],
  ['The checklist: each task with a screen in the app has a button that does it (Find a GP; Find one, the dentist tab; Browse, societies; See them, the contacts), ticked tasks keep "How to", and deleting is tucked under "How to", one tap once it’s open', () => {
    const buttons = Object.fromEntries(Object.entries(HOW_TO).filter(([, how]) => how.do).map(([id, how]) => [id, [how.do?.label, how.do?.href]]));
    assert.deepEqual(buttons, { gp: ['Find a GP', '/gp-finder'], society: ['Browse', '/societies'], dentist: ['Find one', '/gp-finder?tab=dentist'], contacts: ['See them', '/need-help'] });
    assert.equal(HOW_TO.enrol.do, undefined, 'Enrol is done on the Student Portal, not a screen in the app: it keeps How to');
    const page = source('src/routes/checklist/+page.svelte');
    assert.match(page, /\{#if howTo\?\.do && !task\.done\}\s*<!--[^>]*-->\s*<a class="secondary-button do" href=\{howTo\.do\.href\}>\{howTo\.do\.label\}/, 'the button on the row, until it’s ticked');
    const rowStart = page.indexOf('<div class="task-row">');
    const row = page.slice(rowStart, page.indexOf('</div>', rowStart));
    assert.doesNotMatch(row, /Delete \$\{task\.title\}/, 'no bin on the row');
    const details = page.slice(page.indexOf('<details class="how-to">'), page.indexOf('</details>'));
    assert.match(details, /<button class="secondary-button delete-task" type="button" onclick=\{\(\) => removeTask\(task\)\} aria-label=\{`Delete \$\{task\.title\}`\}>Delete this task<\/button>\s*<Ask4HelpLink about=\{task\.title\} \/>/);
    assert.match(page, /\{#each tasks as task \(task\.id\)\}/, 'ticked tasks stay in the list');
    assert.match(page, /class:finished=\{task\.done\}/, 'and look done');
    assert.match(source('src/routes/privacy/+page.svelte'), /<strong>Checklist tasks:<\/strong> open “How to” \(or “Stuck\?”\) under the task on your checklist, then Delete this task\./, 'Privacy says where deleting lives now');
  }],
  ['Home as a dashboard: Need help now at the top right, the checklist with its next task and the button that does it, the mentor in whichever state, the way into the chat, Societies for you; Log out off Home; nothing calls Gemini', () => {
    const home = source('src/routes/home/+page.svelte');
    for (const words of ['<a class="help-pill" href="/need-help">', "{week ?? 'How can we help you today?'}", '<h2 id="checklist-title"><a href="/checklist">Your checklist</a></h2>', 'Next: {checklist.next.title}',
      'href={checklist.next.do.href}', '<h2 id="mentor-title"><a href="/mentor">Your mentor</a></h2>', "mentor === 'waiting'", "mentor === 'matched'", 'href="/find-mentor">Find my mentor</a>',
      '<a class="ask" href="/check-in">', 'Societies for you', '<a href="/societies">See all</a>', 'Try something new', '<FinishDetailsCard />']) {
      assert.ok(home.includes(words), words);
    }
    assert.doesNotMatch(home.slice(home.indexOf('<main')), /LogoutButton|feature-grid|Log out/, 'Log out is on More, and no menu of tiles');
    assert.doesNotMatch(home, /from '#lib\/firebase\/ai|from '#lib\/checkin\/chat/, 'Home never calls Gemini: nothing of the chat’s is imported');
    assert.match(home, /import \{ nextTask, societiesForYou, weekLine \} from '#lib\/home\/dashboard\.js';/);
    assert.match(source('src/lib/home/dashboard.js'), /import \{ shortlist \} from '#lib\/suggestions\/shortlist\.js';/, 'the app’s own matching, through one small module');
    assert.match(source('src/routes/mentor/+page.svelte'), /<BackLink \/>/, 'Your mentor is below the bar now, so it has a way back');
    assert.equal(weekLine('2026-11-10', new Date(2026, 10, 18)), 'Week 2 at Northumbria');
    assert.equal(weekLine('2026-11-18', new Date(2026, 10, 18)), 'Week 1 at Northumbria', 'the day they arrive');
    assert.equal(weekLine('2026-11-19', new Date(2026, 10, 18)), null, 'not arrived yet: nothing');
    assert.equal(weekLine('2025-11-01', new Date(2026, 10, 18)), null, 'a year on: nothing');
    for (const bad of ['', null, undefined, '2026-13-40', 'soon']) assert.equal(weekLine(bad, new Date()), null, String(bad));
    assert.deepEqual(nextTask([{ id: 'enrol', title: 'Enrol', done: true }, { id: 'gp', title: 'Register with a GP', done: false }]), { id: 'gp', title: 'Register with a GP', do: { label: 'Find a GP', href: '/gp-finder' } });
    assert.deepEqual(nextTask([{ id: 'enrol', title: 'Enrol', done: false }]), { id: 'enrol', title: 'Enrol', do: null }, 'no screen in the app: How to');
    assert.equal(nextTask([{ id: 'enrol', title: 'Enrol', done: true }]), null, 'all done');
    const picks = societiesForYou(['Climbing', 'Gaming'], 3);
    assert.deepEqual(picks.matches.map((society) => society.name), ['Climbing', 'Video Game'], 'two that match their interests');
    assert.ok(picks.tryNew !== null && !picks.matches.includes(picks.tryNew) && picks.tryNew.campus === 'Newcastle', 'one to try that isn’t a match');
    assert.notEqual(societiesForYou(['Climbing'], 3).tryNew?.name, societiesForYou(['Climbing'], 4).tryNew?.name, 'which changes each day');
    assert.deepEqual(societiesForYou([], 3).matches, [], 'no interests: no matches made up');
    assert.deepEqual(societiesForYou(['zzzz'], 3).matches, [], 'nothing that matches: none');
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
if (where) {
  const results = await inTheBrowser(where);
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-layout.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * The five screens in Chrome, with three students in the three mentor states (none yet, waiting for
 * the coordinator, matched), and logged out for Need help now.
 * @param {{ auth: string, firestore: string, project: string }} where
 * @returns {Promise<boolean[]>}
 */
async function inTheBrowser(where) {
  /** @type {boolean[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const report = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const db = owner(where);
  const password = randomBytes(18).toString('base64url');
  const tenDaysAgo = isoDate(new Date(Date.now() - 10 * 86_400_000));
  const checklist = [
    { id: 'enrol', title: 'Enrol', done: true },
    { id: 'gp', title: 'Register with a GP', done: false },
    { id: 'student-id', title: 'Collect student ID', done: false },
    { id: 'society', title: 'Join a society', done: false },
    { id: 'dentist', title: 'Find a dentist', done: false },
    { id: 'contacts', title: 'Save key contacts', done: false }
  ];
  /** @param {string} name @param {string} email @param {Record<string, unknown>} more */
  const student = async (name, email, more = {}) => {
    const uid = await db.verifiedAccount(email, password);
    await db.seed(`students/${uid}`, { name, course: 'BSc Law', email, arrivalDate: '', role: 'student', studentType: 'home', wantsMentor: false, interests: [], checklist, checklistOffered: ['enrol'], ...more });
    return uid;
  };
  const nina = 'nina.none@northumbria.ac.uk';
  await student('Nina Student', nina, { arrivalDate: tenDaysAgo, interests: ['Climbing', 'Gaming'] });
  const wes = 'wes.waiting@northumbria.ac.uk';
  const wesUid = await student('Wes Student', wes);
  await db.seed(`matches/${wesUid}`, { status: 'coordinator', meetingFrequency: 'weekly', availability: '', createdAt: new Date() });
  const mia = 'mia.matched@northumbria.ac.uk';
  const miaUid = await student('Mia Student', mia);
  await db.seed(`matches/${miaUid}`, { status: 'matched', mentorId: 'mentor-alex', mentorName: 'Alex Mentor', reasons: ['You share interests: climbing'], meetingFrequency: 'every two weeks', availability: '', createdAt: new Date() });

  const app = await startApp();
  /** @typedef {Awaited<ReturnType<typeof openChrome>>} Page */
  /** A part in its own Chrome, with a fresh profile, and every request it made. @param {(page: Page, requests: string[]) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    /** @type {string[]} */
    const requests = [];
    await page.send('Network.enable');
    page.listen((message) => {
      if (message.method === 'Network.requestWillBeSent') requests.push(String(message.params.request.url));
    });
    try {
      await part(page, requests);
    } finally {
      await page.close();
    }
  };
  /** The hrefs of the links matching a selector, in order. @param {Page} page @param {string} selector */
  const hrefs = (page, selector) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((a) => a.getAttribute('href'))`);
  /** @param {Page} page @param {string} selector */
  const tap = (page, selector) => page.evaluate(`(document.querySelector(${JSON.stringify(selector)}).click(), true)`);

  try {
    // 1. Nina: no mentor yet, a GP to register with next, interests, arrived ten days ago.
    await inFreshChrome(async (page, requests) => {
      report('A student logs in to Home', await page.logIn(nina, password));
      await page.waitFor(page.has('Hi Nina'));
      report('Home: Need help now is in view at the top, a one-tap link', (await hrefs(page, 'header .help-pill')).join() === '/need-help');
      report('"Week 2 at Northumbria", from the arrival date she gave', await page.evaluate(page.has('Week 2 at Northumbria')));
      report('Her checklist: 1 of 6 done, next Register with a GP, with Find a GP', (await page.waitFor(page.has('1 of 6 done'))) && (await page.evaluate(page.has('Next: Register with a GP'))) && (await hrefs(page, '.dash a.do[href="/gp-finder"]')).length === 1);
      report('Her mentor: none yet, so Home offers to find one', (await page.waitFor(page.has('No mentor yet'))) && (await hrefs(page, '.dash a[href="/find-mentor"]')).length === 1);
      report('Ask me anything is still there, into the chat', (await hrefs(page, 'a.ask')).join() === '/check-in');
      const societies = await page.evaluate(`[...document.querySelectorAll('.societies li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim())`);
      report('Societies for you: Climbing and Video Game match her interests, one to try something new, and See all', societies.length === 3 && /^Climbing Matches your interests$/.test(societies[0]) && /^Video Game Matches your interests$/.test(societies[1]) && /Try something new$/.test(societies[2]) && (await hrefs(page, '.dash a[href="/societies"]')).length === 1, JSON.stringify(societies));
      report('No Log out on Home (it’s on More), and no menu of tiles', !(await page.evaluate(page.has('Log out'))) && !(await page.evaluate(`document.querySelector('.feature-grid')`)));
      report('Home made no request to Gemini', !requests.some((url) => /firebasevertexai|generativelanguage/.test(url)), requests.filter((url) => /google/.test(url)).map((url) => new URL(url).host).join(', '));
      await tap(page, '.dash a.do[href="/gp-finder"]');
      report('Find a GP: one tap after opening Home, she’s on the finder, searching for a surgery', await page.waitFor(`location.pathname === '/gp-finder' && ${page.has('Find GPs')}`));
      await tap(page, 'nav.tabs a[href="/gp-finder?tab=dentist"]');
      report('The finder’s Dentist tab: the postcode box, NHS Find a dentist and the steps', (await page.waitFor(`location.search === '?tab=dentist' && ${page.has('Find dentists')}`)) && (await page.evaluate(page.has('Finding an NHS dentist'))));
      await page.fill('#dentist-search', 'NE1 8ST');
      await page.press('Find dentists');
      report('A postcode opens NHS Find a dentist for it', await page.waitFor(`[...document.querySelectorAll('a')].some((a) => a.href.includes('find-a-dentist/results?location=NE1'))`));
      await tap(page, 'nav.tabs a[href="/gp-finder"]');
      report('...and the GP tab comes back, with Registering below the results', (await page.waitFor(`location.search === '' && ${page.has('Find GPs')}`)) && (await page.evaluate(page.has('Registering'))));
      await page.go('/checklist');
      await page.waitFor(page.has('Find a dentist'));
      report('The checklist: Find one on Find a dentist, Browse on Join a society, no button on ticked Enrol, and no bin on any row', (await hrefs(page, '.task-row a.do')).join() === '/gp-finder,/societies,/gp-finder?tab=dentist,/need-help' && (await page.evaluate(`document.querySelectorAll('.task-row button.delete').length`)) === 0 && (await page.evaluate(`document.querySelectorAll('details.how-to .delete-task').length`)) === 6);
      await tap(page, '.task-row a.do[href="/gp-finder?tab=dentist"]');
      report('Find one opens the finder’s Dentist tab', await page.waitFor(`location.pathname === '/gp-finder' && location.search === '?tab=dentist'`));
      await page.go('/home');
      await page.waitFor(page.has('Hi Nina'));
      await tap(page, 'header .help-pill');
      report('Need help now: one tap from Home, the four cards in order, each a real tel: or sms: link', (await page.waitFor(`location.pathname === '/need-help' && ${page.has('Not urgent?')}`)) && (await hrefs(page, 'a.help-card')).join() === 'tel:999,tel:111,tel:116123,sms:85258?&body=SHOUT');
      report('The bottom bar: Home, Checklist, Chat, Societies, More', (await page.evaluate(`[...document.querySelectorAll('nav.bottom-nav a .label')].map((l) => l.textContent.trim()).join()`)) === 'Home,Checklist,Chat,Societies,More' || (await page.evaluate(`document.querySelector('nav.bottom-nav') === null`)), 'Need help has no bar; checked next');
      await page.go('/checklist');
      await page.waitFor(page.has('Your checklist'));
      report('The bottom bar on the checklist: Home, Checklist, Chat, Societies, More, and Societies opens the list', (await page.evaluate(`[...document.querySelectorAll('nav.bottom-nav a .label')].map((l) => l.textContent.trim()).join()`)) === 'Home,Checklist,Chat,Societies,More' && (await tap(page, 'nav.bottom-nav a[href="/societies"]')) && (await page.waitFor(`location.pathname === '/societies'`)));
    });

    // 2. Wes: waiting for the coordinator; no arrival date.
    await inFreshChrome(async (page) => {
      report('A student waiting for the coordinator logs in', await page.logIn(wes, password));
      await page.waitFor(page.has('Hi Wes'));
      report('His mentor card says the coordinator is finding one, with no offer to find one', (await page.waitFor(page.has('We’re finding you a mentor'))) && !(await page.evaluate(page.has('Find my mentor'))));
      report('No arrival date: no week line, "How can we help you today?" instead', (await page.evaluate(page.has('How can we help you today?'))) && !(await page.evaluate(page.has('at Northumbria'))));
    });

    // 3. Mia: matched.
    await inFreshChrome(async (page) => {
      report('A matched student logs in', await page.logIn(mia, password));
      await page.waitFor(page.has('Hi Mia'));
      report('Her mentor card: the mentor’s name, how to get in touch, how often, and Your mentor page', (await page.waitFor(page.has('Alex Mentor'))) && (await page.evaluate(page.has('your coordinator will introduce you'))) && (await page.evaluate(page.has('every two weeks'))) && (await hrefs(page, '.dash a.do[href="/mentor"]')).length === 1);
      await tap(page, '.dash a.do[href="/mentor"]');
      report('Your mentor page opens with a way back to Home', (await page.waitFor(`location.pathname === '/mentor' && ${page.has('← Back')}`)) && (await page.evaluate(`([...document.querySelectorAll('button, a')].find((e) => e.textContent.trim().includes('← Back')).click(), true)`)) && (await page.waitFor(`location.pathname === '/home'`)));
    });

    // 4. Logged out: Need help now still opens, with its cards.
    await inFreshChrome(async (page) => {
      await page.go('/need-help');
      report('Logged out, Need help now opens with the four cards', (await page.waitFor(`location.pathname === '/need-help' && ${page.has('Need help now?')}`)) && (await hrefs(page, 'a.help-card')).length === 4);
    });
  } finally {
    app.stop();
  }
  return results;
}
