// Checks the checklist's Enrol task and how-tos (src/lib/checklist/tasks.js and how-to.js):
// 1. Offline, in Node: every standard task has a how-to (two to four steps, a link, official sources);
//    Enrol's steps are the ones given; "Stuck? Contact Ask4Help" has Ask4Help Online and its number,
//    the same as the Need help page, on the checklist page and under every task; the phone numbers
//    in the how-tos are the official ones.
// 2. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators): a checklist saved
//    before Enrol existed gets it at the top, keeping its own tasks and ticks; ticking it saves it
//    and notes it as had, so once deleted it stays deleted; a full list is left as it is; the how-to
//    opens under a task, with its steps, link, sources and Ask4Help.
// 3. With --links: every link and source still answers (asks Northumbria, the NHS and the NSU).
// Made-up people only; nothing real is touched (project demo-ag2). Run from the project folder:
//   node scripts/check-checklist-how-to.mjs [--links]
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-checklist-how-to.mjs"
// The second needs Java 21 or newer, and Google Chrome (or CHROME=<path to Chrome>). With
// SCREENSHOTS=<folder>, it also saves a phone-size picture of a how-to there.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASK4HELP, HOW_TO, SOURCES } from '#lib/checklist/how-to.js';
import { DEFAULT_TASKS, MAX_TASKS } from '#lib/checklist/tasks.js';
import { emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');
const OFFICIAL = /^https:\/\/(www\.northumbria\.ac\.uk|www\.nhs\.uk|mynsu\.co\.uk)\//;

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['Every standard task has a how-to: two to four steps, each a sentence, a link to act on, and official sources (Northumbria, the NHS or the Students’ Union)', () => {
    assert.deepEqual(Object.keys(HOW_TO).sort(), DEFAULT_TASKS.map((task) => task.id).sort(), 'one for each standard task, and no others');
    for (const task of DEFAULT_TASKS) {
      const howTo = HOW_TO[task.id];
      assert.ok(howTo.steps.length >= 2 && howTo.steps.length <= 4, `${task.id}: ${howTo.steps.length} steps`);
      for (const step of howTo.steps) {
        assert.match(step, /^[A-Z][\s\S]*[.)]$/, `${task.id}: "${step}" is a sentence`);
        assert.ok(step.length <= 200, `${task.id}: a step of ${step.length} characters`);
      }
      assert.ok(howTo.link.label && /^(\/|https:\/\/)/.test(howTo.link.href), `${task.id}: its link`);
      assert.ok(howTo.sources.length >= 1, `${task.id}: its sources`);
      for (const page of howTo.sources) assert.match(page.href, OFFICIAL, `${task.id}: ${page.href}`);
    }
  }],
  ['Enrol comes first, with the steps given: the Right to Study check first, the Student Portal’s Enrol on the main menu, the confirmation email to their university and personal email, and “Understanding the enrolment process” in Ask4Help Online', () => {
    assert.deepEqual(DEFAULT_TASKS[0], { id: 'enrol', title: 'Enrol', done: false });
    const [first, second, third, fourth] = HOW_TO.enrol.steps;
    assert.match(first, /Right to Study check first/);
    assert.match(second, /Log in to the Student Portal, choose Enrol from the main menu and follow the steps\./);
    assert.match(third, /confirmation email goes to your university and personal email addresses/);
    assert.match(fourth, /“Understanding the enrolment process” in Ask4Help Online/);
    assert.equal(HOW_TO.enrol.link.href, 'https://myportal.northumbria.ac.uk/');
    assert.deepEqual(HOW_TO.enrol.sources, [SOURCES.visaEnrolment, SOURCES.enrolment]);
  }],
  ['Stuck? Contact Ask4Help: Ask4Help Online and 0191 227 4646 to call, the same as the Need help page; on the checklist page and under every task', () => {
    assert.equal(ASK4HELP.online.href, 'https://myportal.northumbria.ac.uk/Help-and-support');
    assert.equal(ASK4HELP.phone, '0191 227 4646');
    assert.equal(ASK4HELP.tel, 'tel:+441912274646');
    assert.ok(source('src/routes/need-help/+page.svelte').includes(`href="${ASK4HELP.tel}"`), 'the Need help page calls the same number');
    const link = source('src/lib/components/Ask4HelpLink.svelte');
    assert.match(oneLine(link), /Stuck\? Contact Ask4Help: <a href=\{ASK4HELP\.online\.href\} target="_blank"/);
    assert.match(link, /or call <a href=\{ASK4HELP\.tel\}>\{ASK4HELP\.phone\}<\/a>\./);
    const page = source('src/routes/checklist/+page.svelte');
    assert.match(page, /<\/p>\s*<Ask4HelpLink \/>/, 'on the page, under its introduction');
    assert.match(page, /<details class="how-to">[\s\S]*<Ask4HelpLink about=\{task\.title\} \/>\s*<\/details>/, 'under every task');
  }],
  ['The checklist page shows each standard task’s steps, its link and its sources under “How to”, and the student’s own tasks “Stuck?”', () => {
    const page = oneLine(source('src/routes/checklist/+page.svelte'));
    assert.match(page, /\{@const howTo = howToFor\(task\.id\)\}/);
    assert.match(page, /<summary>\{howTo \? 'How to' : 'Stuck\?'\}<span class="visually-hidden">: \{task\.title\}<\/span><\/summary>/);
    assert.match(page, /\{#each howTo\.steps as step, i \(i\)\} <li>\{step\}<\/li> \{\/each\}/);
    assert.match(page, /\{#each howTo\.sources as source, i \(source\.href\)\}/);
  }],
  ['The phone numbers in the how-tos are the official ones: Campus Security 0191 227 3200 (emergencies) and 0191 227 3999, Ask4Help 0191 227 4646, 999 and 101', () => {
    const contacts = HOW_TO.contacts.steps.join(' ');
    for (const number of ['0191 227 3200', '0191 227 3999', '0191 227 4646', '999', '101']) assert.ok(contacts.includes(number), number);
    assert.match(contacts, /0191 227 3200 for emergencies on campus \(it’s staffed 24 hours\) and 0191 227 3999 for anything else/);
    assert.deepEqual(HOW_TO.contacts.sources, [SOURCES.security, SOURCES.safety, SOURCES.ask4HelpPhone]);
  }]
];

let failed = 0;
for (const [name, check] of offline) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
let total = offline.length;
const where = emulators();
if (where) {
  const results = await inTheBrowser(where);
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-checklist-how-to.mjs")');
}
if (process.argv.includes('--links')) {
  const results = await linksAnswer();
  total += results.length;
  failed += results.filter((ok) => !ok).length;
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Every outside link and source, asked whether it still answers.
 * @returns {Promise<boolean[]>}
 */
async function linksAnswer() {
  const pages = new Map();
  for (const howTo of Object.values(HOW_TO)) for (const page of [howTo.link, ...howTo.sources]) if (page.href.startsWith('https://')) pages.set(page.href, page.label);
  pages.set(ASK4HELP.online.href, ASK4HELP.online.label);
  /** @type {string[]} */
  const broken = [];
  for (const [href, label] of pages) {
    const status = await fetch(href, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (link check)' }, signal: AbortSignal.timeout(20000) }).then((response) => response.status, (err) => String(err?.name ?? err));
    if (status !== 200) broken.push(`${label}: ${status}`);
  }
  console.log(`${broken.length ? 'FAIL' : 'PASS'}  Every link and source answers (${pages.size} pages)${broken.length ? `  (${broken.join('; ')})` : ''}`);
  return [broken.length === 0];
}

/**
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
  // Eve saved her checklist before Enrol existed: the GP ticked, the dentist deleted, one of her own.
  const before = [
    { id: 'gp', title: 'Register with a GP', done: true },
    { id: 'student-id', title: 'Collect student ID', done: false },
    { id: 'society', title: 'Join a society', done: false },
    { id: 'contacts', title: 'Save key contacts', done: true },
    { id: 'own-lamp', title: 'Buy a desk lamp', done: false }
  ];
  const eve = await db.verifiedAccount('eve.howto@northumbria.ac.uk', password);
  await db.seed(`students/${eve}`, { name: 'Eve Student', course: 'BSc Law', email: 'eve.howto@northumbria.ac.uk', arrivalDate: '', role: 'student', checklist: before });
  // Fay's list is full.
  const full = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `own-${i}`, title: `Task ${i + 1}`, done: i % 3 === 0 }));
  const fay = await db.verifiedAccount('fay.howto@northumbria.ac.uk', password);
  await db.seed(`students/${fay}`, { name: 'Fay Student', course: 'BA History', email: 'fay.howto@northumbria.ac.uk', arrivalDate: '', role: 'student', checklist: full });

  const app = await startApp();
  try {
    let page = await openChrome(app.base);
    const onScreen = () => page.evaluate(`[...document.querySelectorAll('.tasks > li')].map((li) => (li.querySelector('input[type=checkbox]')?.checked ? '✓ ' : '') + (li.querySelector('.task-row label')?.textContent.trim() ?? ''))`);
    try {
      await page.logIn('eve.howto@northumbria.ac.uk', password);
      await page.go('/checklist');
      await page.waitFor(page.has('completed'));
      const shown = await onScreen();
      report('A checklist saved before Enrol existed shows Enrol first, keeping her own task, her ticks and the task she deleted',
        JSON.stringify(shown) === JSON.stringify(['Enrol', '✓ Register with a GP', 'Collect student ID', 'Join a society', '✓ Save key contacts', 'Buy a desk lamp']), JSON.stringify(shown));

      // The how-to under Enrol, and Ask4Help.
      await page.evaluate(`([...document.querySelectorAll('.tasks > li')][0].querySelector('summary').click(), true)`);
      await sleep(300);
      const howTo = await page.evaluate(`(() => { const details = document.querySelector('.tasks > li details'); return { open: details.open, text: details.innerText, links: [...details.querySelectorAll('a')].map((a) => a.getAttribute('href')) }; })()`);
      if (process.env.SCREENSHOTS) await page.picture(join(process.env.SCREENSHOTS, 'checklist-how-to.png'));
      const top = await page.evaluate(`[...document.querySelectorAll('.ask4help')][0]?.compareDocumentPosition(document.querySelector('.tasks')) === Node.DOCUMENT_POSITION_FOLLOWING`);
      report('“How to” under Enrol opens its steps, its link and sources, and Stuck? Contact Ask4Help with Ask4Help Online and the number to call; the page has it near the top too',
        howTo.open && HOW_TO.enrol.steps.every((step) => oneLine(howTo.text).includes(step)) && howTo.links.includes('https://myportal.northumbria.ac.uk/')
          && SOURCES.enrolment.href !== '' && howTo.links.includes(SOURCES.enrolment.href) && howTo.links.includes(ASK4HELP.online.href) && howTo.links.includes(ASK4HELP.tel) && top,
        `open ${howTo.open}, ${howTo.links.length} links, at the top ${top}`);

      // Ticking Enrol saves it first and notes it as had; deleted, it stays deleted.
      const ticked = await page.evaluate(`(() => { const box = document.getElementById('task-enrol'); box.click(); return box.checked; })()`);
      const savedTick = await page.waitFor(`document.querySelector('[role=status]')?.textContent.includes('All changes saved')`, 30000);
      const saved = (await db.read(`students/${eve}`))?.fields;
      const first = saved?.checklist?.arrayValue?.values?.[0]?.mapValue?.fields;
      const had = saved?.checklistOffered?.arrayValue?.values?.map((/** @type {any} */ v) => v.stringValue);
      await page.evaluate(`(document.querySelector('button[aria-label="Delete Enrol"]').click(), true)`);
      let savedDelete = false;
      for (const end = Date.now() + 30000; !savedDelete && Date.now() < end; await sleep(250)) {
        savedDelete = (await db.read(`students/${eve}`))?.fields?.checklist?.arrayValue?.values?.[0]?.mapValue?.fields?.id?.stringValue === 'gp';
      }
      await page.go('/checklist');
      await page.waitFor(page.has('completed'));
      const afterDelete = await onScreen();
      report('Ticking Enrol saves it at the top and notes it as had; deleted, it stays deleted after a reload',
        ticked && savedTick && savedDelete && first?.id?.stringValue === 'enrol' && first?.done?.booleanValue === true && JSON.stringify(had) === '["enrol"]'
          && !afterDelete.some((task) => /Enrol/.test(task)) && afterDelete.length === 5,
        `ticked ${ticked}, saved ${savedTick} and ${savedDelete}, had ${JSON.stringify(had)}; then ${JSON.stringify(afterDelete)}; ${await page.evaluate(`document.querySelector('.notice')?.innerText ?? ''`)}`);
    } finally {
      await page.close();
    }

    // A full list is left as it is (a fresh Chrome: the emulator only manages a few connections at once).
    page = await openChrome(app.base);
    try {
      await page.logIn('fay.howto@northumbria.ac.uk', password);
      await page.go('/checklist');
      await page.waitFor(page.has('completed'));
      const shown = await onScreen();
      report(`A full list (${MAX_TASKS} tasks) is left as it is: no Enrol until there’s room`, shown.length === MAX_TASKS && !shown.some((task) => /Enrol/.test(task)), `${shown.length} tasks`);
    } finally {
      await page.close();
    }
  } finally {
    app.stop();
  }
  return results;
}
