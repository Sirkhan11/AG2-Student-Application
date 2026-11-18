// Checks that words which suggest someone may be at risk (safety.js: the chat's own crisis check) are
// answered with the support message, and go nowhere else, wherever they're typed (agent1.md A13). On 18
// November "I want to kill myself", typed during the chat's mentor questions, was kept as an answer and
// would have gone to Gemini, and maybe the coordinator: the check only ran on ordinary chat messages.
// The chat itself is checked in check-mentor-in-chat.mjs (every phrase at every point in the questions)
// and check-signed-in.mjs (in Chrome). This checks every other box where a student types words that
// someone or something else reads:
//   the Find a mentor page's six answers and when they're free (to Gemini; to the coordinator if
//   there's no automatic match) - checked, nothing sent;
//   mentor sign-up: name, display name, course, six answers, when they're free (to Gemini; students
//   see the display name; the coordinator reads the rest) - checked, nothing sent, no account made;
//   sign-up: name, course and their own interests (the chat tells Gemini them) - checked, not kept;
//   the GP and dentist finders' search, on the page and in the chat (a place goes to postcodes.io) -
//   checked, not looked up;
//   a request for a different mentor (the coordinator reads the details) - the support message, but
//   it's still sent: they're choosing to tell the coordinator, perhaps about their mentor, and stopping
//   it would silence them.
// Left as they are, as nobody else reads them: their own checklist tasks (Gemini is told how many, never
// what they say), the calendar card's event name (a file made on their phone), the Societies and Sport
// searches (worked out on the phone), and the log-in, sign-up and password reset email boxes. The
// team's /matching-demo and /matching-test pages aren't in the live site.
// 1. Offline: the check itself, and each box's code checking before anything is sent.
// 2. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators), with a stand-in for
//    Gemini that counts requests: each form, with a crisis phrase typed in.
// Made-up people only; nothing real is touched (project demo-ag2). Run from the project folder:
//   node scripts/check-crisis-everywhere.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-crisis-everywhere.mjs"

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AT_RISK, crisisIn, SAFETY_MESSAGE } from '#lib/checkin/safety.js';
import { CHECKLIST_DONE, emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';
import { standInGemini } from './lib/stand-in-gemini.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');

/** @type {[string, () => void][]} */
const offline = [
  ['crisisIn: any of the words typed, and nothing for empty boxes or everyday words', () => {
    assert.equal(crisisIn('Climbing', null, undefined, 'honestly I want to die'), true);
    assert.equal(crisisIn('Climbing', 'this essay is killing me', 'I could die for a pizza'), false);
    assert.equal(crisisIn(), false);
    assert.match(SAFETY_MESSAGE, /call 999 now/);
  }],
  ['Find a mentor: the answers and when they’re free are checked before Find my mentor sends anything, with the support message; the finder refuses too', () => {
    const page = source('src/routes/find-mentor/+page.svelte');
    assert.match(page, /safety = crisisIn\(\.\.\.answers, availability\);\s*if \(formError \|\| safety\) return;/);
    assert.match(page, /if \(result\.status === 'safety'\) \{\s*safety = true;/);
    assert.match(page, /<SafetyNote note="Nothing you typed here has been sent or saved\." \/>/);
    const steps = source('src/lib/matching/find-mentor-steps.js');
    assert.equal([...steps.matchAll(/if \(crisisIn\(\.\.\.answers, preferences\.availability\)\) return \{ status: 'safety' \};/g)].length, 2, 'find and askCoordinator');
  }],
  ['Mentor sign-up: every box is checked before anything is made or sent, on the page and in registerMentor', () => {
    const page = source('src/routes/mentor-signup/+page.svelte');
    assert.match(page, /safety = crisisIn\(name, displayName, course, \.\.\.answers, availability\);\s*if \(safety\) return;/);
    assert.match(page, /if \(code === AT_RISK\) \{\s*safety = true;/);
    assert.match(source('src/lib/matching/mentors.js'), /if \(crisisIn\(profile\.name, profile\.displayName, profile\.course, \.\.\.answers, profile\.availability\)\) \{\s*throw Object\.assign\(new Error\([^)]*\), \{ code: AT_RISK \}\);/);
    assert.ok(source('src/lib/matching/mentors.js').indexOf('crisisIn(') < source('src/lib/matching/mentors.js').indexOf('await summariseAnswers('), 'before Gemini');
    assert.equal(AT_RISK, 'safety/at-risk');
  }],
  ['Sign-up: their name, course and own interests are checked before they’re kept or saved', () => {
    const page = source('src/routes/signup/+page.svelte');
    assert.match(page, /safety = crisisIn\(word\);\s*if \(safety \|\|/);
    assert.match(page, /safety = crisisIn\(name, course, \.\.\.interests\);\s*if \(safety\) return;/);
  }],
  ['The GP and dentist finders: what’s typed is checked before it’s looked up; the page’s two tabs and the chat’s card show the support message', () => {
    assert.match(source('src/lib/gp/search.svelte.js'), /async search\(query\) \{\s*this\.startOver\(\);\s*if \(isCrisis\(query\)\) \{\s*this\.crisis = true;\s*return;\s*\}/);
    const page = source('src/routes/gp-finder/+page.svelte');
    for (const finder of ['finder', 'dentists']) assert.ok(page.includes(`{#if ${finder}.crisis}`), finder);
    assert.ok(source('src/lib/components/GpFinderCard.svelte').includes('{#if finder.crisis}'));
  }],
  ['A request for a different mentor: the support message with it, and it’s still sent (they’re choosing to tell the coordinator)', () => {
    const form = source('src/lib/components/ChangeMentorRequest.svelte');
    assert.match(form, /safety = isCrisis\(details\);\s*try \{\s*await sendChangeRequest\(db, id, reason, details\);/);
    assert.ok(oneLine(form).includes('Your request has gone to the mentoring coordinator, but they won’t see it straight away, so if you’re in danger now, please don’t wait for them.'));
  }],
  ['The support message on a page is the chat’s own, with Need help now', () => {
    const note = source('src/lib/components/SafetyNote.svelte');
    assert.match(note, /<p>\{SAFETY_MESSAGE\}<\/p>/);
    assert.match(note, /<a class="primary-button" href="\/need-help">Need help now<\/a>/);
    assert.match(note, /role="alert"/);
  }]
];

let failed = 0;
for (const [name, check] of offline) {
  try {
    check();
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
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-crisis-everywhere.mjs")');
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
  const PHRASE = 'I want to kill myself';
  // A mentor with room, so the Find a mentor page shows its questions.
  await db.seed('mentors/mentor-alex', { displayName: 'Alex', approved: true, maxStudents: 2, studentCount: 0, itemVectors: { q1: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)), q2: [], q3: [], q4: [], q5: [], q6: [] } });
  const student = async (/** @type {string} */ email, /** @type {Record<string, unknown>} */ more = {}) => {
    const uid = await db.verifiedAccount(email, password);
    await db.seed(`students/${uid}`, { name: 'Rae Student', course: 'BSc Law', email, arrivalDate: '', role: 'student', studentType: 'home', wantsMentor: true, interests: ['Climbing'], ...CHECKLIST_DONE, ...more });
    return uid;
  };
  const rae = 'rae.crisis@northumbria.ac.uk';
  const raeUid = await student(rae);
  const kit = 'kit.matched@northumbria.ac.uk';
  const kitUid = await student(kit);
  await db.seed(`matches/${kitUid}`, { status: 'matched', mentorId: 'mentor-alex', mentorName: 'Alex', reasons: [], meetingFrequency: 'weekly', availability: '', createdAt: new Date() });

  const app = await startApp();
  /** @typedef {Awaited<ReturnType<typeof openChrome>>} Page */
  /** A part in its own Chrome: the page, Gemini's stand-in, and every address the page asked for. @param {(page: Page, gemini: any, urls: string[]) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    const gemini = await standInGemini(page.send, page.listen);
    /** @type {string[]} */
    const urls = [];
    page.listen((message) => message.method === 'Network.requestWillBeSent' && urls.push(message.params.request.url));
    await page.send('Network.enable');
    try {
      await part(page, gemini, urls);
    } finally {
      await page.close();
    }
  };
  const supportShown = (/** @type {Page} */ page) => page.evaluate(`[...document.querySelectorAll('.safety-note')].some((n) => n.innerText.includes('call 999 now') && n.querySelector('a[href="/need-help"]'))`);
  const authHas = async (/** @type {string} */ email) => {
    const found = await fetch(`http://${where.auth}/identitytoolkit.googleapis.com/v1/projects/${where.project}/accounts:lookup`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ email: [email] }) });
    return Boolean((await found.json()).users?.length);
  };
  try {
    // 1. The Find a mentor page.
    await inFreshChrome(async (page, gemini) => {
      await page.logIn(rae, password);
      await page.go('/find-mentor');
      await page.waitFor(`document.getElementById('q6') !== null`, 30000);
      for (const [i, answer] of ['Settling in', 'Climbing and films', PHRASE, 'Planning ahead', 'Making friends', 'Someone patient'].entries()) await page.fill(`#q${i + 1}`, answer);
      await page.fill('#availability', 'Weekday afternoons');
      await page.press('Find my mentor');
      const shown = await page.waitFor(`document.querySelector('.safety-note') !== null`);
      await sleep(1500);
      const saved = Boolean(await db.read(`matches/${raeUid}`)) || Boolean((await db.read(`students/${raeUid}`))?.fields?.mentorRequest);
      report('Find a mentor: an answer that suggests they may be at risk gets the support message; nothing goes to Gemini and nothing is saved',
        shown && (await supportShown(page)) && gemini.requests.length === 0 && !saved, `${gemini.requests.length} Gemini requests, saved ${saved}`);
    });

    // 2. Mentor sign-up, signed out.
    const newMentor = `new.mentor.${randomBytes(3).toString('hex')}@northumbria.ac.uk`;
    await inFreshChrome(async (page, gemini) => {
      await page.go('/mentor-signup');
      await page.waitFor(page.has('Become a mentor'));
      await page.fill('#name', 'New Mentor');
      await page.fill('#displayName', 'New');
      await page.fill('#email', newMentor);
      await page.fill('#password', password);
      await page.fill('#course', 'BSc Law');
      for (const i of [1, 2, 3, 4, 5, 6]) await page.fill(`#q${i}`, i === 2 ? PHRASE : 'Football and films');
      await page.fill('#availability', 'Evenings');
      await page.evaluate(`([...document.querySelectorAll('input[type=checkbox]')].at(-1).click(), true)`);
      await page.press('Sign up as a mentor');
      const shown = await page.waitFor(`document.querySelector('.safety-note') !== null`);
      await sleep(1500);
      report('Mentor sign-up: an answer that suggests they may be at risk gets the support message; nothing goes to Gemini and no account is made',
        shown && (await supportShown(page)) && gemini.requests.length === 0 && !(await authHas(newMentor)), `${gemini.requests.length} Gemini requests`);
    });

    // 3. The GP finder, and 4. sign-up's own interests, signed in as Rae.
    await inFreshChrome(async (page, _gemini, urls) => {
      await page.logIn(rae, password);
      await page.go('/gp-finder');
      await page.waitFor(page.has('Use my location'));
      const from = urls.length;
      await page.fill('#search', PHRASE);
      await page.evaluate(`(document.querySelector('form.search').requestSubmit(), true)`);
      const shown = await page.waitFor(`document.querySelector('.safety-note') !== null`);
      await sleep(800);
      const lookedUp = urls.slice(from).some((url) => url.includes('postcodes.io'));
      report('The GP finder: words that suggest they may be at risk get the support message and aren’t looked up on postcodes.io', shown && (await supportShown(page)) && !lookedUp, `looked up: ${lookedUp}`);

      await page.go('/signup');
      await page.waitFor(`document.getElementById('own-interest') !== null`, 30000);
      await page.fill('#own-interest', PHRASE);
      await page.press('Add');
      const kept = await page.waitFor(`document.querySelector('.safety-note') !== null`);
      report('Sign-up: an interest of their own that suggests they may be at risk gets the support message and isn’t kept', kept && !(await page.evaluate(page.has(`${PHRASE}`))) && (await supportShown(page)));
    });

    // 5. A request for a different mentor, as Kit.
    await inFreshChrome(async (page) => {
      await page.logIn(kit, password);
      await page.go('/mentor');
      await page.waitFor(page.has('Ask for a different mentor'));
      await page.press('Ask for a different mentor');
      await page.waitFor(`document.querySelector('input[name="change-reason"]') !== null`);
      await page.evaluate(`(document.querySelectorAll('input[name="change-reason"]')[1].click(), true)`);
      await page.fill('textarea[id^="change-details-"]', 'My mentor assaulted me');
      await page.press('Send to the coordinator');
      const sent = await page.waitFor(`${page.has('You’ve asked the mentoring coordinator for a different mentor')} && document.querySelector('.safety-note') !== null`);
      const request = (await db.read(`mentorChangeRequests/${kitUid}`))?.fields;
      report('A request for a different mentor whose words suggest they may be at risk: the support message, and it still goes to the coordinator, as they chose',
        sent && (await supportShown(page)) && request?.details?.stringValue === 'My mentor assaulted me');
    });
  } finally {
    app.stop();
  }
  return results;
}
