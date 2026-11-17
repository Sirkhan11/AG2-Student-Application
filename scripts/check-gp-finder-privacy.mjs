// Checks the GP finder in a real browser (headless Chrome at phone size, driven over the DevTools
// protocol): "Use my location" with a made-up location finds 5 surgeries, and the location never
// appears in any network request, browser storage (local, session, cookies, IndexedDB) or the
// console; with the location refused, the page says so and puts you in the postcode box; a Newcastle
// postcode finds 5 surgeries; a London postcode gets the NHS Find a GP link instead.
// The postcode searches ask postcodes.io (2 requests), as the page does for a typed postcode.
//
// Start the app first (npm run dev), then, from the project folder:
//   node scripts/check-gp-finder-privacy.mjs http://localhost:5173 [screenshot.png]
// Uses Google Chrome from its usual place on a Mac, or CHROME=<path to Chrome>.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, shot] = process.argv.slice(2);
if (!base) {
  console.log('Give the app\'s address: node scripts/check-gp-finder-privacy.mjs http://localhost:5173 [screenshot.png]');
  process.exit(2);
}
const PAGE_URL = new URL('/gp-finder', base).href;
const ORIGIN = new URL(base).origin;
/** A made-up location by the city centre, with digits that won't turn up by chance. */
const SPOT = { latitude: 54.973861, longitude: -1.613947 };
/** How the location could appear if anything leaked it. */
const LEAKS = ['54.973861', '54.97386', '54.9739', '1.613947', '1.61394', '1.6139', '54973861', '1613947'];

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), 'gp-finder-check-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/** @type {any} */
let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  } catch {
    await sleep(200);
  }
}
const browserInfo = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();

/** A DevTools connection: send(method, params) and every event in `events`. @param {string} url */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((done) => ws.addEventListener('open', done, { once: true }));
  let nextId = 1;
  const waiting = new Map();
  /** @type {{ method: string, params: any }[]} */
  const events = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else if (message.method) events.push(message);
  });
  /** @param {string} method @param {object} [params] @returns {Promise<any>} */
  const send = (method, params = {}) =>
    new Promise((done) => {
      const id = nextId++;
      waiting.set(id, done);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send, events };
}

const page = await connect(target.webSocketDebuggerUrl);
const browser = await connect(browserInfo.webSocketDebuggerUrl);
await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
for (const domain of ['Page', 'Network', 'Runtime', 'Log']) await page.send(`${domain}.enable`);

/** @param {string} expression @returns {Promise<any>} */
const run = async (expression) => (await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
/** Waits up to 20 seconds for the text to be on the page. @param {string} text */
async function waitForText(text) {
  for (let started = Date.now(); Date.now() - started < 20_000; await sleep(250)) {
    if (String(await run('document.body.innerText')).includes(text)) return true;
  }
  return false;
}
/** Opens the page and waits for it to be ready (the button works once the page has loaded its code). */
async function open() {
  await page.send('Page.navigate', { url: PAGE_URL });
  assert.ok(await waitForText('Use my location'), 'the page loaded');
  await sleep(1500);
}
/** Everything the page has stored: local and session storage, cookies and IndexedDB. */
const storage = () =>
  run(`(async () => {
    const parts = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
    for (const info of (await indexedDB.databases?.()) ?? []) {
      const db = await new Promise((done, fail) => { const r = indexedDB.open(info.name); r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });
      for (const name of db.objectStoreNames) {
        parts.push(info.name + '/' + name + ':' + JSON.stringify(await new Promise((done) => { const r = db.transaction(name, 'readonly').objectStore(name).getAll(); r.onsuccess = () => done(r.result); r.onerror = () => done([]); })));
      }
      db.close();
    }
    return parts.join('\\n');
  })()`);

/** @type {[string, () => Promise<void>][]} */
const checks = [
  ['Use my location: 5 surgeries, worked out on the phone; the location is in no request, storage or console message', async () => {
    await browser.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] });
    await page.send('Emulation.setGeolocationOverride', { ...SPOT, accuracy: 20 });
    await open();
    const from = page.events.length;
    await run(`document.querySelector('button.location').click()`);
    assert.ok(await waitForText('Nearest GP surgeries'), 'results appear');
    assert.equal(await run(`document.querySelectorAll('.practice').length`), 5);
    const first = String(await run(`document.querySelector('.practice')?.innerText`));
    assert.match(first, /\d+ m away|\d\.\d km away/);
    await sleep(1000);
    const after = page.events.slice(from);
    const requests = after.filter((event) => event.method === 'Network.requestWillBeSent');
    const extra = after.filter((event) => event.method === 'Network.requestWillBeSentExtraInfo');
    const outside = requests.map((event) => event.params.request.url).filter((url) => !url.startsWith(ORIGIN));
    assert.deepEqual(outside, [], 'nothing goes to another site after "Use my location"');
    const sent = JSON.stringify([...requests.map((event) => event.params.request), ...extra.map((event) => event.params.headers)]);
    const logged = JSON.stringify(page.events.filter((event) => event.method === 'Runtime.consoleAPICalled' || event.method === 'Log.entryAdded').map((event) => event.params));
    const kept = String(await storage());
    for (const leak of LEAKS) {
      assert.ok(!sent.includes(leak), `a request holds ${leak}`);
      assert.ok(!logged.includes(leak), `the console holds ${leak}`);
      assert.ok(!kept.includes(leak), `storage holds ${leak}`);
    }
    console.log(`      (${requests.length} requests after the click, all to the app itself; storage and console clean)`);
    if (shot) {
      const metrics = await page.send('Page.getLayoutMetrics');
      const height = Math.ceil(metrics.result?.cssContentSize?.height ?? 812);
      const png = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 375, height, scale: 1 } });
      writeFileSync(shot, Buffer.from(png.result.data, 'base64'));
    }
  }],
  ['Location refused: the page says so and puts you in the postcode box', async () => {
    await browser.send('Browser.setPermission', { origin: ORIGIN, permission: { name: 'geolocation' }, setting: 'denied' });
    await open();
    await run(`document.querySelector('button.location').click()`);
    assert.ok(await waitForText('Your location wasn’t shared, so please type your postcode instead.'));
    assert.equal(await run('document.activeElement?.id'), 'postcode');
    assert.equal(await run(`document.querySelectorAll('.practice').length`), 0);
  }],
  ['A Newcastle postcode finds 5 surgeries, with NHS links for that postcode', async () => {
    await open();
    await run(`(() => { const box = document.querySelector('#postcode'); box.value = 'ne1 8st'; box.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form.search').requestSubmit(); })()`);
    assert.ok(await waitForText('Nearest GP surgeries'));
    assert.equal(await run(`document.querySelectorAll('.practice').length`), 5);
    const links = await run(`[...document.querySelectorAll('a')].map((a) => a.href).filter((href) => href.includes('nhs.uk'))`);
    assert.ok(links.some((/** @type {string} */ href) => /\/services\/gp-surgery\/[a-z0-9-]+\/[A-Z]\d{5}$/.test(href)), 'surgery pages');
    assert.ok(links.includes('https://www.nhs.uk/service-search/find-a-gp/results?location=NE1%208ST'));
    assert.ok(links.includes('https://www.nhs.uk/service-search/find-a-dentist/results?location=NE1%208ST'));
  }],
  ['A London postcode is outside the list, so it gets NHS Find a GP instead', async () => {
    await open();
    await run(`(() => { const box = document.querySelector('#postcode'); box.value = 'SW1A 1AA'; box.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form.search').requestSubmit(); })()`);
    assert.ok(await waitForText('outside our list'));
    assert.equal(await run(`document.querySelectorAll('.practice').length`), 0);
    assert.ok(await run(`[...document.querySelectorAll('a')].some((a) => a.href === 'https://www.nhs.uk/service-search/find-a-gp/results?location=SW1A%201AA')`));
  }]
];

let failed = 0;
try {
  for (const [name, check] of checks) {
    try {
      await check();
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
    }
  }
} finally {
  page.ws.close();
  browser.ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
