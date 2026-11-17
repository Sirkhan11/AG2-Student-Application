// Checks what a verified Northumbria student sees, in a real browser, with no real account or email.
// Run inside the Auth and Firestore emulators, it starts the app in its emulators mode (vite dev --mode
// emulators: see src/lib/firebase/client.js), makes two made-up verified students there, and drives
// headless Chrome at phone size:
// - a logged-out visitor sent to log in from the checklist is back on it after logging in;
// - Home greets them by first name, and never shows a wrong name while it loads;
// - logged in, every page opens and none sends them to log in;
// - a student whose details were lost (no name or course): Home says "Hi there" with Finish your
//   details, and saving them from the sign-up page greets them by name;
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
const samUid = await verifiedStudent(sam.email, sam.password);
await verifiedStudent(lost.email, lost.password);
await seed(`students/${samUid}`, { name: 'Sam Student', course: 'BSc Law', email: sam.email, arrivalDate: '', role: 'student' });

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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
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

  // 3. Every page opens, logged in; none sends them to log in.
  /** @type {string[]} */
  const sentAway = [];
  for (const path of ['/home', '/check-in', '/checklist', '/find-mentor', '/mentor', '/more', '/nhs-guide', '/gp-finder', '/late-arrivals', '/societies', '/sport', '/students-union', '/need-help', '/signup', '/forgot-password', '/mentor-signup']) {
    await go(path);
    await sleep(700);
    if (!(await evaluate(`location.pathname === ${JSON.stringify(path)} && !${has('Welcome back')}`))) sentAway.push(path);
  }
  report('Logged in, every page opens and none sends them to log in', sentAway.length === 0, sentAway.join(', '));
  report('The tab says AG2, or the page’s name with AG2', (await evaluate('document.title')) === 'Find a GP · AG2' || (await evaluate('document.title')) === 'AG2', await evaluate('document.title'));

  // 4. Lost details: "Hi there", the card, and saving them on the sign-up page.
  await go('/home');
  await waitFor(has('How can we help you today?'));
  await clickText('Log out');
  await waitFor(`location.pathname === '/'`);
  await logIn(lost);
  await waitFor(`location.pathname === '/home'`);
  const asked = await waitFor(`${has('Finish your details')} && document.querySelector('main h1')?.textContent.trim() === 'Hi there'`);
  await clickText('Add my details');
  const form = await waitFor(`location.pathname === '/signup' && ${has('You’re logged in, so these are saved to your account.')} && !document.querySelector('#email') && !document.querySelector('#password')`);
  await fill('#name', 'Alex Student');
  await fill('#course', 'BSc History');
  await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
  const saved = await waitFor(`location.pathname === '/home' && document.querySelector('main h1')?.textContent.trim() === 'Hi Alex'`);
  await sleep(800);
  report('Details lost: Home says "Hi there" and asks; the sign-up page saves them to the account, and Home then says "Hi Alex"', asked && form && saved && !(await evaluate(has('Finish your details'))));
} finally {
  ws?.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

// 5. The GP finder's privacy check, logged in as Sam.
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
