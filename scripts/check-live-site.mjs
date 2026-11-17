// Checks the live site in a real browser (headless Chrome at phone size, over the DevTools protocol):
// - another address is turned away on log in, both sign-ups and forgot password, before anything is
//   sent to Firebase Auth (and, for mentors, before Gemini or the matching model);
// - logged out, the five public pages open (log in, sign up, forgot password, mentor sign-up, Need
//   help) and every other page goes to log in, with the way back (?next=); the team's pages and the
//   pretend Blackboard never show; the tab says AG2;
// - Need help shows Northumbria's own support (Ask4Help to call, the counselling page), no placeholder;
// - an unverified Northumbria account sees only the check-your-inbox screen ("I've clicked it" says
//   it isn't verified yet, Need help now still opens, Log out works) and is never sent to log in, and
//   no verification email is asked for;
// - the deployed Firestore rules let that unverified account, and an account made without the app's
//   forms (a never-verified example.com address), read and write nothing.
// For those parts it makes two throwaway accounts in the project .env points at, with made-up
// addresses and random passwords: making them sends no email, Resend is never pressed, and both are
// deleted at the end. Nothing secret is printed.
// Run from the project folder, against the local preview (npm run build:live, then
// npx --engine-strict=false firebase-tools emulators:start --only hosting --project demo-ag2) or the live site:
//   node --env-file=.env scripts/check-live-site.mjs [--base https://ag2-dev-thomas.web.app]
// Uses Google Chrome from its usual place on a Mac, or CHROME=<path to Chrome>.
// Pages for a verified student (Home's greeting, the GP finder) are checked signed in against the
// emulators by scripts/check-signed-in.mjs.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, deleteUser, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore/lite';

const baseAt = process.argv.indexOf('--base');
const BASE = (baseAt > 0 ? process.argv[baseAt + 1] : 'http://127.0.0.1:5005').replace(/\/$/, '');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const report = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// The throwaway account (made before Chrome starts; no email is sent by making it).
const env = process.env;
const app = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
const auth = getAuth(app);
const db = getFirestore(app);
const throwaway = { email: `ag2-verify-check-${randomBytes(4).toString('hex')}@northumbria.ac.uk`, password: randomBytes(18).toString('base64url') };
const outsider = { email: `ag2-rules-check-${randomBytes(4).toString('hex')}@example.com`, password: randomBytes(18).toString('base64url') };
for (const account of [throwaway, outsider]) {
  await createUserWithEmailAndPassword(auth, account.email, account.password);
  await signOut(auth);
}

const profile = mkdtempSync(join(tmpdir(), 'ag2-live-site-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(250); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const requests = [];
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const waitFor = async (expression, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true; await sleep(150); } return false; };
  const go = async (path) => { await send('Page.navigate', { url: BASE + path }); await waitFor(`document.readyState === 'complete' && document.querySelector('main, h1')`); await sleep(500); };
  const has = (words) => `document.body.innerText.includes(${JSON.stringify(words)})`;
  const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const click = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)}).click(), true)`);
  const clickText = (words) => evaluate(`(() => { const el = [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim().includes(${JSON.stringify(words)})); el.click(); return true; })()`);
  const authCalls = () => requests.filter((u) => /identitytoolkit|securetoken/.test(u)).map((u) => u.split('?')[0].split('/').pop());
  const UNI = 'Please use your Northumbria email address (ending @northumbria.ac.uk).';

  // 1. Another address is turned away on every form, before anything is sent.
  await go('/');
  requests.length = 0;
  await fill('#email', 'someone@gmail.com'); await fill('#password', 'whatever-123'); await click('button[type=submit]');
  report('Log in: a Gmail address is refused with the Northumbria message, and nothing goes to Firebase Auth', (await waitFor(has(UNI))) && authCalls().length === 0, authCalls().join(', '));

  await go('/signup');
  requests.length = 0;
  await fill('#name', 'Test Person'); await fill('#email', 'someone@gmail.com'); await fill('#password', 'whatever-123'); await fill('#course', 'Law'); await click('button[type=submit]');
  report('Student sign-up: a Gmail address is refused, and no account is made', (await waitFor(has(UNI))) && authCalls().length === 0, authCalls().join(', '));

  await go('/mentor-signup');
  requests.length = 0;
  for (const [field, value] of [['#name', 'Test Person'], ['#displayName', 'Test'], ['#email', 'someone@gmail.com'], ['#password', 'whatever-1234'], ['#course', 'Law'], ['#availability', 'evenings']]) await fill(field, value);
  for (let q = 1; q <= 6; q++) await fill(`#q${q}`, 'Football and films');
  await click('input[type=checkbox]'); await click('button[type=submit]');
  const ai = requests.filter((u) => /firebasevertexai|generativelanguage|huggingface|\.wasm|identitytoolkit/.test(u));
  report('Mentor sign-up: a Gmail address is refused before Gemini, the model or Firebase Auth is used', (await waitFor(has(UNI))) && ai.length === 0, ai.map((u) => new URL(u).host).join(', '));

  await go('/forgot-password');
  requests.length = 0;
  await fill('#email', 'someone@gmail.com'); await click('button[type=submit]');
  report('Forgot password: a Gmail address is refused, and no reset email is asked for', (await waitFor(has(UNI))) && authCalls().length === 0, authCalls().join(', '));

  // 2. Logged out: the five public pages open; every other page goes to log in and back; what's left
  //    out never shows; Need help has Northumbria's own support; the tab says AG2.
  const PUBLIC = { '/': 'Welcome back', '/signup': 'Create your account', '/forgot-password': 'Reset your password', '/mentor-signup': 'Become a mentor', '/need-help': 'Need help now?' };
  for (const [path, heading] of Object.entries(PUBLIC)) {
    await go(path);
    await sleep(800);
    report(`Logged out, ${path} opens`, await waitFor(`location.pathname === ${JSON.stringify(path)} && ${has(heading)}`));
  }
  // Need help's "← Back", logged out: to log in, whether it was opened directly or from the log-in page.
  await go('/need-help');
  await waitFor(has('← Back'));
  await clickText('← Back');
  const directHelp = await waitFor(`location.pathname === '/' && ${has('Welcome back')}`, 8000);
  await go('/');
  await waitFor(has('Need help now?'));
  await evaluate(`(document.querySelector('a.help-link').click(), true)`);
  await waitFor(`location.pathname === '/need-help' && ${has('← Back')}`);
  await clickText('← Back');
  const fromLogin = await waitFor(`location.pathname === '/' && ${has('Welcome back')}`, 8000);
  report('Logged out, Need help’s "← Back" goes to log in, opened directly or from the log-in page', directHelp && fromLogin);
  const PRIVATE = ['/home', '/check-in', '/checklist', '/find-mentor', '/mentor', '/more', '/nhs-guide', '/gp-finder', '/late-arrivals', '/societies', '/societies/15', '/sport', '/sport/swimming', '/students-union'];
  /** @type {string[]} */
  const notSent = [];
  for (const path of PRIVATE) {
    await go(path);
    const sent = await waitFor(`location.pathname === '/' && location.search === ${JSON.stringify(`?next=${encodeURIComponent(path)}`)} && ${has('Welcome back')}`, 8000);
    if (!sent) notSent.push(path);
  }
  report(`Logged out, the other ${PRIVATE.length} pages go to log in, with the way back (?next=)`, notSent.length === 0, notSent.join(', '));
  for (const path of ['/dev/blackboard', '/matching-demo', '/matching-test', '/blackboard/mock/learn/api/public/v1/oauth2/authorizationcode']) {
    await go(path);
    report(`${path} isn’t on the site (logged out, it goes to log in)`, await waitFor(`location.pathname === '/' && ${has('Welcome back')} && !${has('Pretend Blackboard')}`, 8000));
  }
  await go('/need-help');
  await waitFor(has('University support'));
  const help = await evaluate(`({ text: document.body.innerText, calls: [...document.querySelectorAll('a[href^="tel:"]')].map((a) => [a.getAttribute('href'), a.textContent.trim()]), links: [...document.querySelectorAll('a')].map((a) => a.href) })`);
  const COUNSELLING = 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/overview-of-support/';
  report('Need help: no placeholder, Ask4Help to call on 0191 227 4646, and the counselling page', !/Add the university|verified\s+wellbeing support contact/i.test(help.text)
    && help.calls.some(([href, label]) => href === 'tel:+441912274646' && label.includes('0191 227 4646')) && help.links.includes(COUNSELLING),
    `calls: ${help.calls.map(([href]) => href).join(' ')}`);
  report('Need help still has 999 and 111 to call', help.calls.some(([href]) => href === 'tel:999') && help.calls.some(([href]) => href === 'tel:111'));
  report('The tab says AG2, not the web address', (await evaluate('document.title')) === 'AG2', await evaluate('document.title'));

  // 3. The check-your-inbox screen, with the throwaway account (never verified).
  await go('/');
  requests.length = 0;
  await fill('#email', throwaway.email); await fill('#password', throwaway.password); await click('button[type=submit]');
  const shown = await waitFor(`${has('Check your uni inbox')} && ${has(throwaway.email)} && ${has('Junk')}`);
  report('An unverified Northumbria account sees only the check-your-inbox screen, with its address and Junk', shown);
  await clickText('I’ve clicked it');
  report('"I’ve clicked it" before clicking the link says it isn’t verified yet', await waitFor(has('It isn’t verified yet')));
  await go('/home');
  report('Home still shows only the check-your-inbox screen', await waitFor(`${has('Check your uni inbox')} && !${has('How can we help you today?')}`));
  /** @type {string[]} */
  const sentAway = [];
  for (const path of ['/checklist', '/gp-finder', '/mentor', '/societies', '/check-in']) {
    await go(path);
    if (!(await waitFor(`location.pathname === ${JSON.stringify(path)} && ${has('Check your uni inbox')}`, 8000))) sentAway.push(path);
  }
  report('Signed in but not verified yet, they’re never sent to log in: every page shows check-your-inbox', sentAway.length === 0, sentAway.join(', '));
  await go('/need-help');
  report('Need help now still opens while unverified', await waitFor(`${has('Need help now?')} && !${has('Check your uni inbox')}`));
  report('No verification email was asked for (Resend wasn’t pressed)', !requests.some((u) => /sendOobCode/.test(u)));
  await go('/home');
  await waitFor(has('Check your uni inbox'));
  await clickText('Log out');
  report('Log out from the check-your-inbox screen goes back to log in', await waitFor(`location.pathname === '/' && ${has('Welcome back')}`));

  console.log(`\nConsole errors on the pages: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 4).join('\n  ')}` : ''}`);

  // 4. The deployed rules, signed in as each throwaway account (no browser needed).
  for (const [who, account] of [['an unverified Northumbria address', throwaway], ['an example.com address made without the app', outsider]]) {
    const { user } = await signInWithEmailAndPassword(auth, account.email, account.password);
    /** @type {[string, () => Promise<unknown>][]} */
    const attempts = [
      ['read its record', () => getDoc(doc(db, 'students', user.uid))],
      ['save a checklist', () => setDoc(doc(db, 'students', user.uid), { checklist: [] }, { merge: true })],
      ['read a society', () => getDoc(doc(db, 'societies', '15'))],
      ['read a sports club', () => getDoc(doc(db, 'sportClubs', 'swimming'))],
      ['list approved mentors', () => getDocs(query(collection(db, 'mentors'), where('approved', '==', true)))],
      ['ask for the coordinator', () => setDoc(doc(db, 'matches', user.uid), { status: 'coordinator', meetingFrequency: 'weekly', availability: '', createdAt: serverTimestamp() })],
      ['ask to change mentor', () => setDoc(doc(db, 'mentorChangeRequests', user.uid), { reason: 'not-a-good-fit', details: '', createdAt: serverTimestamp() })]
    ];
    /** @type {string[]} */
    const allowed = [];
    for (const [what, attempt] of attempts) {
      try {
        await attempt();
        allowed.push(what);
      } catch (err) {
        if (/** @type {{ code?: string }} */ (err).code !== 'permission-denied') allowed.push(`${what} (${/** @type {{ code?: string }} */ (err).code})`);
      }
    }
    report(`The rules let ${who} read and write nothing`, allowed.length === 0, allowed.join(', '));
    await signOut(auth);
  }
} finally {
  ws?.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  for (const account of [throwaway, outsider]) {
    try {
      const { user } = await signInWithEmailAndPassword(auth, account.email, account.password);
      await deleteUser(user);
      console.log(`A throwaway account (${account.email.split('-').slice(0, 3).join('-')}-…) was deleted.`);
    } catch (err) {
      console.log(`Deleting a throwaway account FAILED (${err?.code}). Delete ag2-verify-check-* and ag2-rules-check-* in the console.`);
    }
  }
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed (${BASE})`);
process.exit(results.every(Boolean) ? 0 : 1);
