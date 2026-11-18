// Checks their mentor in the check-in chat (YourMentorCard.svelte): {{your-mentor}} shows a card with
// the mentor's name, how to get in touch and how often they asked to meet, read from the student's own
// record so Gemini never sees them; {{change-mentor}} opens the form for a different mentor
// (ChangeMentorRequest), which goes only to the coordinator; Gemini never asks for the reason.
// 1. Offline, in Node: the two actions show their card straight away; the instructions; what Gemini
//    is told (never the mentor's name or how to reach them); the card; the request kept out of the
//    chat's own code, with its own ids.
// 2. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators), with a stand-in
//    for Gemini (scripts/lib/stand-in-gemini.mjs), so nothing reaches Google: the card with the
//    mentor's details while Gemini's request has none of them; the form, sent to Firestore, with the
//    reason never in a later Gemini request; a student without a mentor.
// Made-up people only; nothing real is touched (project demo-ag2). Run from the project folder:
//   node scripts/check-your-mentor.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-your-mentor.mjs"
// The second needs Java 21 or newer, and Google Chrome (or CHROME=<path to Chrome>). With
// SCREENSHOTS=<folder>, it also saves a phone-size picture of the card there.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_ACTIONS, chatAction, offersInReply } from '#lib/checkin/chat-actions.js';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { describeForGemini } from '#lib/checkin/opener.js';
import { emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';
import { standInGemini } from './lib/stand-in-gemini.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');
const MATCH = /** @type {const} */ ({ status: 'matched', mentorId: 'mentor-alex', mentorName: 'Alex Mentor', reasons: ['You share interests: films'], meetingFrequency: 'weekly', availability: 'Evenings' });

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['Their mentor ({{your-mentor}}) and asking for a different one ({{change-mentor}}) show their card straight away; finding a mentor and the checklist still have Start and Not now', () => {
    assert.deepEqual(offersInReply('Here’s your mentor. {{your-mentor}}'), { text: 'Here’s your mentor.', offers: ['your-mentor'] });
    assert.deepEqual(offersInReply('You can ask the coordinator here. {{change-mentor}}'), { text: 'You can ask the coordinator here.', offers: ['change-mentor'] });
    assert.equal(chatAction('your-mentor')?.shows, 'card');
    assert.equal(chatAction('change-mentor')?.shows, 'card');
    assert.deepEqual(CHAT_ACTIONS.filter((action) => action.shows !== 'card' && !action.marker.includes(':')).map((action) => action.id), ['mentor', 'checklist']);
  }],
  ['The instructions: show the card when they ask who their mentor is or how to reach them, never guessing; the form when they want a different one, never asking why', () => {
    const instructions = oneLine(chatInstructions('(about)', ['(opener)']));
    for (const words of [
      'If they ask who their mentor is or how to get in touch, show them the card here with {{your-mentor}} (see Showing them their mentor): you\'re never told their mentor\'s name or contact details.',
      'the app shows a card with their mentor’s name, how to get in touch and how often they asked to meet, from their own record. You’re never told those, so never guess or give them yourself.',
      'Don’t show it if they haven’t got a mentor yet, or the coordinator is still finding them one',
      'If they ask about changing their mentor, show them the form here with {{change-mentor}}',
      'Never ask for their reason or what went wrong, and don’t ask them to tell you: the form has the reasons.',
      'Never say you’ve asked the coordinator or that you will: only they can send it, with the form’s button.'
    ]) assert.ok(instructions.includes(words), words);
    assert.doesNotMatch(instructions, /name and how to get in touch are on the \[\[Your Mentor\]\] page/);
  }],
  ['Gemini is never told the mentor’s name or how to reach them: it shows the card instead', () => {
    const told = describeForGemini({ match: { ...MATCH, mentorName: null }, tasks: null, profile: null });
    assert.match(told, /You aren’t told the mentor’s name or how to reach them: if they ask who it is or how to get in touch, show the card with \{\{your-mentor\}\}\./);
    const page = source('src/routes/check-in/+page.svelte');
    assert.match(page, /const withoutName = match\?\.status === 'matched' \? \{ \.\.\.match, mentorName: null \} : match;/, 'the first messages Gemini sees have no name');
    assert.doesNotMatch(describeForGemini({ match: MATCH, tasks: null, profile: null }), /Alex Mentor/, 'even if a name were passed in');
  }],
  ['The card reads their own record: the name, the coordinator introducing them, how often; Ask for a different mentor opens the form; only with a mentor', () => {
    const card = oneLine(source('src/lib/components/YourMentorCard.svelte'));
    assert.match(card, /match = await loadMyMatch\(\);/);
    assert.match(card, /<p class="name">\{match\.mentorName \?\? 'Your mentor'\}<\/p>/);
    assert.match(card, /<strong>Getting in touch:<\/strong> your coordinator will introduce you\./);
    assert.match(card, /<strong>How often:<\/strong> you asked to meet \{match\.meetingFrequency\}\./);
    assert.match(card, /changing = change && match\?\.status === 'matched';/, 'the form only for a student with a mentor');
    assert.match(card, /\{#if changing\} <ChangeMentorRequest open \/> \{\/if\}/);
    const page = source('src/routes/check-in/+page.svelte');
    assert.match(page, /appCard: action\?\.shows === 'card' \?/);
    assert.match(page, /<YourMentorCard change=\{item\.appCard === 'change-mentor'\} \/>/);
  }],
  ['The request stays out of the chat’s code and Gemini: the form saves it to Firestore itself, says it’s never sent to Gemini, and has its own ids', () => {
    const component = source('src/lib/components/ChangeMentorRequest.svelte');
    assert.match(component, /Your mentor won’t see it, and it’s never sent to Gemini\./);
    assert.match(component, /const htmlId = \$props\.id\(\);/);
    assert.doesNotMatch(component, /id="change-(title|details)"/, 'no fixed ids');
    assert.match(component, /view = request \? 'sent' : open \? 'form' : 'none';/);
    for (const file of ['src/routes/check-in/+page.svelte', 'src/lib/checkin/chat-session.svelte.js', 'src/lib/checkin/opener.js', 'src/lib/checkin/chat-turns.js']) {
      assert.doesNotMatch(source(file), /change-request|mentorChangeRequests|loadChangeRequest/, file);
    }
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
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-your-mentor.mjs")');
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
  const ivy = await db.verifiedAccount('ivy.mentor@northumbria.ac.uk', password);
  await db.seed(`students/${ivy}`, { name: 'Ivy Student', course: 'BSc Law', email: 'ivy.mentor@northumbria.ac.uk', arrivalDate: '', role: 'student' });
  await db.seed(`matches/${ivy}`, { ...MATCH, createdAt: new Date() });
  const jo = await db.verifiedAccount('jo.mentor@northumbria.ac.uk', password);
  await db.seed(`students/${jo}`, { name: 'Jo Student', course: 'BA History', email: 'jo.mentor@northumbria.ac.uk', arrivalDate: '', role: 'student' });
  const DETAILS = 'Made-up words for the check';

  const app = await startApp();
  /** @param {(page: Awaited<ReturnType<typeof openChrome>>, gemini: Awaited<ReturnType<typeof standInGemini>>) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    try {
      await part(page, await standInGemini(page.send, page.listen));
    } finally {
      await page.close();
    }
  };
  /** Sends a message and waits for the stand-in's reply. @param {Awaited<ReturnType<typeof openChrome>>} page @param {any} gemini @param {string} text */
  const ask = async (page, gemini, text) => {
    const before = gemini.requests.length;
    await page.answer(text);
    for (const end = Date.now() + 20000; gemini.requests.length === before && Date.now() < end; ) await sleep(150);
    await page.waitFor(`!document.querySelector('.typing')`);
    await sleep(500);
  };
  try {
    await inFreshChrome(async (page, gemini) => {
      await page.logIn('ivy.mentor@northumbria.ac.uk', password);
      await page.go('/check-in');
      await page.waitFor(`document.querySelector('[data-chat-ready]')`, 30000);

      // 1. Who's my mentor: the card, with nothing about the mentor sent to Gemini.
      gemini.replyWith('Here’s your mentor. {{your-mentor}}');
      await ask(page, gemini, 'Who’s my mentor, and how do I get in touch?');
      const shown = await page.waitFor(`[...document.querySelectorAll('[aria-label="Your mentor"]')].at(-1)?.innerText.includes('Alex Mentor')`);
      const card = oneLine(await page.evaluate(`[...document.querySelectorAll('[aria-label="Your mentor"]')].at(-1)?.innerText ?? ''`));
      if (process.env.SCREENSHOTS) await page.picture(join(process.env.SCREENSHOTS, 'your-mentor-card.png'));
      const sent = JSON.stringify(gemini.requests);
      report('“Who’s my mentor?” shows the card with the mentor’s name, how to get in touch and how often, read from their record; Gemini is sent none of it',
        shown && card.includes('Getting in touch: your coordinator will introduce you.') && card.includes('How often: you asked to meet weekly.') && !sent.includes('Alex Mentor') && !sent.includes('mentor-alex'),
        JSON.stringify(card.slice(0, 120)));

      // 2. A different mentor: the form, sent to Firestore only; the reason never reaches Gemini.
      gemini.replyWith('Of course. You can ask the coordinator here, and only they will see why. {{change-mentor}}');
      await ask(page, gemini, 'I’d like a different mentor please');
      const form = await page.waitFor(`[...document.querySelectorAll('fieldset legend')].some((l) => l.textContent.includes('Why would you like a different mentor?'))`);
      await page.evaluate(`(() => { const radio = [...document.querySelectorAll('input[name="change-reason"]')][1]; radio.click(); const box = [...document.querySelectorAll('textarea[id^="change-details-"]')].at(-1); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(DETAILS)}); box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await page.press('Send to the coordinator');
      const saved = await page.waitFor(`document.body.innerText.includes('You’ve asked the mentoring coordinator for a different mentor')`);
      const request = (await db.read(`mentorChangeRequests/${ivy}`))?.fields;
      gemini.replyWith('Thanks for letting me know.');
      await ask(page, gemini, 'Thanks');
      const later = JSON.stringify(gemini.requests.slice(-1));
      const reason = request?.reason?.stringValue ?? '(none)';
      report('“I’d like a different mentor” opens the form in the chat; it’s sent to Firestore for the coordinator, and neither the reason nor their words reach Gemini',
        form && saved && request?.details?.stringValue === DETAILS && !later.includes(DETAILS) && !later.includes(reason),
        `form ${form}, sent ${saved}`);
    });

    // 3. Jo has no mentor: the card says so.
    await inFreshChrome(async (page, gemini) => {
      await page.logIn('jo.mentor@northumbria.ac.uk', password);
      await page.go('/check-in');
      await page.waitFor(`document.querySelector('[data-chat-ready]')`, 30000);
      gemini.replyWith('Here’s where things are. {{your-mentor}}');
      await ask(page, gemini, 'Who is my mentor?');
      report('A student without a mentor: the card says so, with no form',
        await page.waitFor(`[...document.querySelectorAll('[aria-label="Your mentor"]')].at(-1)?.innerText.includes('You haven’t got a mentor yet.')`)
          && !(await page.evaluate(`Boolean(document.querySelector('input[name="change-reason"]'))`)));
    });
  } finally {
    app.stop();
  }
  return results;
}
