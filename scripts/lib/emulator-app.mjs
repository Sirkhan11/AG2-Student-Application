// The app in headless Chrome against the Auth and Firestore emulators, for the browser checks:
// made-up verified students and records (written as the emulator's owner, so the rules don't apply),
// the app in its emulators mode (vite dev --mode emulators), and Chrome at phone size over the
// DevTools protocol. Nothing real is touched (project demo-ag2). Run the checks inside
// `firebase-tools emulators:exec --only auth,firestore --project demo-ag2`.

import { DEFAULT_TASKS } from '#lib/checklist/tasks.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/** Where the emulators are, or null when the check isn't running inside them. */
export function emulators() {
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  return auth && firestore ? { auth, firestore, project: process.env.GCLOUD_PROJECT ?? 'demo-ag2' } : null;
}

/** @returns {Promise<number>} a free local port */
const freePort = () =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
      probe.close(() => done(port));
    });
  });

/** @param {unknown} value @returns {any} a value as the emulator's REST API wants it */
function asValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(asValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, v]) => [key, asValue(v)])) } };
  return { stringValue: String(value) };
}

/**
 * The emulators, as their owner: making verified accounts, and writing and reading records.
 * @param {{ auth: string, firestore: string, project: string }} where
 */
export function owner({ auth, firestore, project }) {
  const documents = `http://${firestore}/v1/projects/${project}/databases/(default)/documents`;
  return {
    /**
     * A verified account with this address (or, with verified false, one that hasn't verified its
     * address yet); returns its uid.
     * @param {string} email @param {string} password @param {boolean} [verified]
     */
    async verifiedAccount(email, password, verified = true) {
      const made = await fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      const { localId } = /** @type {{ localId: string }} */ (await made.json());
      assert.ok(made.ok, `making ${email}`);
      if (!verified) return localId;
      const marked = await fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:update`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true })
      });
      assert.ok(marked.ok, `verifying ${email}`);
      return localId;
    },
    /** Writes a record (any shape: maps, lists, Dates as timestamps). @param {string} path @param {Record<string, unknown>} fields */
    async seed(path, fields) {
      const response = await fetch(`${documents}/${path}`, {
        method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: asValue(fields).mapValue.fields })
      });
      assert.ok(response.ok, `seeding ${path}`);
    },
    /** A record as the REST API gives it, or null. @param {string} path @returns {Promise<any>} */
    async read(path) {
      const response = await fetch(`${documents}/${path}`, { headers: { authorization: 'Bearer owner' } });
      return response.status === 404 ? null : response.json();
    },
    /** Deletes a record (nothing happens if it isn't there). @param {string} path */
    async delete(path) {
      const response = await fetch(`${documents}/${path}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
      assert.ok(response.ok || response.status === 404, `deleting ${path}`);
    },
    /**
     * Signs in as an account the way the app does (Firebase Auth's REST API), for calling the
     * emulated function directly: its ID token and uid.
     * @param {string} email @param {string} password
     * @returns {Promise<{ idToken: string, uid: string }>}
     */
    async signIn(email, password) {
      const response = await fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      assert.ok(response.ok, `signing in as ${email}`);
      const { idToken, localId } = /** @type {{ idToken: string, localId: string }} */ (await response.json());
      return { idToken, uid: localId };
    }
  };
}

/**
 * Where the other emulators are, from the Emulator Hub that emulators:exec points at: the Functions
 * emulator's address, or null when it isn't running (the check then skips what needs it).
 * @returns {Promise<{ functions: string | null }>}
 */
export async function emulatorHosts() {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) return { functions: null };
  try {
    const running = /** @type {Record<string, { host: string, port: number }>} */ (await (await fetch(`http://${hub}/emulators`)).json());
    const functions = running.functions;
    return { functions: functions ? `${functions.host === '0.0.0.0' || functions.host === '::' ? '127.0.0.1' : functions.host}:${functions.port}` : null };
  } catch {
    return { functions: null };
  }
}

/**
 * A checklist with every default task ticked, to add to a made-up student's record when a check is
 * about something else: the chat's first message then asks how their day's been, rather than
 * starting to go through their checklist (which takes what they type first).
 */
export const CHECKLIST_DONE = Object.freeze({ checklist: DEFAULT_TASKS.map((task) => ({ ...task, done: true })), checklistOffered: ['enrol'] });

/** Starts the app in its emulators mode; returns its address and how to stop it. */
export async function startApp() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--mode', 'emulators', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  for (let tries = 0; ; tries++) {
    if (app.exitCode !== null || tries > 120) throw new Error('the app didn’t start');
    if (await fetch(`${base}/`).then((response) => response.ok, () => false)) break;
    await sleep(500);
  }
  return { base, stop: () => void app.kill() };
}

/**
 * Opens headless Chrome at phone size (390×844) on the app, with a fresh profile.
 * @param {string} base the app's address
 */
export async function openChrome(base) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'ag2-check-'));
  const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((/** @type {any} */ t) => t.type === 'page');
    } catch {
      await sleep(250);
    }
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener('open', done, { once: true }));
  let id = 0;
  const pending = new Map();
  /** @type {((message: any) => void)[]} */
  const handlers = [];
  /**
   * Every request the page has made since Chrome opened: its address, method and, for a POST, what
   * it sent (as far as DevTools hands it over), so a check can see where something went.
   * @type {{ url: string, method: string, postData: string, headers: Record<string, string> }[]}
   */
  const requests = [];
  /** Everything written to the console, at any level, and every uncaught error, as text. @type {string[]} */
  const consoleLines = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Network.requestWillBeSent') {
      const { url, method, postData, headers } = message.params.request;
      requests.push({ url, method, postData: postData ?? '', headers: headers ?? {} });
    } else if (message.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(`${message.params.type}: ${message.params.args.map((/** @type {any} */ arg) => arg.value ?? arg.description ?? '').join(' ')}`);
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`exception: ${message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? ''}`);
    }
    for (const handler of handlers) handler(message);
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

  /** @param {string} expression @returns {Promise<any>} */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  /** @param {string} expression @param {number} [ms] */
  const waitFor = async (expression, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
    }
    return false;
  };
  /** @param {string} words */
  const has = (words) => `document.body.innerText.includes(${JSON.stringify(words)})`;
  /** Types a value the way a person does, so Svelte sees it. @param {string} selector @param {string} value */
  const fill = (selector, value) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  const page = {
    send,
    evaluate,
    waitFor,
    has,
    fill,
    requests,
    consoleLines,
    /** Adds a handler for every DevTools message that isn't an answer. @param {(message: any) => void} handler */
    listen: (handler) => void handlers.push(handler),
    /** Opens a page; vite dev hydrates a moment after loading, and a click before then is lost. @param {string} path */
    async go(path) {
      await send('Page.navigate', { url: base + path });
      await waitFor(`document.readyState === 'complete'`);
      await sleep(1500);
    },
    /** Clicks the last button with exactly these words that isn't switched off; false if there isn't one. @param {string} words */
    press: (words) =>
      evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((e) => e.textContent.trim() === ${JSON.stringify(words)} && !e.disabled).at(-1); if (!b) return false; b.click(); return true; })()`),
    /** Logs in from the log-in page and waits for Home. @param {string} email @param {string} password */
    async logIn(email, password) {
      await page.go('/');
      await waitFor(has('Welcome back'));
      await fill('#email', email);
      await fill('#password', password);
      await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
      return waitFor(`location.pathname === '/home'`);
    },
    /** Logs out from More, where Log out lives (Home is a dashboard without it), and waits for the log-in page. */
    async logOut() {
      await page.go('/more');
      await waitFor(has('Log out'));
      await evaluate(`([...document.querySelectorAll('button, a')].find((el) => el.textContent.trim() === 'Log out')?.click(), true)`);
      return waitFor(`location.pathname === '/'`);
    },
    /** Types a message into the chat and sends it. @param {string} text */
    async answer(text) {
      await fill('#chat-message', text);
      await evaluate(`(document.getElementById('chat-message').form.requestSubmit(), true)`);
    },
    /** The chat's bubbles, as shown. @returns {Promise<string[]>} */
    bubbles: () => evaluate(`[...document.querySelectorAll('.bubble')].map((b) => b.innerText.trim())`),
    /** A phone-screen picture (PNG) of what's showing. @param {string} file */
    async picture(file) {
      writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    },
    async close() {
      socket.close();
      chrome.kill();
      await sleep(800);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
  };
  return page;
}
