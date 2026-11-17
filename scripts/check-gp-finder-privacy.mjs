// Checks the GP finder in a real browser (headless Chrome at phone size, driven over the DevTools
// protocol):
// - "Use my location" in Newcastle finds 10 surgeries with nothing sent at all; in London it loads the
//   all-England list, the same request for everyone; either way the location is in no request,
//   browser storage (local, session, cookies, IndexedDB) or console message;
// - with the location refused, the page says so and puts you in the search box;
// - a full postcode, a district (NE6) and a place with several matches (Heaton, with a "which one?"
//   list) all find surgeries, with phone numbers and emails where the NHS has them; "Show more" shows
//   more; a Scottish postcode gets Scotland's own GP finder;
// - a new search, valid or not, replaces the last result and message.
// The typed searches ask postcodes.io, as the page does.
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
/** Made-up locations with digits that won't turn up by chance: by Newcastle city centre, and in London. */
const NEWCASTLE = { latitude: 54.973861, longitude: -1.613947 };
const LONDON = { latitude: 51.517361, longitude: -0.073947 };
/** How a location could appear if anything leaked it. */
const leaksOf = (/** @type {{ latitude: number, longitude: number }} */ spot) => {
  const lat = String(spot.latitude);
  const lng = String(Math.abs(spot.longitude));
  return [lat, lat.slice(0, 7), lat.slice(0, 6), lng, lng.slice(0, 6), lng.slice(0, 5), lat.replace('.', ''), lng.replace('.', '')];
};

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
/** Opens the page and waits for it to be ready. */
async function open() {
  await page.send('Page.navigate', { url: PAGE_URL });
  assert.ok(await waitForText('Use my location'), 'the page loaded');
  await sleep(1500);
}
/** Types into the search box and submits. @param {string} text */
const typeAndSearch = (text) =>
  run(`(() => { const box = document.querySelector('#search'); box.value = ${JSON.stringify(text)}; box.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form.search').requestSubmit(); })()`);
const practices = () => run(`document.querySelectorAll('.practice').length`);
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

/**
 * Uses "my location" at a made-up spot and returns the requests made after the tap.
 * @param {{ latitude: number, longitude: number }} spot
 */
async function useLocationAt(spot) {
  await browser.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['geolocation'] });
  await page.send('Emulation.setGeolocationOverride', { ...spot, accuracy: 20 });
  await open();
  const from = page.events.length;
  await run(`document.querySelector('button.location').click()`);
  assert.ok(await waitForText('Nearest GP surgeries to you'), 'results appear');
  await sleep(800);
  const after = page.events.slice(from);
  const requests = after.filter((event) => event.method === 'Network.requestWillBeSent').map((event) => event.params.request);
  const headers = after.filter((event) => event.method === 'Network.requestWillBeSentExtraInfo').map((event) => event.params.headers);
  const sent = JSON.stringify([...requests, ...headers]);
  const logged = JSON.stringify(page.events.filter((event) => event.method === 'Runtime.consoleAPICalled' || event.method === 'Log.entryAdded').map((event) => event.params));
  const kept = String(await storage());
  for (const leak of leaksOf(spot)) {
    assert.ok(!sent.includes(leak), `a request holds ${leak}`);
    assert.ok(!logged.includes(leak), `the console holds ${leak}`);
    assert.ok(!kept.includes(leak), `storage holds ${leak}`);
  }
  return requests.map((/** @type {{ url: string }} */ request) => request.url).filter((url) => !url.includes('/@') && !url.includes('/node_modules/') && !url.startsWith('data:'));
}

/** @type {[string, () => Promise<void>][]} */
const checks = [
  ['Use my location in Newcastle: 10 surgeries with phone numbers, nothing sent at all; the location is in no request, storage or console', async () => {
    const urls = await useLocationAt(NEWCASTLE);
    assert.deepEqual(urls, [], 'no request after the tap');
    assert.equal(await practices(), 10);
    assert.ok(await run(`[...document.querySelectorAll('.practice a[href^="tel:"]')].length >= 10`), 'phone numbers');
    assert.ok(await run(`document.querySelectorAll('.practice a[href^="mailto:"]').length > 0`), 'emails where the NHS has them');
    if (shot) {
      const metrics = await page.send('Page.getLayoutMetrics');
      const height = Math.ceil(metrics.result?.cssContentSize?.height ?? 812);
      const png = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 375, height, scale: 1 } });
      writeFileSync(shot, Buffer.from(png.result.data, 'base64'));
    }
  }],
  ['Use my location in London: the all-England list, one request that\'s the same for everyone, and still no location in any request, storage or console', async () => {
    const urls = await useLocationAt(LONDON);
    assert.deepEqual(urls.map((url) => new URL(url).pathname + new URL(url).search), ['/gp/england.tsv']);
    assert.equal(await practices(), 10);
    assert.ok(await waitForText('Each surgery’s NHS page has its email address and website'));
  }],
  ['Location refused: the page says so and puts you in the search box', async () => {
    await browser.send('Browser.setPermission', { origin: ORIGIN, permission: { name: 'geolocation' }, setting: 'denied' });
    await open();
    await run(`document.querySelector('button.location').click()`);
    assert.ok(await waitForText('Your location wasn’t shared, so please type a postcode or place instead.'));
    assert.equal(await run('document.activeElement?.id'), 'search');
    assert.equal(await practices(), 0);
  }],
  ['A full postcode in any case finds 10 surgeries; "Show more" shows 10 more; NHS links use the postcode', async () => {
    await open();
    await typeAndSearch('ne18st');
    assert.ok(await waitForText('Nearest GP surgeries to NE1 8ST'));
    assert.equal(await practices(), 10);
    await run(`document.querySelector('button.more').click()`);
    await sleep(300);
    assert.equal(await practices(), 20);
    const links = await run(`[...document.querySelectorAll('a')].map((a) => a.href)`);
    assert.ok(links.includes('https://www.nhs.uk/service-search/find-a-gp/results?location=NE1%208ST'));
  }],
  ['A district (NE6) finds surgeries', async () => {
    await open();
    await typeAndSearch(' ne 6 ');
    assert.ok(await waitForText('Nearest GP surgeries to NE6'));
    assert.equal(await practices(), 10);
  }],
  ['A place with several matches (Heaton) asks which one, with the county, Newcastle\'s first; choosing finds surgeries', async () => {
    await open();
    await typeAndSearch('heaton');
    assert.ok(await waitForText('Which Heaton?'));
    const choices = await run(`[...document.querySelectorAll('.choices button')].map((b) => b.textContent.trim())`);
    assert.equal(choices[0], 'Heaton, Newcastle upon Tyne');
    assert.ok(choices.includes('Heaton, Bradford'));
    await run(`document.querySelector('.choices button').click()`);
    assert.ok(await waitForText('Nearest GP surgeries to Heaton, Newcastle upon Tyne'));
    assert.equal(await practices(), 10);
  }],
  ['A Scottish postcode gets Scotland\'s own GP finder, not a list', async () => {
    await open();
    await typeAndSearch('EH1 1YZ');
    assert.ok(await waitForText('That’s in Scotland'));
    assert.ok(await run(`[...document.querySelectorAll('a')].some((a) => a.href === 'https://www.nhsinform.scot/scotlands-service-directory/gp-practices/')`));
    assert.equal(await practices(), 0);
  }],
  ['A new search, valid or not, replaces the last result and message', async () => {
    await open();
    await typeAndSearch('SW1A 1AA');
    assert.ok(await waitForText('Nearest GP surgeries to SW1A 1AA'));
    await typeAndSearch('zzqq');
    assert.ok(await waitForText('We couldn’t find a place called “zzqq”'));
    assert.equal(await practices(), 0, 'the old results are gone');
    await typeAndSearch('   ');
    assert.ok(await waitForText('Type a postcode (NE1 8ST)'));
    assert.equal(await run(`document.querySelectorAll('.note').length`), 1, 'only the new message');
    assert.ok(!String(await run('document.body.innerText')).includes('couldn’t find a place called'), 'the old message is gone');
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
