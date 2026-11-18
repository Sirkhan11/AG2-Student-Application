// Checks what a verified Northumbria student sees, in a real browser, with no real account or email.
// Run inside the Auth and Firestore emulators, it starts the app in its emulators mode (vite dev --mode
// emulators: see src/lib/firebase/client.js), makes two made-up verified students there, and drives
// headless Chrome at phone size:
// - a logged-out visitor sent to log in from the checklist is back on it after logging in;
// - Home greets them by first name, and never shows a wrong name while it loads;
// - opening the chat from Home the first time in a tab slides it in straight away (no frozen screen
//   while the slide waits for the chat, no timeout);
// - logged in, every page opens and none sends them to log in;
// - "← Back" returns to the page they came from, or Home when they opened the page directly, and
//   never to the log-in page after being sent there;
// - a student whose details were lost (no name or course): Home says "Hi there" with Finish your
//   details, and saving them from the sign-up page greets them by name;
// - finding a mentor in the chat: with no mentors yet it says so and saves nothing; the questions come
//   one at a time with the focus in the message box and no Gemini; "stop" saves nothing and the chat
//   carries on; a full run with Change and Find my mentor (Gemini can't run against the emulators, so
//   it goes to the coordinator) shows the result in the chat; a mentor account isn't offered it; and
//   the Find a mentor page still works through the same shared steps;
// - the GP finder keeps "Use my location" on the phone: scripts/check-gp-finder-privacy.mjs, logged in.
// Nothing real is touched (project demo-ag2). Typed GP searches ask postcodes.io, as the page does.
// Run from the project folder (the emulators need Java 21 or newer):
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-signed-in.mjs"
// Uses Google Chrome from its usual place on a Mac, or CHROME=<path to Chrome>.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ag2';
if (!AUTH || !FIRESTORE) {
  console.log('Run it inside the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-signed-in.mjs"');
  process.exit(2);
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/** A free local port. @returns {Promise<number>} */
const freePort = () =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
      probe.close(() => done(port));
    });
  });

// ---------- Two made-up verified students, in the emulators ----------
/** @param {string} email @param {string} password @returns {Promise<string>} the uid */
async function verifiedStudent(email, password) {
  const made = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const { localId } = /** @type {{ localId: string }} */ (await made.json());
  const verified = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true })
  });
  assert.ok(made.ok && verified.ok, `making ${email}`);
  return localId;
}
/** Writes a record as the emulator's owner. @param {string} path @param {Record<string, string>} fields */
async function seed(path, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { stringValue: value }])) };
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.ok(response.ok, `seeding ${path}`);
}
const password = randomBytes(18).toString('base64url');
const sam = { email: 'sam.student@northumbria.ac.uk', password };
const lost = { email: 'lost.details@northumbria.ac.uk', password };
const nia = { email: 'nia.student@northumbria.ac.uk', password };
const pat = { email: 'pat.student@northumbria.ac.uk', password };
const mo = { email: 'mo.mentor@northumbria.ac.uk', password };
const samUid = await verifiedStudent(sam.email, sam.password);
await verifiedStudent(lost.email, lost.password);
const niaUid = await verifiedStudent(nia.email, nia.password);
await verifiedStudent(pat.email, pat.password);
const moUid = await verifiedStudent(mo.email, mo.password);
await seed(`students/${samUid}`, { name: 'Sam Student', course: 'BSc Law', email: sam.email, arrivalDate: '', role: 'student' });
await seed(`students/${niaUid}`, { name: 'Nia Student', course: 'BSc Nursing', email: nia.email, arrivalDate: '', role: 'student' });

/** A Firestore value as the emulator's REST API wants it. @param {unknown} value @returns {any} */
const asValue = (value) =>
  typeof value === 'boolean' ? { booleanValue: value }
    : Number.isInteger(value) ? { integerValue: String(value) }
      : typeof value === 'number' ? { doubleValue: value }
        : Array.isArray(value) ? { arrayValue: { values: value.map(asValue) } }
          : value && typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, v]) => [key, asValue(v)])) } }
            : { stringValue: String(value) };
/** Writes a document of any shape as the emulator's owner. @param {string} path @param {Record<string, unknown>} fields */
async function seedAs(path, fields) {
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: asValue(fields).mapValue.fields })
  });
  assert.ok(response.ok, `seeding ${path}`);
}
/** A document as the emulator's owner sees it, or null. @param {string} path @returns {Promise<any>} */
async function ownerRead(path) {
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } });
  return response.status === 404 ? null : response.json();
}
// A mentor account (it has a mentor profile), which the chat never offers a mentor.
await seedAs(`mentors/${moUid}`, { displayName: 'Mo', approved: false, maxStudents: 2, studentCount: 0, itemVectors: { q1: [], q2: [], q3: [], q4: [], q5: [], q6: [] } });

// ---------- The app, in its emulators mode ----------
const appPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const app = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--mode', 'emulators', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let appOutput = '';
app.stdout.on('data', (chunk) => (appOutput += chunk));
app.stderr.on('data', (chunk) => (appOutput += chunk));
for (let tries = 0; ; tries++) {
  if (app.exitCode !== null || tries > 120) throw new Error(`the app didn't start:\n${appOutput.split('\n').slice(-8).join('\n')}`);
  if (await fetch(`${BASE}/`).then((response) => response.ok, () => false)) break;
  await sleep(500);
}

// ---------- Chrome ----------
const chromePort = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'ag2-signed-in-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const report = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** @type {WebSocket | undefined} */
let ws;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json()).find((/** @type {any} */ t) => t.type === 'page');
    } catch {
      await sleep(250);
    }
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  ws = socket;
  await new Promise((done) => socket.addEventListener('open', done, { once: true }));
  let id = 0;
  const pending = new Map();
  /** @type {string[]} every request the page makes */
  const requests = [];
  /** @type {string[]} errors on the page, shown when a check fails */
  const problems = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'Network.requestWillBeSent') {
      requests.push(message.params.request.url);
    } else if (message.method === 'Runtime.exceptionThrown') {
      problems.push(String(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text).slice(0, 300));
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(message.params.args.map((/** @type {any} */ a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  });
  /** @param {string} method @param {object} [params] @returns {Promise<any>} */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (/** @type {any} */ m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      socket.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // Every state Home's heading is shown in (its words, and whether it's visible), from the moment the page starts.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__headings = [];
    new MutationObserver(() => {
      const h1 = document.querySelector('main h1');
      if (!h1) return;
      const seen = h1.textContent.trim() + ' | ' + getComputedStyle(h1).visibility;
      if (window.__headings.at(-1) !== seen) window.__headings.push(seen);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  ` });
  /** @param {string} expression @returns {Promise<any>} */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  /** @param {string} expression @param {number} [ms] */
  const waitFor = async (expression, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
    }
    return false;
  };
  /** @param {string} path */
  const go = async (path) => {
    await send('Page.navigate', { url: BASE + path });
    await waitFor(`document.readyState === 'complete'`);
    await sleep(600);
  };
  /** @param {string} words */
  const has = (words) => `document.body.innerText.includes(${JSON.stringify(words)})`;
  /** @param {string} selector @param {string} value */
  const fill = (selector, value) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  /** @param {string} words */
  const clickText = (words) =>
    evaluate(`(() => { const el = [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim().includes(${JSON.stringify(words)})); el.click(); return true; })()`);
  /** @param {{ email: string, password: string }} account */
  const logIn = async (account) => {
    await waitFor(has('Welcome back'));
    await fill('#email', account.email);
    await fill('#password', account.password);
    await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
  };
  const heading = () => evaluate(`document.querySelector('main h1')?.textContent.trim() ?? ''`);

  // Helpers for the chat and its cards.
  /** How many chat bubbles say this. @param {string} words */
  const bubbles = (words) => evaluate(`[...document.querySelectorAll('.bubble')].filter((b) => b.innerText.includes(${JSON.stringify(words)})).length`);
  /** Waits for one more bubble saying this. @param {string} words @param {number} [ms] */
  const another = async (words, ms = 15000) => {
    const before = await bubbles(words);
    return async () => waitFor(`[...document.querySelectorAll('.bubble')].filter((b) => b.innerText.includes(${JSON.stringify(words)})).length > ${before}`, ms);
  };
  /** Clicks the last working button with these words (the live card's); false if there isn't one. @param {string} words */
  const press = (words) =>
    evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((e) => e.textContent.trim() === ${JSON.stringify(words)} && !e.disabled).at(-1); if (!b) return false; b.click(); return true; })()`);
  /** Types into the message box and sends it. @param {string} text */
  const answer = async (text) => {
    await fill('#chat-message', text);
    await evaluate(`(document.getElementById('chat-message').form.requestSubmit(), true)`);
  };
  const geminiCalls = () => requests.filter((url) => /firebasevertexai|generativelanguage|aiplatform/.test(url));
  const savedNothing = async () => !(await ownerRead(`matches/${niaUid}`)) && !(await ownerRead(`students/${niaUid}`))?.fields?.mentorRequest;


  // 0. The Find a mentor page, with the steps it shares with the chat. First, while the browser is fresh:
  //    the emulator speaks HTTP/1.1, so a long session can use up Chrome's connections to it.
  await seedAs('mentors/mentor-alex', { displayName: 'Alex', approved: true, maxStudents: 2, studentCount: 0, itemVectors: { q1: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)), q2: [], q3: [], q4: [], q5: [], q6: [] } });
  await go('/');
  await logIn(pat);
  await waitFor(`location.pathname === '/home'`);
  await go('/find-mentor');
  const formShown = await waitFor('document.querySelector("#q6")', 30000);
  if (formShown) for (let q = 1; q <= 6; q++) await evaluate(`(() => { const el = document.querySelector('#q${q}'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Answer ${q}'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  if (formShown) await fill('#availability', 'Evenings');
  if (formShown) await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
  const pageFailed = await waitFor(has('We can’t match you automatically right now'), 120000);
  await press('Ask the coordinator to match me');
  const onToChat = await waitFor(`location.pathname === '/check-in' && ${has('We’re finding you a mentor')}`, 60000);
  report('The Find a mentor page still works with the shared steps: Gemini can’t here, so the coordinator, then on to the chat', formShown && pageFailed && onToChat);
  await go('/home');
  await waitFor(has('How can we help you today?'));
  await clickText('Log out');
  await waitFor(`location.pathname === '/'`);



  // 1. Sent to log in from the checklist, and back to it afterwards.
  await go('/checklist');
  const sent = await waitFor(`location.pathname === '/' && location.search === '?next=%2Fchecklist'`);
  await logIn(sam);
  report('Logged out, the checklist sends them to log in, and they’re back on it after logging in', sent && (await waitFor(`location.pathname === '/checklist' && ${has('completed')}`)));

  // 2. Home greets them by first name, with no wrong name on the way.
  await go('/home');
  const greeted = await waitFor(`document.querySelector('main h1')?.textContent.trim() === 'Hi Sam' && getComputedStyle(document.querySelector('main h1')).visibility === 'visible'`);
  /** @type {string[]} */
  const headings = await evaluate('window.__headings');
  const wrong = headings.filter((seen) => seen.endsWith('| visible') && !seen.startsWith('Hi Sam |'));
  report('Home greets them by first name ("Hi Sam"), and never shows another name while it loads', greeted && wrong.length === 0, wrong.join('; ') || `${await heading()}`);

  // 2b. Opening the chat from Home, the first time in this tab (the chat isn't loaded yet): the slide
  //     starts as soon as the chat is on the page (it waits at most 200 ms for it), rather than the
  //     screen freezing until Chrome gives up on the slide after 4 seconds. Measured from when the
  //     browser hands over to the app's update to when the slide starts, so loading the page's code
  //     (slow on the first visit to vite dev) doesn't count.
  /** @type {{ waited?: number, problem?: string }} */
  const slide = await evaluate(`new Promise((done) => {
    const original = document.startViewTransition?.bind(document);
    if (!original) return done({ problem: 'this Chrome has no View Transitions' });
    document.startViewTransition = (update) => {
      document.startViewTransition = original;
      let began = 0;
      const transition = original(async () => { began = performance.now(); await update(); });
      transition.ready.then(
        () => done({ waited: Math.round(performance.now() - began) }),
        (err) => done({ problem: err.name + ': ' + err.message })
      );
      return transition;
    };
    document.querySelector('a.ask[href="/check-in"]').click();
    setTimeout(() => done({ problem: 'no slide within 30 seconds' }), 30000);
  })`);
  const chatOpened = await waitFor(`location.pathname === '/check-in' && document.querySelector('[data-chat-ready]')`);
  report('Opening the chat from Home the first time in the tab: it slides in straight away, with no frozen screen or timeout',
    chatOpened && slide.waited !== undefined && slide.waited < 1000, slide.problem ?? `the slide started ${slide.waited} ms after the update began`);

  // 3. Every page opens, logged in; none sends them to log in.
  /** @type {string[]} */
  const sentAway = [];
  for (const path of ['/home', '/check-in', '/checklist', '/find-mentor', '/mentor', '/more', '/about-you', '/nhs-guide', '/gp-finder', '/late-arrivals', '/societies', '/sport', '/students-union', '/need-help', '/privacy', '/signup', '/forgot-password', '/mentor-signup']) {
    await go(path);
    await sleep(700);
    if (!(await evaluate(`location.pathname === ${JSON.stringify(path)} && !${has('Welcome back')}`))) sentAway.push(path);
  }
  report('Logged in, every page opens and none sends them to log in', sentAway.length === 0, sentAway.join(', '));
  report('The tab says AG2, or the page’s name with AG2', (await evaluate('document.title')) === 'Find a GP · AG2' || (await evaluate('document.title')) === 'AG2', await evaluate('document.title'));

  // 3b. An address the app doesn't have: a proper page with a way back, not a bare "404 Not Found".
  await go('/no-such-page');
  report('An address the app doesn’t have shows "We can’t find that page", with Go to Home and the bottom bar',
    await waitFor(`${has('We can’t find that page')} && document.querySelector('a.primary-button[href="/home"]') !== null && document.querySelector('nav.bottom-nav') !== null`));

  // 4. "← Back": to the page they came from, or Home when opened directly.
  /**
   * Back, then waits for the page it goes to (Home or More, which have no "← Back") to be on screen:
   * the address changes first, and the page a moment later, once the page change has started.
   * @param {string} path
   */
  const backTo = async (path) => {
    await clickText('← Back');
    return waitFor(`location.pathname === ${JSON.stringify(path)} && ![...document.querySelectorAll('button, a')].some((e) => e.textContent.trim().includes('← Back'))`, 8000);
  };
  /** @param {string} selector @param {string} path */
  const tap = async (selector, path) => {
    await evaluate(`(document.querySelector(${JSON.stringify(selector)}).click(), true)`);
    return waitFor(`location.pathname === ${JSON.stringify(path)} && ${has('← Back')}`, 8000);
  };
  await go('/home');
  await waitFor(has('How can we help you today?'));
  const fromHome = (await tap('a.feature-card[href="/gp-finder"]', '/gp-finder')) && (await backTo('/home'));
  await evaluate(`(document.querySelector('a.feature-card[href="/more"]').click(), true)`);
  await waitFor(`location.pathname === '/more' && document.querySelector('a.menu-item') !== null`);
  const fromMore = (await tap('a.menu-item[href="/nhs-guide"]', '/nhs-guide')) && (await backTo('/more'));
  await go('/late-arrivals');
  await waitFor(has('← Back'));
  const direct = await backTo('/home');
  const help = (await tap('a.feature-card[href="/need-help"]', '/need-help')) && (await backTo('/home'));
  report('"← Back" returns to where they came from (GP finder to Home, NHS guide to More, Need help to Home); opened directly, it goes Home', fromHome && fromMore && direct && help,
    `${fromHome} ${fromMore} ${direct} ${help}`);

  // 5. Lost details: "Hi there", the card, and saving them on the sign-up page. On the way, Back after
  //    being sent to log in goes Home, not back to the log-in page.
  await go('/home');
  await waitFor(has('How can we help you today?'));
  await clickText('Log out');
  await waitFor(`location.pathname === '/'`);
  await go('/gp-finder');
  await waitFor(`location.pathname === '/' && location.search === '?next=%2Fgp-finder'`);
  await logIn(lost);
  await waitFor(`location.pathname === '/gp-finder' && ${has('← Back')}`);
  report('Sent to log in from the GP finder and back: "← Back" then goes Home, not to the log-in page', await backTo('/home'));
  const asked = await waitFor(`${has('Finish your details')} && document.querySelector('main h1')?.textContent.trim() === 'Hi there'`);
  await clickText('Add my details');
  const form = await waitFor(`location.pathname === '/signup' && ${has('You’re logged in, so these are saved to your account.')} && !document.querySelector('#email') && !document.querySelector('#password')`);
  await fill('#name', 'Alex Student');
  await fill('#course', 'BSc History');
  await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
  const saved = await waitFor(`location.pathname === '/home' && document.querySelector('main h1')?.textContent.trim() === 'Hi Alex'`);
  await sleep(800);
  report('Details lost: Home says "Hi there" and asks; the sign-up page saves them to the account, and Home then says "Hi Alex"', asked && form && saved && !(await evaluate(has('Finish your details'))));

  // 6. Finding a mentor in the chat.
  await clickText('Log out');
  await waitFor(`location.pathname === '/'`);
  await logIn(nia);
  await waitFor(`location.pathname === '/home'`);
  await go('/check-in');
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Find a mentor')`);
  // No mentor with a free place: Alex is full for now.
  await seedAs('mentors/mentor-alex', { displayName: 'Alex', approved: true, maxStudents: 2, studentCount: 2, itemVectors: { q1: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)), q2: [], q3: [], q4: [], q5: [], q6: [] } });
  const noMentors = await another('There are no mentors available yet');
  await press('Find a mentor');
  report('In the chat, with no mentors yet: Find a mentor says so, and nothing is saved', (await (await noMentors)()) && (await savedNothing()));

  // Alex has room again, so the questions come.
  await seedAs('mentors/mentor-alex', { displayName: 'Alex', approved: true, maxStudents: 2, studentCount: 0, itemVectors: { q1: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)), q2: [], q3: [], q4: [], q5: [], q6: [] } });
  requests.length = 0;
  let next = await another('Question 1 of 6');
  await press('Find a mentor');
  const asked1 = await (await next)();
  const focused = await evaluate(`document.activeElement?.id === 'chat-message'`);
  next = await another('Question 2 of 6');
  await answer('Settling in');
  await (await next)();
  next = await another('Question 3 of 6');
  await answer('Climbing and films');
  await (await next)();
  next = await another('Nothing has been saved, and we can carry on chatting');
  await answer('stop');
  const stopped = await (await next)();
  const carriesOn = await evaluate(`document.getElementById('chat-message').placeholder === 'Type your message...'`);
  report('In the chat: the questions one at a time, focus in the message box, no Gemini; "stop" ends it, saving nothing, and the chat carries on',
    asked1 && focused && stopped && carriesOn && (await savedNothing()) && geminiCalls().length === 0, `${asked1} ${focused} ${stopped} ${carriesOn} ${geminiCalls().length} Gemini calls`);

  // A full run: the answers, Change, Find my mentor, then the coordinator (Gemini can't run here).
  requests.length = 0;
  next = await another('Question 1 of 6');
  await press('Find a mentor');
  await (await next)();
  for (const [i, reply] of ['Settling in', 'Climbing and films', 'A long walk', 'Planning ahead, with others', 'Making friends', 'Someone patient'].entries()) {
    next = i < 5 ? await another(`Question ${i + 2} of 6`) : await another('How often would you like to meet?');
    await answer(reply);
    await (await next)();
  }
  next = await another('When are you usually free?');
  await press('Every two weeks');
  await (await next)();
  next = await another('Here are your answers');
  await answer('Weekday afternoons');
  await (await next)();
  next = await another('Question 3 of 6');
  await evaluate(`(() => { [...document.querySelectorAll('button[aria-label^="Change: What does a good weekend"]')].filter((b) => !b.disabled).at(-1).click(); return true; })()`);
  await (await next)();
  next = await another('Here are your answers');
  await answer('A quiet day in');
  const reviewAgain = await (await next)();
  const nothingBefore = await savedNothing();
  const quietBefore = geminiCalls().length === 0;
  next = await another('We can’t match you automatically right now', 120000);
  await press('Find my mentor');
  const geminiFailed = await (await next)();
  next = await another('We’re finding you a mentor, and we’ll let you know soon.', 60000);
  await press('Ask the coordinator to match me');
  const result = await (await next)();
  const match = await ownerRead(`matches/${niaUid}`);
  const request = (await ownerRead(`students/${niaUid}`))?.fields?.mentorRequest?.mapValue?.fields;
  const answers = request?.answers?.arrayValue?.values?.map((/** @type {any} */ v) => v.stringValue) ?? [];
  report('In the chat: all the answers, how often, when free, Change; nothing saved or sent to Gemini until Find my mentor; then the coordinator, and the result in the chat',
    reviewAgain && nothingBefore && quietBefore && geminiFailed && result && match?.fields?.status?.stringValue === 'coordinator' && answers[2] === 'A quiet day in' && answers.length === 6,
    `${reviewAgain} ${nothingBefore} ${quietBefore} ${geminiFailed} ${result} ${match?.fields?.status?.stringValue} ${answers.length}`);

  // A mentor account isn't offered a mentor.
  await go('/home');
  await waitFor(has('How can we help you today?'));
  await clickText('Log out');
  await waitFor(`location.pathname === '/'`);
  await logIn(mo);
  await waitFor(`location.pathname === '/home'`);
  await go('/check-in');
  await waitFor(has('How’s your day been?'));
  await sleep(1000);
  report('A mentor account: the chat doesn’t offer to find them a mentor', !(await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Find a mentor')`)) && !(await evaluate(has('If you’d like a student mentor'))));
} finally {
  ws?.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

// 7. The GP finder's privacy check, logged in as Sam.
const gp = await new Promise((done) => {
  const child = spawn(process.execPath, ['scripts/check-gp-finder-privacy.mjs', BASE], { env: { ...process.env, CHECK_LOGIN_EMAIL: sam.email, CHECK_LOGIN_PASSWORD: sam.password }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.on('close', (code) => done({ code, output }));
});
const gpResult = /** @type {{ code: number, output: string }} */ (gp);
for (const line of gpResult.output.split('\n').filter((line) => /^FAIL/.test(line))) console.log(`      ${line}`);
if (!/\d+\/\d+ checks passed/.test(gpResult.output)) console.log(gpResult.output.split('\n').slice(-12).map((line) => `      ${line}`).join('\n'));
report('The GP finder keeps "Use my location" on the phone, logged in (check-gp-finder-privacy)', gpResult.code === 0, gpResult.output.match(/\d+\/\d+ checks passed/)?.[0] ?? 'no result');

app.kill();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
