// After every deploy: one real message through the deployed app's own code (the live site's pages,
// its Firebase SDK and Gemini), and a real reply must come back. A deploy isn't done until this
// passes. On 18 November every ordinary message on the live site failed (the app sent Gemini two
// fields it doesn't accept) while every other check passed, because nothing had sent a real message
// through the deployed app.
//
// It makes a throwaway Northumbria account that's already verified (the live app only lets verified
// Northumbria accounts in): a made-up address, imported with firebase-tools (auth:import, through the
// same login as the deploys), so no email is sent. It logs in on the live site in headless Chrome,
// ends the checklist walkthrough if it's asking, sends one ordinary message, and checks Gemini
// answered (HTTP 200) and the chat showed a reply rather than its error message. Then the account
// deletes itself.
//
// One Gemini request, counted in the scripts' daily budget. App Check: the debug token stands in for
// reCAPTCHA, which doesn't score headless Chrome as a person; it's set before the site's own code runs
// and never printed.
//
// From the project folder:
//   node --env-file=.env --env-file=.env.development.local scripts/check-live-chat.mjs [--base https://ag2-dev-thomas.web.app]

import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { deleteUser, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { deleteDoc, doc, getFirestore } from 'firebase/firestore';
import { ERROR_MESSAGE, UNAVAILABLE_MESSAGE } from '#lib/checkin/chat-turns.js';
import { BUDGET_FILE, budgetFrom, countRequest, requestsOn, today } from './lib/gemini-rest.mjs';
import { openChrome, sleep } from './lib/emulator-app.mjs';

const at = process.argv.indexOf('--base');
const BASE = (at === -1 ? 'https://ag2-dev-thomas.web.app' : process.argv[at + 1]).replace(/\/$/, '');
/** An ordinary message: no walkthrough, no action, just the chat (with the society short list). */
const MESSAGE = 'Hi! Are there any salsa societies?';

const env = process.env;
for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_APPCHECK_DEBUG_TOKEN']) {
  if (!env[name]) {
    console.log(`Missing ${name}. See the top of this file for how to run it.`);
    process.exit(2);
  }
}
const budgetFile = env.GEMINI_BUDGET_FILE || BUDGET_FILE;
if (requestsOn(budgetFile, today()) >= budgetFrom(env)) {
  console.log('Stopped: the scripts have used their Gemini budget for today. Set GEMINI_SCRIPT_BUDGET=<n> to go over it on purpose.');
  process.exit(1);
}

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const report = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// The throwaway account, imported already verified. Its password is hashed with a one-off key
// (HMAC-SHA256), which is how auth:import takes passwords; Firebase checks it when it logs in.
const account = { email: `ag2-chat-check-${randomBytes(4).toString('hex')}@northumbria.ac.uk`, password: randomBytes(18).toString('base64url') };
const uid = `chatcheck${randomBytes(10).toString('hex')}`;
const hashKey = randomBytes(32);
const folder = mkdtempSync(join(tmpdir(), 'ag2-live-chat-'));
try {
  const file = join(folder, 'account.json');
  const passwordHash = createHmac('sha256', hashKey).update(account.password).digest('base64');
  writeFileSync(file, JSON.stringify({ users: [{ localId: uid, email: account.email, emailVerified: true, passwordHash }] }));
  execFileSync('npx', ['--yes', '--engine-strict=false', 'firebase-tools', 'auth:import', file, '--hash-algo=HMAC_SHA256', `--hash-key=${hashKey.toString('base64')}`, '--project', env.VITE_FIREBASE_PROJECT_ID], { stdio: 'ignore' });
} finally {
  rmSync(folder, { recursive: true, force: true });
}

const page = await openChrome(BASE);
try {
  // Before the site's own code runs: App Check's debug mode, as on localhost.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `self.FIREBASE_APPCHECK_DEBUG_TOKEN = ${JSON.stringify(env.VITE_APPCHECK_DEBUG_TOKEN)};` });
  /** Gemini's answers to the page (HTTP status), and errors the page logged. */
  const statuses = /** @type {number[]} */ ([]);
  const errors = /** @type {string[]} */ ([]);
  /** The Gemini requests themselves (POST), not the browser's cross-origin checks before them. */
  const posts = new Set();
  page.listen((message) => {
    if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST' && /generateContent/.test(message.params.request.url)) {
      posts.add(message.params.requestId);
    } else if (message.method === 'Network.responseReceived' && posts.has(message.params.requestId)) {
      statuses.push(message.params.response.status);
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((/** @type {any} */ arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 300));
    }
  });
  await page.send('Network.enable');

  const loggedIn = await page.logIn(account.email, account.password);
  report('A verified Northumbria account logs in on the live site', loggedIn);
  await page.go('/check-in');
  const ready = await page.waitFor(`document.querySelector('[data-chat-ready]') !== null`, 30000);
  // If the chat opened by asking about the checklist, end that (the app does it: no Gemini).
  if (await page.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Stop')`)) {
    await page.press('Stop');
    await sleep(800);
  }
  const before = await page.evaluate(`document.querySelectorAll('.bubble').length`);
  countRequest(budgetFile, today());
  await page.answer(MESSAGE);
  const answered = await page.waitFor(
    `document.querySelectorAll('.bubble').length > ${before} + 1 && !document.querySelector('.bubble.typing') && !document.querySelector('.bubble:last-of-type.user')`,
    45000
  );
  await sleep(500);
  const reply = await page.evaluate(`[...document.querySelectorAll('.bubble:not(.user)')].map((b) => b.innerText.trim()).filter(Boolean).at(-1) ?? ''`);
  const cards = await page.evaluate(`[...document.querySelectorAll('.cards')].at(-1)?.querySelectorAll('a, article, [aria-label]').length ?? 0`);
  const failed = reply === ERROR_MESSAGE || reply === UNAVAILABLE_MESSAGE;
  report(
    `A real message ("${MESSAGE}") through the deployed app gets a real reply, and Gemini accepted the request`,
    ready && answered && !failed && statuses.length > 0 && statuses.every((status) => status === 200),
    `Gemini HTTP ${statuses.join(', ') || 'none'}; reply: "${reply.slice(0, 140)}"${cards ? `; ${cards} card parts` : ''}`
  );
  const geminiErrors = errors.filter((error) => /AI:|generateContent|Gemini/.test(error));
  report('No Gemini errors in the page', geminiErrors.length === 0, geminiErrors.join(' | ').slice(0, 400));
} finally {
  await page.close();
  // Nothing of the throwaway account is left behind: it deletes what it may have saved, then itself.
  const client = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
  try {
    const signedIn = await signInWithEmailAndPassword(getAuth(client), account.email, account.password);
    for (const path of [`chatNotes/${uid}`, `students/${uid}`]) await deleteDoc(doc(getFirestore(client), path)).catch(() => {});
    await deleteUser(signedIn.user);
  } catch (err) {
    console.log(`Couldn't delete the throwaway account (${/** @type {{ code?: string }} */ (err).code ?? 'error'}): delete it in the console (its address starts ag2-chat-check-).`);
  }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed (${BASE})`);
process.exit(passed === results.length ? 0 : 1);
