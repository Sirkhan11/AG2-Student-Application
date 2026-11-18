// Checks getting the matching model before Find my mentor needs it (src/lib/matching/model-download.js,
// model-download-browser.js and embed.js), so a student doesn't wait the minute it can take to download.
// Offline, in Node (nothing downloaded, no Firebase):
// - embed.js, with a stand-in for the model library: the background download downloads once and then
//   lets the model go from memory; loading it for matching keeps it; the two at once share one
//   download and keep it; a failure is passed back, and the next call tries afresh;
// - embed.js on a page, with a stand-in worker: the model runs in a module worker, which the
//   background download stops when it's done (letting go of the memory) and matching keeps; a
//   failure is passed back; if the worker can't run, the page runs the model itself;
// - the rules: nothing with data saver on, and nothing in the background once this browser has it;
//   nothing until the page has settled; nothing for a mentor, or a student with a mentor or a request
//   with the coordinator; a failure says nothing and isn't remembered; "Finding your mentor…" has the
//   note about the download only when the model isn't ready;
// - the chat's flow starts loading it when the questions start (not for a mentor, when there are no
//   mentors, or for a student with a match), and says just "Finding your mentor…" once it's ready;
// - the root layout, the Find a mentor page and the chat are wired to it.
// Inside the Auth and Firestore emulators it also runs the app (vite dev --mode emulators) in headless
// Chrome at phone size, with made-up verified students and the real download (about 29 MB from Hugging
// Face and jsDelivr):
// - a student without a mentor downloads it in the background after logging in, once the page has
//   settled, in a worker rather than on the page, and nothing is shown;
// - the next visit in the same browser downloads nothing (the browser kept it), and Find my mentor
//   says just "Finding your mentor…"; matching's numbers come through the worker, and similar phrases
//   come out closer than unrelated ones;
// - with data saver on, nothing downloads, after logging in or on the Find a mentor page, and Find my
//   mentor has the note;
// - a student with a mentor downloads nothing;
// - when the download is blocked, nothing is shown or remembered, and Find my mentor has the note.
// Run from the project folder:
//   node scripts/check-model-download.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-model-download.mjs"
// The second needs Java 21 or newer for the emulators, and Google Chrome (or CHROME=<path to Chrome>).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMentorFlow } from '#lib/checkin/mentor-flow.js';
import { FINDING_MESSAGE, FIRST_TIME_NOTE, findingMessage } from '#lib/matching/find-mentor-steps.js';
import { DOWNLOADED_KEY, downloadInBackground, modelIsReady, readyForMatching, SETTLE_MS } from '#lib/matching/model-download.js';

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
const tick = () => sleep(0);

// ---------- embed.js, with a stand-in for the model library ----------
// pipeline() counts downloads and fails when told to; the model it returns counts being let go.
const fakeLibrary = `
  export async function pipeline() {
    const lib = globalThis.fakeModel;
    lib.downloads++;
    await new Promise((done) => setTimeout(done, 20));
    if (lib.failNext) { lib.failNext = false; throw new Error('model download blocked'); }
    const model = async () => ({ data: new Float32Array([0.6, 0.8]) });
    model.dispose = async () => { lib.letGo++; };
    return model;
  }`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@huggingface/transformers') return { url: `data:text/javascript,${encodeURIComponent(fakeLibrary)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
/** @type {{ downloads: number, letGo: number, failNext: boolean }} */
let fakeModel = { downloads: 0, letGo: 0, failNext: false };
let copies = 0;
/** A fresh copy of embed.js (its own model state), with the stand-in's counts reset. */
async function freshEmbed() {
  fakeModel = { downloads: 0, letGo: 0, failNext: false };
  /** @type {any} */ (globalThis).fakeModel = fakeModel;
  return /** @type {typeof import('../src/lib/matching/embed.js')} */ (await import(`../src/lib/matching/embed.js?copy=${++copies}`));
}

// ---------- embed.js on a page, with a stand-in for its worker ----------
// It answers each call after a moment: as it should, with a failure once, or not at all (it can't run).
class StandInWorker {
  static started = 0;
  static stopped = 0;
  /** @type {string[]} */
  static calls = [];
  /** @type {'works' | 'fails-once' | 'broken'} */
  static mode = 'works';
  /** @type {{ url: string, type: string }[]} */
  static made = [];
  /** @param {URL} url @param {{ type: string }} options */
  constructor(url, options) {
    StandInWorker.started++;
    StandInWorker.made.push({ url: String(url), type: options.type });
    /** @type {((event: any) => void) | null} */
    this.onmessage = null;
    /** @type {((event: any) => void) | null} */
    this.onerror = null;
  }
  /** @param {{ id: number, type: string }} message */
  postMessage(message) {
    StandInWorker.calls.push(message.type);
    setTimeout(() => {
      if (StandInWorker.mode === 'broken') return this.onerror?.({ preventDefault() {} });
      if (StandInWorker.mode === 'fails-once') {
        StandInWorker.mode = 'works';
        return this.onmessage?.({ data: { id: message.id, ok: false, message: 'model download blocked' } });
      }
      this.onmessage?.({ data: { id: message.id, ok: true, vector: message.type === 'embed' ? [0.6, 0.8] : null } });
    }, 10);
  }
  terminate() {
    StandInWorker.stopped++;
  }
}
/**
 * A fresh copy of embed.js that thinks it's on a page (window and Worker are there), with the stand-in
 * worker's counts reset. leavePage() takes the page away again.
 * @param {'works' | 'fails-once' | 'broken'} [mode]
 */
async function pageEmbed(mode = 'works') {
  Object.assign(StandInWorker, { started: 0, stopped: 0, calls: [], made: [], mode });
  Object.assign(globalThis, { window: globalThis, Worker: StandInWorker });
  return freshEmbed();
}
function leavePage() {
  delete (/** @type {any} */ (globalThis)).window;
  delete (/** @type {any} */ (globalThis)).Worker;
}

// ---------- The rules, with made-up surroundings that record what happens, in order ----------
/** @param {{ saveData?: boolean, downloadedBefore?: boolean, mightMatch?: boolean, fails?: string }} [setup] */
function surroundings({ saveData = false, downloadedBefore = false, mightMatch = true, fails = '' } = {}) {
  /** @type {string[]} */
  const log = [];
  /** @param {string} name @param {any} [result] */
  const step = (name, result) => async () => {
    log.push(name);
    if (fails === name) throw new Error(`${name} failed`);
    return result;
  };
  return {
    log,
    env: { saveData, downloadedBefore, settled: step('settled'), mightMatch: step('read their record', mightMatch), download: step('download'), load: step('load'), remember: () => void log.push('remember') }
  };
}

// ---------- The chat's flow, with made-up matching steps ----------
const ANSWERS = ['Settling in', 'Climbing and films', 'A long walk', 'Planning ahead, with others', 'Making friends', 'Someone patient'];
/** @param {{ before?: any, ready?: boolean }} [setup] */
function flowWith({ before = { view: 'form' }, ready } = {}) {
  /** @type {any[]} */
  const posts = [];
  let gotReady = 0;
  /** @type {import('#lib/matching/find-mentor-steps.js').MatchingSteps} */
  const steps = {
    prepareStudent: async (answers) => ({ answers }),
    matchAndSave: async () => ({ outcome: 'matched', mentorName: 'Alex', reasons: ['You share interests: climbing'] }),
    askCoordinator: async () => ({ outcome: 'coordinator' }),
    getReady: () => void gotReady++,
    ...(ready === undefined ? {} : { modelReady: () => ready })
  };
  const flow = createMentorFlow({ check: async () => before, steps, post: (message) => posts.push(message), changed: () => {}, finished: () => {} });
  return { flow, posts, gotReady: () => gotReady };
}
/** Answers everything and taps Find my mentor. @param {ReturnType<typeof flowWith>} t */
async function toFindMyMentor(t) {
  t.flow.start();
  await tick();
  for (const answer of ANSWERS) t.flow.reply(answer);
  t.flow.choose('weekly');
  t.flow.reply('Evenings');
  await t.flow.confirm();
}

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  // ---------- embed.js ----------
  ['The background download downloads the model once, then lets it go from memory; matching later loads it again (from the browser’s cache) and keeps it', async () => {
    const model = await freshEmbed();
    await model.downloadModel();
    assert.deepEqual([fakeModel.downloads, fakeModel.letGo, model.modelLoaded()], [1, 1, false]);
    await model.embed('walks by the sea');
    assert.deepEqual([fakeModel.downloads, fakeModel.letGo, model.modelLoaded()], [2, 1, true]);
  }],
  ['Loading it when the questions start keeps it, and matching then uses it without loading it again', async () => {
    const model = await freshEmbed();
    await model.loadModel();
    assert.equal(model.modelLoaded(), true);
    await model.embed('films');
    assert.deepEqual([fakeModel.downloads, fakeModel.letGo], [1, 0]);
  }],
  ['The background download and matching at the same time share one download, and the model stays loaded', async () => {
    let model = await freshEmbed();
    await Promise.all([model.downloadModel(), model.embed('climbing')]);
    assert.deepEqual([fakeModel.downloads, fakeModel.letGo, model.modelLoaded()], [1, 0, true]);
    model = await freshEmbed();
    await Promise.all([model.downloadModel(), model.loadModel()]);
    assert.deepEqual([fakeModel.downloads, fakeModel.letGo, model.modelLoaded()], [1, 0, true], 'the questions started during it');
  }],
  ['A failed download is passed back (the background download ignores it), and the next call tries afresh', async () => {
    const model = await freshEmbed();
    fakeModel.failNext = true;
    await assert.rejects(model.downloadModel(), /blocked/);
    assert.equal(model.modelLoaded(), false);
    await model.embed('music');
    assert.deepEqual([fakeModel.downloads, model.modelLoaded()], [2, true]);
  }],

  // ---------- embed.js on a page ----------
  ['On a page, the model runs in a module worker (embed.worker.js); the background download stops it when done, letting go of the model’s memory', async () => {
    const model = await pageEmbed();
    await model.downloadModel();
    assert.deepEqual([StandInWorker.started, StandInWorker.calls, StandInWorker.stopped, model.modelLoaded()], [1, ['download'], 1, false]);
    assert.match(StandInWorker.made[0].url, /\/embed\.worker\.js$/);
    assert.equal(StandInWorker.made[0].type, 'module');
    assert.equal(fakeModel.downloads, 0, 'nothing loaded on the page itself');
    leavePage();
  }],
  ['On a page, starting the questions or matching keeps the worker, and every call goes to that one worker', async () => {
    const model = await pageEmbed();
    await model.loadModel();
    assert.deepEqual(await model.embed('films'), [0.6, 0.8]);
    assert.deepEqual([StandInWorker.started, StandInWorker.calls, StandInWorker.stopped, model.modelLoaded()], [1, ['load', 'embed'], 0, true]);
    leavePage();
  }],
  ['On a page, the background download and matching at the same time: the worker stays', async () => {
    const model = await pageEmbed();
    await Promise.all([model.downloadModel(), model.embed('climbing')]);
    assert.deepEqual([StandInWorker.started, StandInWorker.stopped, model.modelLoaded()], [1, 0, true]);
    leavePage();
  }],
  ['On a page, a failure in the worker is passed back, and the next call tries again in the same worker', async () => {
    const model = await pageEmbed('fails-once');
    await assert.rejects(model.loadModel(), /blocked/);
    await model.loadModel();
    assert.deepEqual([StandInWorker.started, StandInWorker.calls, model.modelLoaded()], [1, ['load', 'load'], true]);
    leavePage();
  }],
  ['If the worker can’t run, the page runs the model itself: the call that was waiting, and every one after', async () => {
    const model = await pageEmbed('broken');
    const vector = await model.embed('music');
    assert.equal(vector.length, 2, 'from the model on the page');
    await model.embed('walks');
    assert.deepEqual([StandInWorker.started, fakeModel.downloads, model.modelLoaded()], [1, 1, true], 'no second worker; loaded on the page once');
    leavePage();
  }],

  // ---------- The rules ----------
  ['With data saver on: no background download and no loading for matching, without even waiting or reading their record', async () => {
    const background = surroundings({ saveData: true });
    assert.equal(await downloadInBackground(background.env), 'data-saver');
    const matching = surroundings({ saveData: true });
    assert.equal(await readyForMatching(matching.env), 'data-saver');
    assert.deepEqual([...background.log, ...matching.log], []);
  }],
  ['Once this browser has it, there’s no background download again, but starting the questions still loads it', async () => {
    const background = surroundings({ downloadedBefore: true });
    assert.equal(await downloadInBackground(background.env), 'downloaded-before');
    assert.deepEqual(background.log, []);
    const matching = surroundings({ downloadedBefore: true });
    assert.equal(await readyForMatching(matching.env), 'loaded');
    assert.deepEqual(matching.log, ['settled', 'load', 'remember']);
  }],
  ['A student without a mentor: it waits for the page to settle, then reads their record, downloads, and remembers', async () => {
    const { env, log } = surroundings();
    assert.equal(await downloadInBackground(env), 'downloaded');
    assert.deepEqual(log, ['settled', 'read their record', 'download', 'remember']);
    assert.ok(SETTLE_MS >= 2000, 'the page has a few seconds first');
  }],
  ['A mentor, or a student with a mentor or a request with the coordinator: nothing is downloaded', async () => {
    const { env, log } = surroundings({ mightMatch: false });
    assert.equal(await downloadInBackground(env), 'has-mentor');
    assert.deepEqual(log, ['settled', 'read their record']);
  }],
  ['A failure (the download, or reading their record) says nothing and isn’t remembered, so Find my mentor downloads it instead', async () => {
    for (const fails of ['download', 'read their record']) {
      const { env, log } = surroundings({ fails });
      assert.equal(await downloadInBackground(env), 'failed', `${fails}: resolves quietly, nothing thrown`);
      assert.ok(!log.includes('remember'), fails);
    }
    const { env, log } = surroundings({ fails: 'load' });
    assert.equal(await readyForMatching(env), 'failed');
    assert.ok(!log.includes('remember'));
  }],
  ['"Finding your mentor…" has the note about the download only when the model isn’t ready (loaded, or this browser has it)', () => {
    assert.equal(findingMessage(true), 'Finding your mentor…');
    assert.equal(findingMessage(false), 'Finding your mentor… The first time, this can take a minute while the matching model downloads.');
    assert.equal(modelIsReady({ loaded: true, downloadedBefore: false }), true);
    assert.equal(modelIsReady({ loaded: false, downloadedBefore: true }), true);
    assert.equal(modelIsReady({ loaded: false, downloadedBefore: false }), false);
  }],

  // ---------- The chat's flow ----------
  ['In the chat, the model starts loading when the questions start, after the checks; not for a mentor, when there are no mentors, or for a student with a match', async () => {
    const t = flowWith();
    t.flow.start();
    assert.equal(t.gotReady(), 0, 'not before the checks');
    await tick();
    assert.equal(t.gotReady(), 1);
    for (const before of [{ view: 'is-mentor' }, { view: 'no-mentors' }, { view: 'has-record', match: { status: 'coordinator', meetingFrequency: null, availability: null } }]) {
      const other = flowWith({ before });
      other.flow.start();
      await tick();
      assert.equal(other.gotReady(), 0, before.view);
    }
  }],
  ['In the chat, Find my mentor says just "Finding your mentor…" once the model is ready, and adds the note when it isn’t', async () => {
    const ready = flowWith({ ready: true });
    await toFindMyMentor(ready);
    assert.ok(ready.posts.some((post) => post.text === FINDING_MESSAGE));
    assert.ok(!ready.posts.some((post) => post.text.includes(FIRST_TIME_NOTE)));
    for (const t of [flowWith({ ready: false }), flowWith()]) {
      await toFindMyMentor(t);
      assert.ok(t.posts.some((post) => post.text === findingMessage(false)), 'with the note');
    }
  }],

  // ---------- Wiring ----------
  ['The root layout starts the background download for a verified Northumbria account, loading its code only then', () => {
    const layout = source('src/routes/+layout.svelte');
    assert.match(layout, /account\?\.verified && isUniEmail\(account\.email\) \? account\.uid : null/);
    assert.match(layout, /import\('#lib\/matching\/model-download-browser\.js'\)\.then\(\(model\) => model\.downloadAfterLogin\(uid\)/);
    assert.doesNotMatch(layout, /^\s*import .*model-download-browser/m, 'not loaded with every page');
  }],
  ['The Find a mentor page and the chat load it when the questions start, and say whether it’s ready while finding', () => {
    const page = source('src/routes/find-mentor/+page.svelte');
    assert.match(page, /if \(state\.view === 'form'\) getReadyForMatching\(\);/);
    assert.match(page, /busyMessage = findingMessage\(modelReady\(\)\);/);
    const chat = source('src/routes/check-in/+page.svelte');
    assert.match(chat, /getReady: getReadyForMatching,\s*modelReady\s*\}/);
  }],
  ['In the browser: data saver from the browser, the page settled (loaded, a few seconds, then idle), and this browser remembering it', () => {
    const browser = source('src/lib/matching/model-download-browser.js');
    assert.match(browser, /connection\?\.saveData === true/);
    assert.match(browser, /requestIdleCallback/);
    assert.match(browser, /setTimeout\(idle, SETTLE_MS\)/);
    assert.match(browser, /localStorage\.setItem\(DOWNLOADED_KEY, MATCHING_MODEL\)/);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
let total = checks.length;

// ---------- In the browser, against the emulators ----------
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
if (AUTH && FIRESTORE) {
  const results = await inTheBrowser(AUTH, FIRESTORE, process.env.GCLOUD_PROJECT ?? 'demo-ag2');
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-model-download.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * The browser checks. Returns each one's result.
 * @param {string} AUTH @param {string} FIRESTORE @param {string} PROJECT
 * @returns {Promise<boolean[]>}
 */
async function inTheBrowser(AUTH, FIRESTORE, PROJECT) {
  const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  /** The model, its runtime and its tokenizer come from these. */
  const MODEL_HOSTS = /^https:\/\/([^/]+\.)?(huggingface\.co|hf\.co|jsdelivr\.net)\//;
  /** @type {boolean[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const report = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  /** @returns {Promise<number>} */
  const freePort = () =>
    new Promise((done, fail) => {
      const probe = createServer();
      probe.on('error', fail);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
        probe.close(() => done(port));
      });
    });

  // Made-up verified students: four without a mentor (one has a match), and a mentor with a free place,
  // so the Find a mentor page shows its questions.
  /** @param {string} email @param {string} password @returns {Promise<string>} */
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
  /** @param {unknown} value @returns {any} */
  const asValue = (value) =>
    typeof value === 'boolean' ? { booleanValue: value }
      : Number.isInteger(value) ? { integerValue: String(value) }
        : typeof value === 'number' ? { doubleValue: value }
        : Array.isArray(value) ? { arrayValue: { values: value.map(asValue) } }
          : value && typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, v]) => [key, asValue(v)])) } }
            : { stringValue: String(value) };
  /** @param {string} path @param {Record<string, unknown>} fields */
  async function seed(path, fields) {
    const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
      method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: asValue(fields).mapValue.fields })
    });
    assert.ok(response.ok, `seeding ${path}`);
  }
  const password = randomBytes(18).toString('base64url');
  /** @type {Record<string, { email: string, password: string, uid: string }>} */
  const people = {};
  for (const [name, course] of [['Ada', 'BSc Law'], ['Bea', 'BSc Nursing'], ['Cal', 'BA History'], ['Dee', 'BSc Physics']]) {
    const email = `${name.toLowerCase()}.model@northumbria.ac.uk`;
    const uid = await verifiedStudent(email, password);
    await seed(`students/${uid}`, { name: `${name} Student`, course, email, arrivalDate: '', role: 'student' });
    people[name] = { email, password, uid };
  }
  await seed(`matches/${people.Cal.uid}`, { status: 'matched', mentorId: 'mentor-alex', mentorName: 'Alex', reasons: ['You share interests: films'], meetingFrequency: 'weekly', availability: 'Evenings' });
  await seed('mentors/mentor-alex', { displayName: 'Alex', approved: true, maxStudents: 3, studentCount: 1, itemVectors: { q1: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)), q2: [], q3: [], q4: [], q5: [], q6: [] } });

  // The app, in its emulators mode.
  const appPort = await freePort();
  const BASE = `http://127.0.0.1:${appPort}`;
  const app = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--mode', 'emulators', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { stdio: 'ignore' });
  for (let tries = 0; ; tries++) {
    if (app.exitCode !== null || tries > 120) throw new Error('the app didn’t start');
    if (await fetch(`${BASE}/`).then((response) => response.ok, () => false)) break;
    await sleep(500);
  }

  /**
   * Opens headless Chrome at phone size with this profile (a folder: the same one is the same browser,
   * as on a later visit), watching every request for the model.
   * @param {string} profile @param {{ dataSaver?: boolean, block?: boolean }} [options]
   */
  async function openChrome(profile, { dataSaver = false, block = false } = {}) {
    const port = await freePort();
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
    browsers.push(chrome);
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
    /**
     * Requests for the model, from the page or its worker: when, how big, whether they were blocked,
     * and which made them. @type {Map<string, { at: number, bytes: number, blocked: boolean, from: 'page' | 'worker' }>}
     */
    const model = new Map();
    /** @param {string} method @param {object} [params] @param {string} [sessionId] a worker's, or the page's if left out @returns {Promise<any>} */
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, (/** @type {any} */ m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
        socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    const BLOCKED = { urls: ['*huggingface.co/*', '*.hf.co/*', '*cdn.jsdelivr.net/*'] };
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const p = message.params;
      const key = `${message.sessionId ?? 'page'}:${p?.requestId}`;
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method === 'Target.attachedToTarget') {
        // The model's worker (or any other): watch its requests too, block them if the page's are,
        // then let it start.
        const worker = p.sessionId;
        void (async () => {
          await send('Network.enable', {}, worker).catch(() => {});
          if (block) await send('Network.setBlockedURLs', BLOCKED, worker).catch(() => {});
          await send('Runtime.runIfWaitingForDebugger', {}, worker).catch(() => {});
        })();
      } else if (message.method === 'Network.requestWillBeSent' && MODEL_HOSTS.test(p.request.url) && !model.has(key)) {
        model.set(key, { at: Date.now(), bytes: 0, blocked: false, from: message.sessionId ? 'worker' : 'page', url: p.request.url, cache: p.request.headers?.['Cache-Control'] ?? '' });
      } else if (message.method === 'Network.loadingFinished' && model.has(key)) {
        /** @type {any} */ (model.get(key)).bytes = p.encodedDataLength;
      } else if (message.method === 'Network.loadingFailed' && model.has(key)) {
        /** @type {any} */ (model.get(key)).blocked = Boolean(p.blockedReason);
      }
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    if (dataSaver) await send('Emulation.setDataSaverOverride', { dataSaverEnabled: true });
    if (block) await send('Network.setBlockedURLs', BLOCKED);
    /** @param {string} expression @returns {Promise<any>} */
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    /** @param {string} expression @param {number} [ms] */
    const waitFor = async (expression, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
        if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
      }
      return false;
    };
    /** @param {string} words */
    const has = (words) => `document.body.innerText.includes(${JSON.stringify(words)})`;
    /** Where the page is and what it says, for a failure's details. */
    const where = () => evaluate(`location.pathname + ' | ' + (document.querySelector('main h1, h1')?.textContent.trim() ?? '') + ' | ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160)`).catch((err) => String(err));
    /** @param {string} path */
    const go = async (path) => {
      await send('Page.navigate', { url: BASE + path });
      await waitFor(`document.readyState === 'complete'`);
      // vite dev hydrates a moment after the page has loaded: a click before then is lost.
      await sleep(1500);
    };
    /** Types a value the way a person does, so Svelte sees it. @param {string} selector @param {string} value */
    const fill = (selector, value) =>
      evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    return {
      evaluate, waitFor, has, go,
      /** Every request for the model so far. */
      modelRequests: () => [...model.values()],
      /** Logs in from the log-in page; returns when they did. @param {{ email: string, password: string }} who */
      async logIn(who) {
        await go('/');
        await waitFor(has('Welcome back'));
        await fill('#email', who.email);
        await fill('#password', who.password);
        await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
        const at = Date.now();
        if (!(await waitFor(`location.pathname === '/home' && /^Hi /.test(document.querySelector('main h1')?.textContent.trim() ?? '')`))) {
          throw new Error(`logging in didn’t reach Home: ${await where()}`);
        }
        return at;
      },
      async logOut() {
        await go('/home');
        await waitFor(has('Log out'));
        await evaluate(`([...document.querySelectorAll('button, a')].find((el) => el.textContent.trim() === 'Log out')?.click(), true)`);
        await waitFor(`location.pathname === '/'`);
      },
      /** Whether this browser has remembered downloading the model. */
      remembered: () => evaluate(`localStorage.getItem(${JSON.stringify(DOWNLOADED_KEY)}) !== null`),
      /** Opens the Find a mentor page, answers its questions and presses Find my mentor; returns every status message shown. */
      async findMyMentor() {
        await go('/find-mentor');
        if (!(await waitFor(`document.querySelector('#q6')`, 30000))) return [`no questions: ${await where()}`];
        await sleep(SETTLE_MS + 3000);
        await evaluate(`(() => {
          window.__statuses = [];
          new MutationObserver(() => {
            for (const el of document.querySelectorAll('[role=status]')) {
              const text = el.textContent.trim();
              if (text && !window.__statuses.includes(text)) window.__statuses.push(text);
            }
          }).observe(document.body, { subtree: true, childList: true, characterData: true });
          return true;
        })()`);
        for (let q = 1; q <= 6; q++) await fill(`#q${q}`, `Answer ${q}`);
        await fill('#availability', 'Evenings');
        await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
        await waitFor('window.__statuses.length > 0', 15000);
        return /** @type {string[]} */ (await evaluate('window.__statuses'));
      },
      async close() {
        socket.close();
        const exited = new Promise((done) => chrome.once('exit', done));
        chrome.kill();
        await Promise.race([exited, sleep(5000)]);
        await sleep(500);
      }
    };
  }

  /** @type {string[]} */
  const profiles = [];
  /** Every Chrome opened, so a failure part-way still closes them. @type {import('node:child_process').ChildProcess[]} */
  const browsers = [];
  const newProfile = () => {
    const folder = mkdtempSync(join(tmpdir(), 'ag2-model-'));
    profiles.push(folder);
    return folder;
  };
  /** @param {{ bytes: number }[]} requests */
  const megabytes = (requests) => `${(requests.reduce((total, r) => total + r.bytes, 0) / 1e6).toFixed(1)} MB`;
  /** Text that would tell the student about the download. */
  const SAYS_ANYTHING = `/model|download/i.test(document.body.innerText) || document.querySelector('[role=alert]') !== null`;

  try {
    // 1. Ada, without a mentor: the background download after logging in.
    const adaProfile = newProfile();
    let chrome = await openChrome(adaProfile);
    const loggedInAt = await chrome.logIn(people.Ada);
    const kept = await chrome.waitFor(`localStorage.getItem(${JSON.stringify(DOWNLOADED_KEY)}) !== null`, 240000);
    const first = chrome.modelRequests()[0];
    const startedAfter = first ? first.at - loggedInAt : -1;
    const quiet = !(await chrome.evaluate(SAYS_ANYTHING));
    const inWorker = chrome.modelRequests().length > 0 && chrome.modelRequests().every((r) => r.from === 'worker');
    report('A student without a mentor: the model downloads in the background after logging in, once the page has settled, in a worker (not on the page), and nothing is shown',
      kept && startedAfter >= SETTLE_MS && inWorker && quiet, `started ${startedAfter} ms after logging in; ${megabytes(chrome.modelRequests())} from Hugging Face and jsDelivr; in a worker: ${inWorker}`);
    await chrome.close();

    // 2. Ada's next visit, in the same browser.
    chrome = await openChrome(adaProfile);
    const statuses = await chrome.findMyMentor();
    report('The next visit in the same browser downloads nothing (the browser kept it), and Find my mentor says just "Finding your mentor…"',
      chrome.modelRequests().length === 0 && statuses.includes(FINDING_MESSAGE) && !statuses.some((text) => text.includes(FIRST_TIME_NOTE)),
      `${chrome.modelRequests().length} model requests${chrome.modelRequests().length ? ` (${chrome.modelRequests().map((r) => /** @type {any} */ (r).url.replace(/^https:\/\//, '').slice(0, 120)).join(', ')})` : ''}; said ${JSON.stringify(statuses)}`);
    // What matching uses: the page's embed.js, so the worker, with the model the browser kept.
    const similar = await chrome.evaluate(`import('/src/lib/matching/embed.js').then(async ({ embed }) => {
      const [gigs, music, tax] = await Promise.all([embed('going to gigs'), embed('live music'), embed('filing tax returns')]);
      const dot = (a, b) => a.reduce((total, x, i) => total + x * b[i], 0);
      return { size: gigs.length, length: Math.sqrt(dot(gigs, gigs)), music: dot(gigs, music), tax: dot(gigs, tax) };
    })`).catch((err) => ({ error: String(err) }));
    report('Matching turns phrases into numbers through the worker: 384 each, and similar phrases come out closer than unrelated ones',
      similar.size === 384 && Math.abs(similar.length - 1) < 1e-3 && similar.music > similar.tax,
      similar.error ?? `"going to gigs" is ${similar.music?.toFixed(2)} like "live music" and ${similar.tax?.toFixed(2)} like "filing tax returns"`);
    await chrome.close();

    // 3. Bea, with data saver on.
    const beaProfile = newProfile();
    chrome = await openChrome(beaProfile, { dataSaver: true });
    await chrome.logIn(people.Bea);
    await sleep(SETTLE_MS + 6000);
    const afterLogIn = chrome.modelRequests().length;
    const saverStatuses = await chrome.findMyMentor();
    report('With data saver on, nothing downloads after logging in or on the Find a mentor page, and Find my mentor has the note',
      afterLogIn === 0 && chrome.modelRequests().length === 0 && saverStatuses.includes(findingMessage(false)) && !(await chrome.remembered()),
      `${afterLogIn} after logging in, ${chrome.modelRequests().length} in all; said ${JSON.stringify(saverStatuses)}`);
    await chrome.logOut();
    await chrome.close();

    // 4. Cal, who has a mentor, in a browser that hasn't downloaded it.
    chrome = await openChrome(beaProfile);
    await chrome.logIn(people.Cal);
    await sleep(SETTLE_MS + 6000);
    report('A student with a mentor: nothing downloads', chrome.modelRequests().length === 0 && !(await chrome.remembered()), `${chrome.modelRequests().length} model requests`);
    await chrome.close();

    // 5. Dee, with the download blocked.
    chrome = await openChrome(newProfile(), { block: true });
    await chrome.logIn(people.Dee);
    let tried = false;
    for (const end = Date.now() + SETTLE_MS + 15000; !tried && Date.now() < end; await sleep(250)) tried = chrome.modelRequests().some((r) => r.blocked);
    await sleep(1500);
    const quietHome = !(await chrome.evaluate(SAYS_ANYTHING)) && (await chrome.evaluate(`location.pathname === '/home'`));
    const remembered = await chrome.remembered();
    const blockedStatuses = await chrome.findMyMentor();
    report('When the download is blocked: nothing is shown or remembered, and Find my mentor has the note (it downloads then instead)',
      tried && quietHome && !remembered && blockedStatuses.includes(findingMessage(false)),
      `tried ${tried}, quiet ${quietHome}, remembered ${remembered}; said ${JSON.stringify(blockedStatuses)}`);
    await chrome.close();
  } finally {
    app.kill();
    for (const browser of browsers) if (browser.exitCode === null) browser.kill();
    await sleep(1000);
    for (const folder of profiles) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  return results;
}
