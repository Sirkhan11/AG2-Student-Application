// Checks going through the checklist in the check-in chat (src/lib/checkin/checklist-flow.js): Gemini
// offers it (its reply's checklist action); the app shows one task at a time with its how-to, a link or something
// the chat can do, Done (ticked through the checklist's own change), Not yet and Ask4Help; Stop ends
// it; while a task is on screen, Gemini answers only from its how-to.
// 1. Offline, in Node: the walkthrough with made-up steps; what Gemini is told (never the words of one
//    of their own tasks); the offer and the instructions; the task card; the chat page's wiring.
// 2. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators), with a stand-in
//    for Gemini (scripts/lib/stand-in-gemini.mjs), so nothing reaches Google: "okay great now what"
//    gets the offer; Start shows Enrol first; a question goes to Gemini with the task's how-to; Done
//    ticks it in Firestore; Not yet moves on; "Suggest some for me" asks the chat; Stop ends it.
// Made-up people only; nothing real is touched (project demo-ag2). Run from the project folder:
//   node scripts/check-checklist-in-chat.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-checklist-in-chat.mjs"
// The second needs Java 21 or newer, and Google Chrome (or CHROME=<path to Chrome>). With
// SCREENSHOTS=<folder>, it also saves a phone-size picture of a task card there.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatAction } from '#lib/checkin/chat-actions.js';
import { chatRequest } from '#lib/checkin/chat-prompt.js';
import { readChatReply } from '#lib/checkin/chat-replies.js';
import { createChecklistFlow } from '#lib/checkin/checklist-flow.js';
import { chatOptions, describeForGemini } from '#lib/checkin/opener.js';
import { HOW_TO } from '#lib/checklist/how-to.js';
import { applyChange, defaultTasks, makeTick } from '#lib/checklist/tasks.js';
import { emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';
import { standInGemini } from './lib/stand-in-gemini.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');
const tick = () => sleep(0);

/**
 * A walkthrough with made-up steps that record everything: the list, what it posts, the task on
 * screen, the ticks, and how it ended.
 * @param {{ list?: import('#lib/checklist/tasks.js').Task[], failTick?: number, failLoad?: boolean }} [setup]
 */
function walkthrough({ list = defaultTasks(), failTick = 0, failLoad = false } = {}) {
  /** @type {any[]} */
  const posts = [];
  /** @type {(string | null)[]} */
  const onScreen = [];
  /** @type {string[]} */
  const ticks = [];
  /** @type {any[]} */
  const finished = [];
  let state = /** @type {any} */ (null);
  let failures = failTick;
  const flow = createChecklistFlow({
    load: async () => {
      if (failLoad) throw new Error('offline');
      return list;
    },
    tick: async (id, current) => {
      if (failures > 0) {
        failures--;
        throw new Error('network');
      }
      ticks.push(id);
      return applyChange(current, makeTick(id, true));
    },
    post: (message) => posts.push(message),
    changed: (next) => (state = next),
    onTask: (task) => onScreen.push(task?.id ?? null),
    finished: (result) => finished.push(result)
  });
  return { flow, posts, onScreen, ticks, finished, state: () => state, last: () => posts.at(-1) };
}

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['It goes through the tasks not done yet, in order (Enrol first), one card each with its how-to; Done ticks it and moves on, Not yet moves on, and the end says how many were ticked', async () => {
    const list = applyChange(defaultTasks(), makeTick('gp', true));
    const t = walkthrough({ list });
    t.flow.start();
    await tick();
    assert.match(t.posts[0].text, /^Let’s go through your checklist, one task at a time: 5 tasks to go\./);
    assert.equal(t.last().text, '1 of 5: Enrol');
    assert.equal(t.last().card.kind, 'checklist-task');
    assert.deepEqual(t.last().card.howTo, HOW_TO.enrol);
    await t.flow.done();
    assert.deepEqual(t.ticks, ['enrol']);
    assert.equal(t.posts.at(-2).text, 'Done');
    assert.equal(t.posts.at(-2).role, 'user');
    assert.equal(t.last().text, '2 of 5: Collect student ID', 'the GP was already done');
    t.flow.notYet();
    assert.equal(t.last().text, '3 of 5: Join a society');
    t.flow.notYet();
    await t.flow.done();
    t.flow.notYet();
    assert.match(t.last().text, /^That’s everything for now, and you’ve ticked off 2 tasks\. Nice work!$/);
    assert.deepEqual(t.last().card, { kind: 'link', label: 'Open your checklist', href: '/checklist', id: t.last().card.id });
    assert.deepEqual([t.finished[0].outcome, t.finished[0].ticked], ['finished', ['enrol', 'dentist']]);
    assert.deepEqual(t.onScreen, ['enrol', 'student-id', 'society', 'dentist', 'contacts', null]);
  }],
  ['Nothing is ticked without Done: Not yet and Stop tick nothing; a failed tick offers Try again, which ticks the same task', async () => {
    const t = walkthrough({ failTick: 1 });
    t.flow.start();
    await tick();
    t.flow.notYet();
    assert.deepEqual(t.ticks, []);
    await t.flow.done();
    assert.deepEqual(t.ticks, []);
    assert.equal(t.last().card.kind, 'retry');
    assert.equal(t.last().text, 'We couldn’t tick off “Register with a GP” just now. Please try again.');
    await t.flow.tryAgain();
    assert.deepEqual(t.ticks, ['gp']);
    assert.equal(t.last().text, '3 of 6: Collect student ID');
    t.flow.stop();
    assert.deepEqual(t.ticks, ['gp']);
    assert.equal(t.finished[0].outcome, 'stopped');
  }],
  ['Stop, or typing "stop", ends it at any point except while a tick saves; anything else typed is a question for Gemini, not for it', async () => {
    const t = walkthrough();
    t.flow.start();
    await tick();
    assert.equal(t.flow.takes('Do I need a photo?'), false);
    assert.equal(t.flow.reply('Do I need a photo?'), false);
    assert.equal(t.flow.takes(' Stop. '), true);
    assert.equal(t.flow.reply('stop'), true);
    assert.equal(t.last().text, 'Stopped. Your checklist is saved as it is, and we can carry on chatting.');
    assert.equal(t.state().active, false);
    assert.equal(t.flow.takes('stop'), false, 'not once it’s stopped');
  }],
  ['An all-done checklist just says so; one that can’t be loaded offers Try again', async () => {
    const all = walkthrough({ list: defaultTasks().map((task) => ({ ...task, done: true })) });
    all.flow.start();
    await tick();
    assert.equal(all.last().text, 'Your checklist’s all done. Nice work!');
    assert.equal(all.finished[0].outcome, 'all-done');
    const failing = walkthrough({ failLoad: true });
    failing.flow.start();
    await tick();
    assert.equal(failing.last().card.kind, 'retry');
  }],
  ['Gemini is told the task on screen and to answer only from its how-to; one of their own is never named; joining a society may get suggestions; after Not now or Stop it isn’t offered again', () => {
    const base = { match: null, tasks: defaultTasks(), profile: null };
    const enrol = describeForGemini({ ...base, walkthrough: { title: 'Enrol', steps: HOW_TO.enrol.steps } });
    assert.match(enrol, /The task on screen now is "Enrol"\. Its how-to:\n1\. If you need a UK student visa/);
    assert.match(enrol, /While it’s on screen, answer their questions about it only from this how-to\. If it doesn’t say, tell them you don’t know and that Ask4Help can help/);
    assert.match(enrol, /never tick anything or say it’s done: only their Done does that\./);
    assert.doesNotMatch(enrol, /suggest up to 3 societies/);
    const society = describeForGemini({ ...base, walkthrough: { title: 'Join a society', steps: HOW_TO.society.steps, chatHelps: true } });
    assert.match(society, /If they ask for suggestions, you may suggest up to 3 societies that fit them, as usual\./);
    const own = describeForGemini({ ...base, tasks: [...defaultTasks(), { id: 'own-1', title: 'Ring my landlord about the boiler', done: false }], walkthrough: { own: true } });
    assert.match(own, /The task on screen now is one of their own, which you aren’t told\./);
    assert.doesNotMatch(own, /landlord|boiler/, 'their own task’s words are never sent');
    assert.match(describeForGemini({ ...base, checklistNote: 'declined' }), /They said not now to going through their checklist here\./);
    assert.match(describeForGemini({ ...base, checklistNote: 'stopped' }), /They went through some of their checklist here and stopped/);
  }],
  ['The offer: the checklist action becomes a card, only with tasks left; the instructions say when, with no Checklist page link or list', () => {
    const reply = readChatReply(JSON.stringify({ action: 'checklist', page: 'Checklist', say: 'I can go through your checklist with you here, one task at a time.' }), { shortlist: [], actions: ['checklist'] });
    assert.deepEqual([reply?.action, reply?.links], [{ id: 'checklist' }, []], 'the card, never the Checklist page');
    assert.deepEqual(chatAction('checklist')?.card, { title: 'Go through your checklist here?', text: 'I’ll show one task at a time, with how to do it. Tap Done when you’ve done it, or Not yet to leave it for now.' });
    assert.equal(chatOptions({ match: null, tasks: defaultTasks() }).checklist, 'yes');
    assert.equal(chatOptions({ match: null, tasks: defaultTasks().map((task) => ({ ...task, done: true })) }).checklist, 'no', 'all done: never offered');
    assert.equal(chatOptions({ match: null, tasks: defaultTasks(), checklistNote: 'declined' }).checklist, 'if-asked');
    const instructions = oneLine(chatRequest({ about: '(about)', opener: ['(opener)'], shortlist: [], options: { mentor: 'no', checklist: 'yes', hasMentor: false } }).systemInstruction);
    assert.ok(instructions.includes('"checklist": they ask for help with their checklist or their tasks, or to go through them, or ask what to do next or what’s left. The app then goes through it with them, one task at a time.'));
    assert.ok(instructions.includes("Don't list their tasks, ask about one, or send them to a page."));
  }],
  ['The task card: the how-to, its link (and "Suggest some for me" for societies, which asks the chat), Done, Not yet and Ask4Help; Done and Not yet only while it’s the live card', () => {
    const card = oneLine(source('src/lib/components/ChecklistTaskCard.svelte'));
    assert.match(card, /\{#each card\.howTo\.steps as step, i \(i\)\} <li>\{step\}<\/li> \{\/each\}/);
    assert.match(card, /onclick=\{\(\) => onask\?\.\(/);
    assert.match(card, /<button class="primary-button" type="button" disabled=\{!live\} onclick=\{\(\) => flow\?\.done\(\)\}>Done<\/button>/);
    assert.match(card, /<button class="secondary-button" type="button" disabled=\{!live\} onclick=\{\(\) => flow\?\.notYet\(\)\}>Not yet<\/button>/);
    assert.match(card, /<Ask4HelpLink about=\{card\.title\} \/>/);
    assert.deepEqual(HOW_TO.society.chat, { label: 'Suggest some for me', ask: 'Could you suggest a society that would suit me?' });
  }],
  ['The chat page: Start runs it, one action at a time; while it runs, "stop" goes to it and questions to Gemini; Done ticks through the checklist’s own change; Gemini is told each task and when it ends', () => {
    const page = source('src/routes/check-in/+page.svelte');
    assert.match(page, /if \(chatSession\.flow\?\.active\) return;\s*if \(action === 'mentor'\) mentorFlow\(\)\.start\(\);\s*else if \(action === 'checklist'\) checklistFlow\(\)\.start\(\);/);
    assert.match(page, /if \(text && flowActive && flow\?\.takes\(text\)\) \{/);
    assert.match(page, /const change = makeTick\(id, true\);\s*const onScreen = applyChange\(list, change\);\s*const result = await saveChange\(change, onScreen\);/);
    assert.match(page, /tellGemini\(\{ walkthrough: !task \? null : howTo \? \{ title: task\.title, steps: howTo\.steps, chatHelps: Boolean\(howTo\.chat\) \} : \{ own: true \} \}\);/);
    assert.match(page, /else if \(action === 'checklist'\) tellGemini\(\{ checklistNote: 'declined' \}\);/);
    assert.match(source('src/lib/checkin/checklist-flow.js'), /takes: \(text\) => state\.active && STOP\.test\(text\)/);
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
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-checklist-in-chat.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

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
  const uid = await db.verifiedAccount('hal.walk@northumbria.ac.uk', password);
  await db.seed(`students/${uid}`, { name: 'Hal Student', course: 'BSc Law', email: 'hal.walk@northumbria.ac.uk', arrivalDate: '', role: 'student', interests: ['dancing'] });

  const app = await startApp();
  const page = await openChrome(app.base);
  try {
    const gemini = await standInGemini(page.send, page.listen);
    const lastBubble = () => page.evaluate(`[...document.querySelectorAll('.bubble')].at(-1)?.innerText.trim() ?? ''`);
    /** Sends a message and waits for the stand-in's reply to show. @param {string} text */
    const ask = async (text) => {
      const before = gemini.requests.length;
      await page.answer(text);
      for (const end = Date.now() + 20000; gemini.requests.length === before && Date.now() < end; ) await sleep(150);
      await page.waitFor(`!document.querySelector('.typing')`);
      await sleep(300);
    };
    await page.logIn('hal.walk@northumbria.ac.uk', password);
    await page.go('/check-in');
    await page.waitFor(`document.querySelector('[data-chat-ready]')`, 30000);

    // 1. "okay great now what" gets the offer, without a link to the Checklist page.
    gemini.replyWith({ action: 'checklist', say: 'I can go through your checklist with you here, one task at a time.' });
    await ask('okay great now what');
    const offered = await page.waitFor(`document.querySelector('[aria-label="Go through your checklist here?"]')`);
    const offerLinks = await page.evaluate(`[...document.querySelectorAll('.bubble')].at(-1)?.querySelectorAll('a').length ?? 0`);
    await page.evaluate(`([...document.querySelectorAll('[aria-label="Go through your checklist here?"] button')].find((b) => b.textContent.trim() === 'Start').click(), true)`);
    const firstTask = await page.waitFor(`[...document.querySelectorAll('.bubble')].some((b) => b.innerText.trim() === '1 of 6: Enrol')`);
    const card = await page.evaluate(`(() => { const c = [...document.querySelectorAll('.task-card')].at(-1); return c ? { text: c.innerText, links: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')) } : null; })()`);
    if (process.env.SCREENSHOTS) await page.picture(join(process.env.SCREENSHOTS, 'checklist-in-chat.png'));
    report('"okay great now what" gets the offer card and no page link; Start shows Enrol first, with its how-to, the Student Portal and Ask4Help',
      offered && offerLinks === 0 && firstTask && card !== null && HOW_TO.enrol.steps.every((step) => oneLine(card.text).includes(step))
        && card.links.includes('https://myportal.northumbria.ac.uk/') && card.links.includes('https://myportal.northumbria.ac.uk/Help-and-support') && card.links.includes('tel:+441912274646'),
      `offer ${offered}, links in the offer ${offerLinks}, first task ${firstTask}`);

    // 2. A question goes to Gemini, told the task on screen and its how-to.
    gemini.replyWith({ say: 'Yes: have a passport-style photo ready to upload.' });
    await ask('Do I need a photo?');
    const told = gemini.lastInstructions();
    report('A question while Enrol is on screen goes to Gemini, which is told the task, its how-to and to answer only from it',
      told.includes('The task on screen now is "Enrol". Its how-to:') && told.includes(HOW_TO.enrol.steps[1]) && told.includes('answer their questions about it only from this how-to')
        && (await lastBubble()) === 'Yes: have a passport-style photo ready to upload.' && gemini.lastMessages().at(-1) === 'Do I need a photo?');

    // 3. Done ticks it in Firestore; Not yet moves on.
    await page.press('Done');
    const ticked = await page.waitFor(`[...document.querySelectorAll('.bubble')].some((b) => b.innerText.trim() === '2 of 6: Register with a GP')`);
    let saved = null;
    for (let i = 0; i < 40 && !saved; i++) {
      const first = (await db.read(`students/${uid}`))?.fields?.checklist?.arrayValue?.values?.[0]?.mapValue?.fields;
      if (first?.id?.stringValue === 'enrol' && first?.done?.booleanValue === true) saved = first;
      else await sleep(250);
    }
    await page.press('Not yet');
    const moved = await page.waitFor(`[...document.querySelectorAll('.bubble')].some((b) => b.innerText.trim() === '3 of 6: Collect student ID')`);
    const gpTicked = (await db.read(`students/${uid}`))?.fields?.checklist?.arrayValue?.values?.[1]?.mapValue?.fields?.done?.booleanValue;
    report('Done ticks the task in Firestore through the checklist’s own change; Not yet moves on and ticks nothing',
      ticked && Boolean(saved) && moved && gpTicked === false, `ticked ${ticked}, saved ${Boolean(saved)}, moved ${moved}`);

    // 4. "Suggest some for me" on joining a society asks the chat, which may suggest them.
    await page.press('Not yet');
    await page.waitFor(`[...document.querySelectorAll('.bubble')].some((b) => b.innerText.trim() === '4 of 6: Join a society')`);
    gemini.replyWith({ suggest: ['Salsa and Bachata'], say: 'Since you like dancing, Salsa and Bachata could be fun.' });
    const before = gemini.requests.length;
    await page.press('Suggest some for me');
    for (const end = Date.now() + 20000; gemini.requests.length === before && Date.now() < end; ) await sleep(150);
    await page.waitFor(`!document.querySelector('.typing')`);
    await sleep(500);
    const suggestion = await page.evaluate(`[...document.querySelectorAll('.cards')].at(-1)?.innerText ?? ''`);
    report('“Suggest some for me” on joining a society asks the chat, which may suggest them while the task stays on screen',
      gemini.lastMessages().at(-1) === HOW_TO.society.chat?.ask && gemini.lastInstructions().includes('you may suggest up to 3 societies that fit them') && suggestion.includes('Salsa and Bachata')
        && (await page.evaluate(`[...document.querySelectorAll('.task-card')].at(-1)?.querySelector('button.primary-button')?.disabled === false`)));

    // 5. Stop ends it, and Gemini is told.
    await page.press('Stop');
    const stopped = await page.waitFor(`[...document.querySelectorAll('.bubble')].some((b) => b.innerText.includes('Stopped. Your checklist is saved as it is'))`);
    gemini.replyWith({ say: 'Any time!' });
    await ask('thanks');
    const after = gemini.lastInstructions();
    report('Stop ends it; Gemini is then told it stopped, and is no longer told a task',
      stopped && !after.includes('The task on screen now') && after.includes('They went through some of their checklist here and stopped'));
  } finally {
    await page.close();
    app.stop();
  }
  return results;
}
