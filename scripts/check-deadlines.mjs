// Checks deadlines from Blackboard's calendar link: the private link a student pastes, the app's one
// function (functions/) that fetches the calendar at it, and what the app shows and keeps.
// Offline (always): the link's shape and its near-misses; the calendar reader on made-up files
// (London time on both sides of a clock change, folded lines, escaped commas, a year of past items,
// an empty file, something that isn't a calendar, something far too big); the function's read with a
// stand-in fetch (no redirects, a time limit, a size limit, only a calendar, the pretend Blackboard
// honoured in the emulator only); the gate (the rules' own: unauthenticated, unverified, an outside
// address with the switch on or off, the test accounts); what's kept on the phone and where; the
// words; and that the chat can't reach any of it and nothing logs the link.
// In the emulators (with the Functions emulator running): the function refuses a signed-out caller,
// a call without App Check, an unverified account and an outside address with the switch on, lets
// the outside address in with it off, refuses every other shape of link, and reads only from the
// pretend Blackboard this check starts (functions/.env.demo-ag2), which sees one request with the
// link's path and nothing else; a redirect isn't followed; a slow, missing, wrong or huge answer gets
// the right refusal; and no answer carries the link.
// In Chrome (same run): a student connects, sees her deadlines on the page, Home and the checklist,
// forgets the link and they're gone, connects again and logs out and they're gone; the link is in no
// request but the one to the function, in no Firestore write, in no console message, and in storage
// only under ag2.deadlines.<uid>.
// Run from the project folder (npm --prefix functions install once first for the emulator part):
//   node scripts/check-deadlines.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore,functions --project demo-ag2 "node scripts/check-deadlines.mjs [--pictures <folder>]"
// With --pictures, phone-size pictures of the page before and after connecting, and of Home, go in that folder.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { accessProblem, isNorthumbriaAddress, TEST_ACCOUNT_UIDS } from '../functions/shared/access-gate.js';
import { deadlinesFrom, FeedError, instantFrom, looksLikeCalendar, MAX_DEADLINES, MAX_FEED_BYTES, PAST_DAYS, shortId, zonedToUtc } from '../functions/shared/calendar-feed.js';
import { CALENDAR_LINK_PREFIX, CALENDAR_LINK_SUFFIX, calendarLinkFrom, calendarLinkId, calendarLinkProblem, isCalendarLink } from '../functions/shared/calendar-link.js';
import { fetchAddress, FETCH_TIMEOUT_MS, ReadError, readDeadlinesFor } from '../functions/lib/read-deadlines.js';
import { icsFor } from '#lib/calendar/ics.js';
import { calendarEntryFor, comingDeadlines, dueWords, readAgo, splitDeadlines } from '#lib/deadlines/show.js';
import { forgetAllDeadlines, forgetDeadlines, keepDeadlines, keepLink, KEY_PREFIX, keyFor, readKept } from '#lib/deadlines/store.js';
import { isUniEmail } from '#lib/uni-email.js';
import { CHECKLIST_DONE, emulatorHosts, emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';

/** A made-up link: the shape is Blackboard's; the id is nobody's. @param {string} seed */
const linkWith = (seed) => `${CALENDAR_LINK_PREFIX}${seed.padEnd(32, '0').slice(0, 32)}${CALENDAR_LINK_SUFFIX}`;
const GOOD = linkWith('0a1b2c3d4e5f60718293a4b5c6d7e8f9');
const GOOD_ID = /** @type {string} */ (calendarLinkId(GOOD));
const NOW = Date.parse('2026-11-18T12:00:00Z');
const DAY = 86_400_000;

/**
 * A calendar file as Blackboard writes one, from items of { title, start, uid } (start as Blackboard
 * gives it, with its parameters), folded as the format asks.
 * @param {{ title: string, start: string, uid?: string }[]} items
 */
function calendarFile(items) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blackboard//EN', 'METHOD:PUBLISH', 'X-PUBLISHED-TTL:PT4H',
    'BEGIN:VTIMEZONE', 'TZID:Europe/London', 'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const [i, item] of items.entries()) {
    const summary = `SUMMARY:${item.title}`;
    lines.push('BEGIN:VEVENT', ...(summary.length > 75 ? [summary.slice(0, 75), ` ${summary.slice(75)}`] : [summary]), `DTSTART${item.start}`, `DTEND${item.start}`,
      'DTSTAMP:20261118T100000Z', `UID:${item.uid ?? `_blackboard.platform.gradebook2.GradableItem-_${1000 + i}_1`}`, 'DESCRIPTION:', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** The made-up calendar the checks share: what a student might really have, around NOW. */
const SAMPLE = calendarFile([
  { title: 'Log Task 3 submission (Fri\\, week 8)', start: ';TZID=Europe/London:20261120T140000' },
  { title: 'Task 2: Completed ToR (Hurdle)', start: ';TZID=Europe/London:20261204T120000' },
  { title: 'KV6014 Group report\\; final', start: ';TZID=Europe/London:20270115T160000' },
  { title: 'Reflective statement, a title long enough that Blackboard folds the line at seventy-five bytes as the format asks', start: ';TZID=Europe/London:20270301T170000' },
  { title: 'Before the clocks went back', start: ';TZID=Europe/London:20261024T140000' },
  { title: 'After the clocks went back', start: ';TZID=Europe/London:20261026T140000' },
  { title: 'Yesterday’s quiz', start: ';TZID=Europe/London:20261117T090000' },
  { title: 'Last term’s essay', start: ';TZID=Europe/London:20260312T120000' },
  { title: 'A year ago', start: ';TZID=Europe/London:20251119T120000' },
  { title: 'Given in UTC', start: ':20261201T230000Z' },
  { title: 'A whole day', start: ';VALUE=DATE:20261210' },
  { title: 'Odd zone', start: ';TZID=Not/AZone:20261211T100000' },
  { title: 'The same item twice', start: ';TZID=Europe/London:20261212T100000', uid: 'twice' },
  { title: 'The same item twice', start: ';TZID=Europe/London:20261212T100000', uid: 'twice' }
]);

/** A stand-in fetch that answers with this, and remembers how it was called. @param {() => Response | Promise<Response>} answer */
function fakeFetch(answer) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  const doFetch = /** @type {typeof fetch} */ (async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return answer();
  });
  return { fetch: doFetch, calls };
}

/** @param {string} body @param {ResponseInit} [init] */
const calendarResponse = (body, init = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/calendar; charset=UTF-8' }, ...init });

/** Runs a read and gives back the ReadError it threw. @param {Promise<unknown>} read */
async function refused(read) {
  try {
    await read;
  } catch (err) {
    assert.ok(err instanceof ReadError, `a ReadError, not ${err}`);
    return err;
  }
  assert.fail('the read was allowed');
}

/** A tiny storage like localStorage, for the store checks. */
function fakeStorage() {
  const store = new Map();
  return {
    store,
    getItem: (/** @type {string} */ key) => store.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => void store.set(key, value),
    removeItem: (/** @type {string} */ key) => void store.delete(key),
    key: (/** @type {number} */ i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    }
  };
}

/** @param {string} file */
const source = (file) => readFileSync(file, 'utf8');

/** Every .js and .svelte file under a folder. @param {string} folder @returns {string[]} */
function walk(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(js|svelte|mjs)$/.test(name) ? [path] : [];
  });
}

/** Every file a file imports, directly or through others (#lib, #shared and relative imports). @param {string} start */
function reachable(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const [, spec] of source(file).matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!spec) continue;
      if (spec.startsWith('#lib/')) queue.push(join('src/lib', spec.slice(5)));
      else if (spec.startsWith('#shared/')) queue.push(join('functions/shared', spec.slice(8)));
      else if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec).replace(`${resolve('.')}/`, ''));
      else seen.add(spec);
    }
  }
  seen.delete(start);
  return [...seen];
}

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['The link: exactly Blackboard’s shape is accepted (trimmed); http, another host, a lookalike, a user name, an extra path, a query, a fragment, the wrong length or case are all refused', () => {
    assert.equal(calendarLinkFrom(GOOD), GOOD);
    assert.equal(calendarLinkFrom(`  ${GOOD}\n`), GOOD, 'trimmed');
    assert.equal(calendarLinkId(GOOD), '0a1b2c3d4e5f60718293a4b5c6d7e8f9');
    const refusedLinks = [
      GOOD.replace('https://', 'http://'),
      GOOD.replace('elp.northumbria.ac.uk', 'elp.northumbria.ac.uk.example.com'),
      GOOD.replace('elp.northumbria.ac.uk', 'example.com'),
      GOOD.replace('elp.northumbria.ac.uk', 'elp.northumbria.ac.uk@example.com'),
      GOOD.replace('elp.northumbria.ac.uk', 'user@elp.northumbria.ac.uk'),
      GOOD.replace('elp.northumbria.ac.uk', 'elp.northumbria.ac.uk:8443'),
      GOOD.replace('/webapps/', '/other/'),
      GOOD.replace('/learn.ics', '/extra/learn.ics'),
      `${GOOD}/`, `${GOOD}?x=1`, `${GOOD}#top`, `${GOOD} and more`,
      GOOD.replace(GOOD_ID, GOOD_ID.slice(1)), GOOD.replace(GOOD_ID, `${GOOD_ID}0`), GOOD.replace(GOOD_ID, GOOD_ID.toUpperCase()), GOOD.replace(GOOD_ID, GOOD_ID.replace('a', 'g')),
      GOOD.replace('learn.ics', 'learn.ICS'), GOOD.replace('https://', 'https:/'), `javascript:${GOOD}`, '', 'not a link', 42, null, undefined, { link: GOOD }
    ];
    for (const link of refusedLinks) assert.equal(calendarLinkFrom(link), null, `accepted: ${String(link)}`);
    assert.equal(isCalendarLink(GOOD), true);
    assert.equal(isCalendarLink(`${GOOD}?x=1`), false);
  }],
  ['The words for a wrong link help: paste it first; not a link; a link but not the calendar one (with where to find it); nearly, copy it again', () => {
    assert.equal(calendarLinkProblem(GOOD), null);
    assert.equal(calendarLinkProblem('   '), 'Paste the link first.');
    assert.match(String(calendarLinkProblem('elp.northumbria.ac.uk')), /doesn’t look like a link/);
    assert.match(String(calendarLinkProblem('https://elp.northumbria.ac.uk/ultra/calendar')), /not your Blackboard calendar link.*Share calendar/);
    assert.match(String(calendarLinkProblem(`${GOOD}?x=1`)), /nearly it.*Copy it again/);
    assert.match(String(calendarLinkProblem(GOOD.replace('https://', 'http://'))), /nearly it/);
  }],
  ['The reader: titles and times from a file like Blackboard’s, soonest first, from a week ago; London on both sides of a clock change; folded lines; escaped commas and semicolons; UTC; a date only; an odd zone read as London; one item twice kept once', () => {
    const deadlines = deadlinesFrom(SAMPLE, NOW);
    const byTitle = Object.fromEntries(deadlines.map((d) => [d.title, d]));
    assert.deepEqual(deadlines.map((d) => d.title), [
      'Yesterday’s quiz', 'Log Task 3 submission (Fri, week 8)', 'Given in UTC', 'Task 2: Completed ToR (Hurdle)', 'A whole day', 'Odd zone', 'The same item twice', 'KV6014 Group report; final',
      'Reflective statement, a title long enough that Blackboard folds the line at seventy-five bytes as the format asks'
    ]);
    assert.equal(byTitle['Log Task 3 submission (Fri, week 8)'].at, '2026-11-20T14:00:00.000Z', 'GMT: 14:00 London is 14:00 UTC');
    assert.equal(byTitle['Given in UTC'].at, '2026-12-01T23:00:00.000Z');
    assert.equal(byTitle['A whole day'].at, '2026-12-10T00:00:00.000Z');
    assert.equal(byTitle['A whole day'].allDay, true);
    assert.equal(byTitle['Odd zone'].at, '2026-12-11T10:00:00.000Z');
    assert.equal(byTitle['Yesterday’s quiz'].at, '2026-11-17T09:00:00.000Z');
    assert.ok(deadlines.every((d) => !('allDay' in d) || d.allDay === true));
    // The clock change itself: the two October items are more than a week before NOW, so read them with an earlier "now".
    const october = deadlinesFrom(SAMPLE, Date.parse('2026-10-25T12:00:00Z'));
    assert.equal(october.find((d) => d.title === 'Before the clocks went back')?.at, '2026-10-24T13:00:00.000Z', 'BST: 14:00 London is 13:00 UTC');
    assert.equal(october.find((d) => d.title === 'After the clocks went back')?.at, '2026-10-26T14:00:00.000Z', 'GMT again');
    assert.ok(deadlines.every((d) => /^d-[0-9a-f]{8}$/.test(d.id)), 'short ids');
    assert.ok(!JSON.stringify(deadlines).includes('GradableItem'), 'Blackboard’s own ids aren’t passed on');
    assert.equal(new Set(deadlines.map((d) => d.id)).size, deadlines.length);
    assert.equal(zonedToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 0, second: 0 }, 'Europe/London'), Date.parse('2026-03-29T02:00:00Z'), 'the morning the clocks go forward');
    assert.equal(zonedToUtc({ year: 2026, month: 3, day: 28, hour: 3, minute: 0, second: 0 }, 'Europe/London'), Date.parse('2026-03-28T03:00:00Z'), 'the day before');
  }],
  ['The reader: a year of past items is left out beyond PAST_DAYS; at most MAX_DEADLINES; an empty calendar is no deadlines; HTML or nothing is refused; a BOM is fine; bad dates are skipped', () => {
    const past = calendarFile(Array.from({ length: 365 }, (_, i) => ({ title: `Day ${i}`, start: `;TZID=Europe/London:${new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10).replace(/-/g, '')}T120000` })));
    const kept = deadlinesFrom(past, NOW);
    assert.equal(kept.length, PAST_DAYS, `${kept.length} kept`);
    assert.ok(kept.every((d) => NOW - Date.parse(d.at) <= PAST_DAYS * DAY));
    const many = calendarFile(Array.from({ length: 80 }, (_, i) => ({ title: `Item ${i}`, start: `;TZID=Europe/London:${new Date(NOW + (i + 1) * DAY).toISOString().slice(0, 10).replace(/-/g, '')}T120000` })));
    assert.equal(deadlinesFrom(many, NOW).length, MAX_DEADLINES);
    assert.deepEqual(deadlinesFrom(calendarFile([]), NOW), []);
    assert.deepEqual(deadlinesFrom(`\uFEFF${calendarFile([{ title: 'With a BOM', start: ':20261201T120000Z' }])}`, NOW).map((d) => d.title), ['With a BOM']);
    assert.throws(() => deadlinesFrom('<!doctype html><html><body>Log in</body></html>', NOW), FeedError);
    assert.throws(() => deadlinesFrom('', NOW), FeedError);
    assert.equal(looksLikeCalendar('BEGIN:VCALENDAR\r\nVERSION:2.0'), true);
    assert.equal(looksLikeCalendar('BEGIN:VCALENDARX'), false);
    assert.deepEqual(deadlinesFrom(calendarFile([{ title: 'No real date', start: ':tomorrow' }, { title: 'Month 13', start: ':20261301T120000' }]), NOW), []);
    assert.equal(instantFrom({ params: {}, value: '20261120T140000Z' })?.at, Date.parse('2026-11-20T14:00:00Z'));
    assert.equal(instantFrom({ params: {}, value: '2026-11-20' }), null);
    assert.equal(shortId('abc'), shortId('abc'));
    assert.notEqual(shortId('abc'), shortId('abd'));
    assert.ok(MAX_FEED_BYTES >= 256 * 1024);
  }],
  ['The function’s read: one fetch of the link itself, following no redirects, with a time limit and asking for a calendar; the deadlines come back with when they were read', async () => {
    const { fetch, calls } = fakeFetch(() => calendarResponse(SAMPLE));
    const read = await readDeadlinesFor({ link: GOOD }, { fetch, now: NOW });
    assert.equal(read.deadlines.length, 9);
    assert.equal(read.readAt, new Date(NOW).toISOString());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GOOD);
    assert.equal(calls[0].init.redirect, 'error');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(new Headers(calls[0].init.headers).get('accept'), 'text/calendar');
    assert.equal(FETCH_TIMEOUT_MS, 8000);
  }],
  ['The function’s read refuses every other shape before fetching anything (invalid-argument)', async () => {
    const { fetch, calls } = fakeFetch(() => calendarResponse(SAMPLE));
    for (const data of [{ link: `${GOOD}?x=1` }, { link: GOOD.replace('https', 'http') }, { link: 'https://example.com/learn.ics' }, { link: '' }, {}, null, undefined, 'a string', { link: ['x'] }]) {
      const err = await refused(readDeadlinesFor(data, { fetch }));
      assert.equal(err.code, 'invalid-argument', JSON.stringify(data));
    }
    assert.equal(calls.length, 0, 'nothing was fetched');
  }],
  ['The function’s read: Blackboard not answering, a redirect or a timeout is "unavailable"; 404, 403, 401 or 410 is "not-found"; a 500 is "unavailable"', async () => {
    const redirecting = fakeFetch(() => { throw new TypeError('fetch failed: redirect'); });
    assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: redirecting.fetch }))).code, 'unavailable');
    const never = /** @type {typeof fetch} */ ((url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    // Node doesn't keep the process alive for AbortSignal.timeout's timer (a real fetch's socket would), so hold it open here.
    const keepAlive = setTimeout(() => {}, 10_000);
    const started = Date.now();
    try {
      assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: never, timeoutMs: 80 }))).code, 'unavailable');
    } finally {
      clearTimeout(keepAlive);
    }
    assert.ok(Date.now() - started < 2000, 'gave up at the time limit');
    for (const status of [404, 403, 401, 410]) {
      assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: fakeFetch(() => new Response('gone', { status })).fetch }))).code, 'not-found', String(status));
    }
    assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: fakeFetch(() => new Response('oops', { status: 500 })).fetch }))).code, 'unavailable');
  }],
  ['The function’s read takes only a calendar: HTML, or a "calendar" that isn’t one, is "failed-precondition"; too big by its length or as it streams is "resource-exhausted"', async () => {
    const html = fakeFetch(() => new Response('<!doctype html><p>Log in</p>', { status: 200, headers: { 'content-type': 'text/html' } }));
    assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: html.fetch }))).code, 'failed-precondition');
    const pretending = fakeFetch(() => calendarResponse('<!doctype html><p>Log in</p>'));
    assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: pretending.fetch }))).code, 'failed-precondition');
    const declared = fakeFetch(() => calendarResponse('BEGIN:VCALENDAR', { headers: { 'content-type': 'text/calendar', 'content-length': String(MAX_FEED_BYTES + 1) } }));
    assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: declared.fetch }))).code, 'resource-exhausted');
    const chunk = new TextEncoder().encode(`${'X'.repeat(1023)}\n`);
    let sent = 0;
    const endless = new ReadableStream({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > MAX_FEED_BYTES * 4) controller.close();
      }
    });
    const streamed = fakeFetch(() => new Response(endless, { status: 200, headers: { 'content-type': 'text/calendar' } }));
    assert.equal((await refused(readDeadlinesFor({ link: GOOD }, { fetch: streamed.fetch }))).code, 'resource-exhausted');
    assert.ok(sent <= MAX_FEED_BYTES * 2, `stopped reading at ${sent} bytes`);
  }],
  ['Nothing the function’s read throws says anything about the link', async () => {
    const answers = [() => new Response('x', { status: 404 }), () => new Response('x', { status: 500 }), () => new Response('<p>', { status: 200, headers: { 'content-type': 'text/html' } }), () => { throw new Error(GOOD); }];
    for (const answer of answers) {
      const err = await refused(readDeadlinesFor({ link: GOOD }, { fetch: fakeFetch(answer).fetch }));
      assert.ok(!err.message.includes(GOOD_ID) && !err.message.includes('calendarFeed'), err.message);
    }
    const bad = await refused(readDeadlinesFor({ link: `${GOOD}?x=1` }, {}));
    assert.ok(!bad.message.includes(GOOD_ID));
  }],
  ['The pretend Blackboard is used in the emulator only: outside it the address is the link, whatever the environment says', () => {
    assert.equal(fetchAddress(GOOD, { emulator: true, pretendOrigin: 'http://127.0.0.1:5199' }), `http://127.0.0.1:5199/webapps/calendar/calendarFeed/${GOOD_ID}/learn.ics`);
    assert.equal(fetchAddress(GOOD, { emulator: true, pretendOrigin: 'http://127.0.0.1:5199/' }), `http://127.0.0.1:5199/webapps/calendar/calendarFeed/${GOOD_ID}/learn.ics`);
    assert.equal(fetchAddress(GOOD, { emulator: false, pretendOrigin: 'http://127.0.0.1:5199' }), GOOD);
    assert.equal(fetchAddress(GOOD, { emulator: true, pretendOrigin: '' }), GOOD);
    assert.equal(fetchAddress(GOOD), GOOD);
    const index = source('functions/index.js');
    assert.match(index, /const EMULATOR = process\.env\.FUNCTIONS_EMULATOR === 'true';/);
    assert.match(index, /const PRETEND_ORIGIN = EMULATOR \? \(process\.env\.PRETEND_BLACKBOARD_ORIGIN \?\? ''\) : '';/);
    const env = source('functions/.env.demo-ag2').split('\n').filter((line) => line.trim() && !line.startsWith('#'));
    assert.deepEqual(env.map((line) => line.split('=')[0]), ['PRETEND_BLACKBOARD_ORIGIN'], 'nothing else in the emulator’s env file');
    assert.match(env[0], /^PRETEND_BLACKBOARD_ORIGIN=http:\/\/127\.0\.0\.1:\d+$/);
  }],
  ['The gate is the rules’ own: signed out; unverified; a Northumbria address without reading the switch; an outside address only with the switch off; the test accounts, which the rules list the same', async () => {
    let switchReads = 0;
    const on = async () => (switchReads++, true);
    const off = async () => (switchReads++, false);
    assert.equal(await accessProblem(null, on), 'unauthenticated');
    assert.equal(await accessProblem({ uid: 'u1', email: 'nia@northumbria.ac.uk', emailVerified: false }, on), 'unverified');
    assert.equal(await accessProblem({ uid: 'u1', email: 'nia@northumbria.ac.uk', emailVerified: true }, on), null);
    assert.equal(await accessProblem({ uid: 'u1', email: 'Nia@Northumbria.AC.UK', emailVerified: true }, on), null, 'any case');
    assert.equal(switchReads, 0, 'a Northumbria account never reads the switch');
    assert.equal(await accessProblem({ uid: 'u2', email: 'ola@example.com', emailVerified: true }, on), 'northumbria-only');
    assert.equal(await accessProblem({ uid: 'u2', email: 'ola@example.com', emailVerified: true }, off), null);
    assert.equal(await accessProblem({ uid: 'u2', email: 'ola@example.com', emailVerified: false }, off), 'unverified', 'verified either way');
    assert.equal(await accessProblem({ uid: 'u3', email: 'x@live.northumbria.ac.uk', emailVerified: true }, on), 'northumbria-only', 'not a subdomain');
    assert.equal(await accessProblem({ uid: 'u3', emailVerified: true }, on), 'northumbria-only', 'no address');
    assert.equal(switchReads, 4, 'the switch is read only for a verified outside address');
    assert.equal(await accessProblem({ uid: TEST_ACCOUNT_UIDS[0], email: 'test@example.com', emailVerified: false }, on), null, 'a test account, as in the rules');
    for (const email of ['nia@northumbria.ac.uk', 'NIA@NORTHUMBRIA.AC.UK', ' nia@northumbria.ac.uk ', 'nia@live.northumbria.ac.uk', 'nia@northumbria.ac.uk.example.com', '@northumbria.ac.uk', 'nia@example.com', 'two words@northumbria.ac.uk', '', null]) {
      assert.equal(isNorthumbriaAddress(email), isUniEmail(email), `agrees with isUniEmail on ${JSON.stringify(email)}`);
    }
    const rules = source('firestore.rules');
    const listed = [...rules.matchAll(/'([A-Za-z0-9]{28})'/g)].map((match) => match[1]);
    assert.deepEqual([...TEST_ACCOUNT_UIDS], listed, 'the same three accounts as isTestAccount in the rules');
  }],
  ['Kept on the phone under ag2.deadlines.<uid> only: the link (exact shape only), when it was read and the deadlines; per student; forgetting deletes it; logging out deletes every student’s; blocked storage just says no', () => {
    const storage = fakeStorage();
    assert.equal(keepLink('nia', `${GOOD}?x=1`, storage), false, 'a wrong shape is never kept');
    assert.equal(keepLink('nia', GOOD, storage), true);
    assert.deepEqual(readKept('nia', storage), { link: GOOD, readAt: null, deadlines: [] });
    assert.deepEqual([...storage.store.keys()], [keyFor('nia')]);
    assert.equal(keyFor('nia'), `${KEY_PREFIX}nia`);
    const read = { readAt: new Date(NOW).toISOString(), deadlines: deadlinesFrom(SAMPLE, NOW) };
    assert.equal(keepDeadlines('nia', read, storage), true);
    assert.deepEqual(readKept('nia', storage), { link: GOOD, ...read });
    assert.equal(readKept('wes', storage), null, 'per student');
    assert.equal(keepDeadlines('wes', read, storage), false, 'no link, nothing kept');
    assert.equal(keepLink('nia', linkWith('ffff'), storage), true);
    assert.deepEqual(readKept('nia', storage)?.deadlines, [], 'a new link forgets the old deadlines');
    storage.setItem(keyFor('mia'), JSON.stringify({ link: 'https://example.com/learn.ics', deadlines: [{ id: 'x' }] }));
    assert.equal(readKept('mia', storage), null, 'what isn’t a link isn’t kept');
    storage.setItem(keyFor('wes'), JSON.stringify({ link: GOOD, readAt: 'never', deadlines: [{ id: 'x', title: 'T', at: 'nope' }, { id: 'y', title: 'U', at: '2026-12-01T10:00:00.000Z' }] }));
    assert.deepEqual(readKept('wes', storage), { link: GOOD, readAt: null, deadlines: [{ id: 'y', title: 'U', at: '2026-12-01T10:00:00.000Z' }] }, 'odd parts dropped');
    storage.setItem('ag2.blackboard.nia', '{"seen":{}}');
    forgetDeadlines('nia', storage);
    assert.equal(readKept('nia', storage), null);
    forgetAllDeadlines(storage);
    assert.deepEqual([...storage.store.keys()], ['ag2.blackboard.nia'], 'only the deadlines keys go');
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); }, key: () => { throw new Error('blocked'); }, length: 1 };
    assert.equal(keepLink('nia', GOOD, blocked), false);
    assert.equal(readKept('nia', blocked), null);
    assert.doesNotThrow(() => { forgetDeadlines('nia', blocked); forgetAllDeadlines(blocked); });
  }],
  ['The words: coming and passed; due today at, tomorrow at, a weekday, was due yesterday or N days ago, a date-only one without a time; read just now or N hours ago; Add to calendar is the half hour before, made on the phone', () => {
    const deadlines = deadlinesFrom(SAMPLE, NOW);
    const { coming, passed } = splitDeadlines(deadlines, NOW);
    assert.deepEqual(passed.map((d) => d.title), ['Yesterday’s quiz']);
    assert.equal(coming[0].title, 'Log Task 3 submission (Fri, week 8)');
    assert.deepEqual(comingDeadlines(deadlines, NOW).map((d) => d.title), coming.map((d) => d.title));
    const at = (/** @type {number} */ offset) => ({ id: 'd', title: 'T', at: new Date(NOW + offset).toISOString() });
    assert.match(dueWords(at(2 * 3_600_000), NOW), /^due today at \d\d:\d\d$/);
    assert.match(dueWords(at(DAY), NOW), /^due tomorrow at \d\d:\d\d$/);
    assert.match(dueWords(at(9 * DAY), NOW), /^due [A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2}$/);
    assert.equal(dueWords(at(-DAY), NOW), 'was due yesterday');
    assert.equal(dueWords(at(-3 * DAY), NOW), 'was due 3 days ago');
    assert.match(dueWords(at(-3_600_000), NOW), /^was due today at \d\d:\d\d$/);
    assert.equal(dueWords({ ...at(0), allDay: true }, NOW), 'due today');
    assert.match(dueWords({ ...at(DAY), allDay: true }, NOW), /^due tomorrow$/);
    assert.equal(readAgo(new Date(NOW - 30_000).toISOString(), NOW), 'just now');
    assert.equal(readAgo(new Date(NOW - 20 * 60_000).toISOString(), NOW), '20 minutes ago');
    assert.equal(readAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), '3 hours ago');
    assert.equal(readAgo(new Date(NOW - 30 * 3_600_000).toISOString(), NOW), 'yesterday');
    const entry = calendarEntryFor(coming[0]);
    assert.equal(entry.title, 'Due: Log Task 3 submission (Fri, week 8)');
    assert.equal(entry.end, Date.parse('2026-11-20T14:00:00Z'));
    assert.equal(entry.start, Date.parse('2026-11-20T13:30:00Z'));
    assert.ok(icsFor(entry, NOW).includes('DTSTART:20261120T133000Z\r\nDTEND:20261120T140000Z'));
    assert.doesNotMatch(source('src/lib/deadlines/show.js'), /fetch\(|firebase/);
  }],
  ['The function: App Check enforced, London, capped instances, nothing logged, no key; firebase.json and the package say where and what it runs on', () => {
    const index = source('functions/index.js');
    assert.match(index, /onCall\(\{ enforceAppCheck: true \}/);
    assert.match(index, /region: 'europe-west2'/);
    assert.match(index, /maxInstances: 2/);
    assert.doesNotMatch(index, /console\.|logger|functions\/logger/, 'nothing logs');
    assert.doesNotMatch([index, source('functions/lib/read-deadlines.js'), source('functions/shared/access-gate.js')].join('\n'), /console\.|cert\(|serviceAccount|private_key/);
    assert.match(index, /initializeApp\(\);/, 'the function’s own identity');
    assert.match(index, /new HttpsError\('unauthenticated'/);
    assert.match(index, /new HttpsError\('permission-denied'/);
    assert.match(index, /\{ about: 'calendar' \}/, 'the app can tell a link problem from a missing function');
    const config = JSON.parse(source('firebase.json'));
    assert.deepEqual(config.functions, [{ source: 'functions', codebase: 'default', runtime: 'nodejs22', ignore: ['node_modules', '.git', '*.log'] }]);
    assert.equal(config.emulators.functions.port, 5001);
    const pkg = JSON.parse(source('functions/package.json'));
    assert.equal(pkg.engines.node, '22');
    assert.equal(pkg.type, 'module');
    assert.ok(pkg.dependencies['firebase-functions'] && pkg.dependencies['firebase-admin']);
    assert.match(source('src/lib/firebase/client.js'), /FUNCTIONS_REGION = 'europe-west2'/);
    assert.match(source('src/lib/firebase/client.js'), /connectFunctionsEmulator\(functions, '127\.0\.0\.1', \d+\)/, 'the emulator in emulators mode');
  }],
  ['In the app: the link goes only in the body of the call to the function; storage only through store.js; log out forgets it before signing out; Home, the checklist and More have it; Privacy and What the chat knows say what’s true', () => {
    const read = source('src/lib/deadlines/read.js');
    assert.match(read, /httpsCallable\(getFirebaseFunctions\(\), FUNCTION_NAME\)/);
    assert.match(read, /await call\(\{ link \}\)/);
    assert.doesNotMatch(read, /fetch\(|location\.|\$\{link\}|encodeURIComponent/);
    assert.match(read, /startAppCheck\(\);/);
    assert.match(read, /console\.error\('Reading deadlines failed:', .*\?\.code \?\? 'error'\)/, 'the console sees a code, never the link');
    for (const file of ['src/lib/deadlines/read.js', 'src/lib/deadlines/show.js', 'src/lib/components/DeadlinesCard.svelte', 'src/routes/deadlines/+page.svelte']) {
      assert.doesNotMatch(source(file), /localStorage|sessionStorage|indexedDB/, `${file}: storage only through store.js`);
    }
    const logout = source('src/lib/components/LogoutButton.svelte');
    assert.ok(logout.indexOf('forgetAllDeadlines()') !== -1 && logout.indexOf('forgetAllDeadlines()') < logout.indexOf('signOut(getFirebaseAuth())'), 'forgotten before signing out');
    assert.match(source('src/routes/home/+page.svelte'), /<DeadlinesCard \/>/);
    assert.match(source('src/routes/checklist/+page.svelte'), /\{#if signedIn === true\}\s*<DeadlinesCard \/>\s*\{\/if\}/);
    assert.match(source('src/routes/more/+page.svelte'), /href: '\/deadlines'/);
    assert.match(source('src/lib/components/BlackboardComingSoon.svelte'), /still to come here, if IT agree to connect AG2/);
    const privacy = source('src/routes/privacy/+page.svelte');
    assert.match(privacy, /Your Blackboard calendar link,<\/strong> if you’ve pasted it/);
    assert.match(privacy, /<li>Your Blackboard calendar link, and your deadlines\.<\/li>/);
    assert.match(privacy, /AG2’s own server function<\/strong>/);
    assert.match(privacy, /Forget this link, on Your deadlines/);
    assert.match(source('src/routes/about-you/+page.svelte'), /<dt>Your deadlines<\/dt>\s*<dd>The chat isn’t told these/);
    const page = source('src/routes/deadlines/+page.svelte');
    for (const words of ['Copy the link in Blackboard', 'Share calendar', 'What the link lets the app see', 'Treat it like a password', 'Forget this link', 'still to come, if IT agree', 'id="calendar-link"']) assert.ok(page.includes(words), words);
    assert.match(source('README.md'), /readDeadlines/);
  }],
  ['Nothing from the deadlines reaches Gemini: no chat code imports it, it imports no chat or Gemini code, and the one App Check start is shared', () => {
    const deadlinesFiles = [...walk('src/lib/deadlines'), 'src/lib/components/DeadlinesCard.svelte', 'src/routes/deadlines/+page.svelte', ...walk('functions/shared'), ...walk('functions/lib'), 'functions/index.js'];
    for (const file of [...walk('src/lib/checkin'), ...walk('src/routes/check-in'), 'src/lib/firebase/ai.js']) {
      for (const reached of reachable(file)) assert.ok(!/src\/lib\/deadlines\/|functions\/|DeadlinesCard/.test(reached), `${file} reaches ${reached}`);
    }
    for (const file of deadlinesFiles) {
      for (const reached of reachable(file)) assert.ok(!/firebase\/ai|checkin\//.test(reached), `${file} reaches ${reached}`);
      assert.doesNotMatch(source(file), /from ['"](?:firebase\/ai|#lib\/firebase\/ai\.js|#lib\/checkin\/)/, file);
    }
    assert.match(source('src/lib/firebase/ai.js'), /startAppCheck\(\);/);
    assert.doesNotMatch(source('src/lib/firebase/ai.js'), /initializeAppCheck/);
    assert.equal([...source('src/lib/firebase/app-check.js').matchAll(/initializeAppCheck\(/g)].length, 2, 'the pretend one for the emulators, and the real one');
  }],
  ['No calendar link of the real shape anywhere in the app, the function, the README or what’s served: made-up ids live only in this check', () => {
    const files = [...walk('src'), ...walk('functions').filter((file) => !file.includes('node_modules')), 'README.md', 'firebase.json', 'firestore.rules', ...walk('static')];
    const found = files.filter((file) => /calendarFeed\/[0-9a-f]{32}\//.test(source(file)));
    assert.deepEqual(found, []);
  }]
];

let failed = 0;
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const report = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  (${detail})` : ''}`);
};
for (const [name, check] of offline) {
  try {
    await check();
    report(name, true);
  } catch (err) {
    report(name, false, /** @type {Error} */ (err).message.split('\n').slice(0, 6).join(' | '));
  }
}
console.log(`\n${offline.length - failed}/${offline.length} offline checks passed`);

// ---------- In the emulators: the function, then the app in Chrome ----------
const where = emulators();
const hosts = where ? await emulatorHosts() : { functions: null };
if (!where || !hosts.functions) {
  console.log(where ? '\nThe Functions emulator isn’t running (emulators:exec --only auth,firestore,functions), so the function and browser parts were skipped.' : '\nNot in the emulators, so the function and browser parts were skipped.');
  process.exit(failed === 0 ? 0 : 1);
}

/** The pretend Blackboard: the origin functions/.env.demo-ag2 names, so the emulated function fetches from it. */
const PRETEND_ORIGIN = /** @type {string} */ (source('functions/.env.demo-ag2').match(/^PRETEND_BLACKBOARD_ORIGIN=(\S+)$/m)?.[1]);
const pretendPort = Number(new URL(PRETEND_ORIGIN).port);
const LINKS = {
  good: GOOD,
  redirect: linkWith('1ed1bec7'),
  html: linkWith('47a1'),
  big: linkWith('b16'),
  slow: linkWith('510'),
  gone: linkWith('60e'),
  notCalendar: linkWith('0ca1')
};
/** @type {{ path: string, headers: import('node:http').IncomingHttpHeaders }[]} */
const pretendSaw = [];
const pretend = createServer((request, response) => {
  pretendSaw.push({ path: request.url ?? '', headers: request.headers });
  const id = request.url?.match(/^\/webapps\/calendar\/calendarFeed\/([0-9a-f]{32})\/learn\.ics$/)?.[1];
  const is = (/** @type {string} */ link) => id === calendarLinkId(link);
  if (is(LINKS.good)) return response.writeHead(200, { 'content-type': 'text/calendar; charset=UTF-8' }).end(calendarFile(liveItems()));
  if (is(LINKS.redirect)) return response.writeHead(302, { location: `${PRETEND_ORIGIN}${new URL(LINKS.good).pathname}` }).end();
  if (is(LINKS.html)) return response.writeHead(200, { 'content-type': 'text/html; charset=UTF-8' }).end('<!doctype html><title>Log in</title>');
  if (is(LINKS.notCalendar)) return response.writeHead(200, { 'content-type': 'text/calendar' }).end('<!doctype html><title>Pretending</title>');
  if (is(LINKS.big)) return response.writeHead(200, { 'content-type': 'text/calendar' }).end(`BEGIN:VCALENDAR\r\n${'X-FILLER:'.padEnd(1000, 'x')}\r\n`.repeat(Math.ceil((MAX_FEED_BYTES + 100_000) / 1000)));
  if (is(LINKS.slow)) return void setTimeout(() => response.writeHead(200, { 'content-type': 'text/calendar' }).end(calendarFile([])), FETCH_TIMEOUT_MS + 1500);
  response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
});
/** Items around the real now, for the live function: three coming, one just passed. */
const liveItems = () => {
  const stamp = (/** @type {number} */ offset) => `;TZID=Europe/London:${new Date(Date.now() + offset).toISOString().slice(0, 10).replace(/-/g, '')}T140000`;
  return [
    { title: 'Log Task 3 submission (Fri\\, week 8)', start: stamp(2 * DAY) },
    { title: 'Task 2: Completed ToR (Hurdle)', start: stamp(9 * DAY) },
    { title: 'Group report\\; final', start: stamp(40 * DAY) },
    { title: 'Last week’s quiz', start: stamp(-3 * DAY) },
    { title: 'Months ago', start: stamp(-200 * DAY) }
  ];
};
await new Promise((ready, fail) => {
  pretend.on('error', (err) => fail(new Error(`the pretend Blackboard couldn’t listen on ${PRETEND_ORIGIN} (another check running?): ${err.message}`)));
  pretend.listen(pretendPort, '127.0.0.1', () => ready(undefined));
});

const db = owner(where);
const password = randomBytes(18).toString('base64url');
const nia = { email: 'nia.calendar@northumbria.ac.uk', password, uid: '' };
const unverified = { email: 'uma.unverified@northumbria.ac.uk', password, uid: '' };
const outsider = { email: 'ola.outside@example.com', password, uid: '' };
nia.uid = await db.verifiedAccount(nia.email, password);
unverified.uid = await db.verifiedAccount(unverified.email, password, false);
outsider.uid = await db.verifiedAccount(outsider.email, password);
await db.seed(`students/${nia.uid}`, { name: 'Nia Student', course: 'BSc Nursing', email: nia.email, arrivalDate: '', role: 'student', studentType: 'home', interests: [], ...CHECKLIST_DONE });
await db.seed(`students/${outsider.uid}`, { name: 'Ola Outside', course: 'BSc Nursing', email: outsider.email, arrivalDate: '', role: 'student', studentType: 'home', interests: [], ...CHECKLIST_DONE });
await db.delete('config/access');

/** A token shaped like App Check's, which the emulator reads without checking who signed it (as the app makes in emulators mode). */
const pretendAppCheck = () => {
  const part = (/** @type {object} */ value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'check-app', aud: ['projects/demo-ag2'], iat: now, exp: now + 3600 })}.pretend`;
};
const FUNCTION_URL = `http://${hosts.functions}/${where.project}/europe-west2/readDeadlines`;
/** @type {string[]} */
const answersSeen = [];
/**
 * Calls the emulated function as the app's SDK does (POST { data }, the ID token and App Check token as
 * headers), and gives back the HTTP status and the answer.
 * @param {{ idToken?: string | null, appCheck?: string | null, data?: unknown }} call
 */
async function callFunction({ idToken = null, appCheck = pretendAppCheck(), data }) {
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  if (appCheck) headers['x-firebase-appcheck'] = appCheck;
  const response = await fetch(FUNCTION_URL, { method: 'POST', headers, body: JSON.stringify({ data }), signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  answersSeen.push(text);
  /** @type {{ result?: any, error?: { message: string, status: string, details?: any } }} */
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { message: text.slice(0, 200), status: 'NOT_JSON' } };
  }
  return { status: response.status, result: body.result, error: body.error };
}

console.log('\nThe function, in the emulator:');
const niaToken = (await db.signIn(nia.email, password)).idToken;
const unverifiedToken = (await db.signIn(unverified.email, password)).idToken;
const outsiderToken = (await db.signIn(outsider.email, password)).idToken;

{
  pretendSaw.length = 0;
  const good = await callFunction({ idToken: niaToken, data: { link: LINKS.good } });
  const titles = good.result?.deadlines?.map((/** @type {{ title: string }} */ d) => d.title);
  report('A verified Northumbria student with App Check gets her deadlines: soonest first, the one from last week kept, the old one dropped',
    good.status === 200 && JSON.stringify(titles) === JSON.stringify(['Last week’s quiz', 'Log Task 3 submission (Fri, week 8)', 'Task 2: Completed ToR (Hurdle)', 'Group report; final']) && typeof good.result?.readAt === 'string',
    `${good.status} ${JSON.stringify(good.error ?? titles)}`);
  const only = pretendSaw.filter((seen) => seen.path.includes(GOOD_ID));
  report('The pretend Blackboard saw one request: the link’s path, no query, asking for a calendar, with none of the caller’s tokens',
    pretendSaw.length === 1 && only.length === 1 && only[0].path === `/webapps/calendar/calendarFeed/${GOOD_ID}/learn.ics` && only[0].headers.accept === 'text/calendar' && !only[0].headers.authorization && !only[0].headers['x-firebase-appcheck'],
    JSON.stringify(pretendSaw.map((seen) => [seen.path, Object.keys(seen.headers)])));
}
{
  const signedOut = await callFunction({ data: { link: LINKS.good } });
  report('Signed out: refused as unauthenticated', signedOut.status === 401 && signedOut.error?.status === 'UNAUTHENTICATED', `${signedOut.status} ${JSON.stringify(signedOut.error)}`);
  const noAppCheck = await callFunction({ idToken: niaToken, appCheck: null, data: { link: LINKS.good } });
  report('Signed in but without App Check (not from the app): refused', noAppCheck.status === 401 && noAppCheck.error?.status === 'UNAUTHENTICATED', `${noAppCheck.status} ${JSON.stringify(noAppCheck.error)}`);
  const notVerified = await callFunction({ idToken: unverifiedToken, data: { link: LINKS.good } });
  report('A Northumbria account that hasn’t verified its address: refused (permission denied)', notVerified.status === 403 && notVerified.error?.status === 'PERMISSION_DENIED', `${notVerified.status} ${JSON.stringify(notVerified.error)}`);
  const outsideOn = await callFunction({ idToken: outsiderToken, data: { link: LINKS.good } });
  report('A verified outside address with the switch on (no config/access): refused', outsideOn.status === 403 && outsideOn.error?.status === 'PERMISSION_DENIED', `${outsideOn.status} ${JSON.stringify(outsideOn.error)}`);
  await db.seed('config/access', { uniOnly: false });
  const outsideOff = await callFunction({ idToken: outsiderToken, data: { link: LINKS.good } });
  report('The same address with the switch off (uniOnly: false): let in', outsideOff.status === 200 && Array.isArray(outsideOff.result?.deadlines), `${outsideOff.status} ${JSON.stringify(outsideOff.error)}`);
  await db.seed('config/access', { uniOnly: 'false' });
  const outsideString = await callFunction({ idToken: outsiderToken, data: { link: LINKS.good } });
  report('Only the exact value false opens it: the string "false" keeps Northumbria only', outsideString.status === 403, `${outsideString.status}`);
  await db.delete('config/access');
}
{
  pretendSaw.length = 0;
  /** @type {string[]} */
  const wrong = [];
  for (const link of [`${LINKS.good}?x=1`, LINKS.good.replace('https://', 'http://'), LINKS.good.replace('elp.northumbria.ac.uk', 'example.com'), LINKS.good.replace('elp.northumbria.ac.uk', 'elp.northumbria.ac.uk@example.com'), `${PRETEND_ORIGIN}${new URL(LINKS.good).pathname}`, 'file:///etc/passwd', 'http://169.254.169.254/computeMetadata/v1/']) {
    const answer = await callFunction({ idToken: niaToken, data: { link } });
    if (!(answer.status === 400 && answer.error?.status === 'INVALID_ARGUMENT')) wrong.push(`${link}: ${answer.status} ${answer.error?.status}`);
  }
  for (const data of [{}, { link: 5 }, null, 'text']) {
    const answer = await callFunction({ idToken: niaToken, data });
    if (!(answer.status === 400 && answer.error?.status === 'INVALID_ARGUMENT')) wrong.push(`${JSON.stringify(data)}: ${answer.status} ${answer.error?.status}`);
  }
  report('Every other shape of link (a query, http, another host, a lookalike, the pretend Blackboard’s own address, a file, the cloud metadata address) and every other kind of data is refused as invalid, and nothing is fetched',
    wrong.length === 0 && pretendSaw.length === 0, wrong.join('; ') || `${pretendSaw.length} fetched`);
}
{
  pretendSaw.length = 0;
  const redirected = await callFunction({ idToken: niaToken, data: { link: LINKS.redirect } });
  report('A redirect isn’t followed: "unavailable", and the pretend Blackboard saw only the first request', redirected.status === 503 && redirected.error?.status === 'UNAVAILABLE' && pretendSaw.length === 1 && !pretendSaw.some((seen) => seen.path.includes(GOOD_ID)), `${redirected.status} ${JSON.stringify(redirected.error)} ${pretendSaw.length}`);
  const html = await callFunction({ idToken: niaToken, data: { link: LINKS.html } });
  report('A page instead of a calendar (a login page, say): "failed-precondition"', html.status === 400 && html.error?.status === 'FAILED_PRECONDITION', `${html.status} ${JSON.stringify(html.error)}`);
  const notCalendar = await callFunction({ idToken: niaToken, data: { link: LINKS.notCalendar } });
  report('Something called a calendar that isn’t one: "failed-precondition"', notCalendar.status === 400 && notCalendar.error?.status === 'FAILED_PRECONDITION', `${notCalendar.status}`);
  const big = await callFunction({ idToken: niaToken, data: { link: LINKS.big } });
  report('Far too big: "resource-exhausted"', big.status === 429 && big.error?.status === 'RESOURCE_EXHAUSTED', `${big.status} ${JSON.stringify(big.error)}`);
  const gone = await callFunction({ idToken: niaToken, data: { link: LINKS.gone } });
  report('A link Blackboard doesn’t know (404): "not-found", marked as about the calendar so the app doesn’t mistake it for a missing function', gone.status === 404 && gone.error?.status === 'NOT_FOUND' && gone.error?.details?.about === 'calendar', `${gone.status} ${JSON.stringify(gone.error)}`);
  const slow = await callFunction({ idToken: niaToken, data: { link: LINKS.slow } });
  report(`Blackboard too slow (longer than ${FETCH_TIMEOUT_MS / 1000} seconds): "unavailable"`, slow.status === 503 && slow.error?.status === 'UNAVAILABLE', `${slow.status} ${JSON.stringify(slow.error)}`);
}
report('No answer from the function, allowed or refused, carried a link', !answersSeen.some((text) => text.includes(GOOD_ID) || text.includes('calendarFeed')));

// ---------- The app, in Chrome ----------
console.log('\nThe app, in Chrome:');
const picturesAt = process.argv.indexOf('--pictures');
const PICTURES = picturesAt > 0 ? process.argv[picturesAt + 1] : '';
if (PICTURES) mkdirSync(PICTURES, { recursive: true });
const app = await startApp();
const page = await openChrome(app.base);
try {
  const { evaluate, waitFor, has, fill, press } = page;
  /** A phone-size picture, once the page's entrance has finished, when pictures were asked for. @param {string} name */
  const picture = async (name) => {
    if (!PICTURES) return;
    await sleep(1200);
    await page.picture(join(PICTURES, `${name}.png`));
    console.log(`wrote ${join(PICTURES, `${name}.png`)}`);
  };
  const storageKeysWith = (/** @type {string} */ text) => evaluate(`Object.keys(localStorage).filter((key) => (localStorage.getItem(key) ?? '').includes(${JSON.stringify(text)}) || key.includes(${JSON.stringify(text)}))`);
  const clickText = (/** @type {string} */ words) => evaluate(`(() => { const el = [...document.querySelectorAll('button, a')].find((e) => e.textContent.trim() === ${JSON.stringify(words)}); if (!el) return false; el.click(); return true; })()`);

  report('Nia logs in', await page.logIn(nia.email, nia.password));
  report('Home: Your deadlines, with Show my deadlines to /deadlines before she’s connected', await waitFor(`${has('Your deadlines')} && document.querySelector('.deadlines a.do[href="/deadlines"]') !== null`));
  await evaluate(`(document.querySelector('.deadlines a.do[href="/deadlines"]').click(), true)`);
  report('The deadlines page: how to copy the link in Blackboard, what it lets the app see, and the box', await waitFor(`location.pathname === '/deadlines' && ${has('Copy the link in Blackboard')} && ${has('Share calendar')} && ${has('What the link lets the app see')} && document.getElementById('calendar-link') !== null`));
  await picture('deadlines-connect');
  await fill('#calendar-link', 'https://elp.northumbria.ac.uk/ultra/calendar');
  await press('Show my deadlines');
  report('A link of the wrong shape is refused with words that help, and nothing is sent', (await waitFor(has('not your Blackboard calendar link'))) && !page.requests.some((r) => r.url.includes('readDeadlines')));
  await fill('#calendar-link', `  ${LINKS.good}  `);
  await press('Show my deadlines');
  report('The right link: her deadlines, soonest first, with Add to calendar, when they were read, and the honest note', (await waitFor(has('Log Task 3 submission (Fri, week 8)'), 30000)) && (await evaluate(has('Coming up'))) && (await evaluate(has('In the last week'))) && (await evaluate(has('Last week’s quiz'))) && (await evaluate(has('read just now'))) && (await evaluate(has('still to come, if IT agree'))) && (await evaluate(`[...document.querySelectorAll('.deadlines button')].filter((b) => b.textContent.trim() === 'Add to calendar').length`)) === 3);
  const titlesOnPage = await evaluate(`[...document.querySelectorAll('.deadlines .title')].map((el) => el.textContent.trim())`);
  report('Coming up is in order, and the passed one is apart', JSON.stringify(titlesOnPage) === JSON.stringify(['Log Task 3 submission (Fri, week 8)', 'Task 2: Completed ToR (Hurdle)', 'Group report; final', 'Last week’s quiz']), JSON.stringify(titlesOnPage));
  await picture('deadlines-list');

  // The browser asks the function's origin first (an OPTIONS preflight, with no body), then POSTs the call. The
  // function took the call, so the sign-in and App Check tokens were on it: it refuses a call without either.
  const toFunction = page.requests.filter((r) => r.url.includes('/readDeadlines') && r.method !== 'OPTIONS');
  const elsewhere = page.requests.filter((r) => !r.url.includes('/readDeadlines') && (r.url.includes(GOOD_ID) || r.postData.includes(GOOD_ID)));
  report('The link went in the body of the one request to the function (a POST, which the function took, so the sign-in and App Check tokens were on it), and nowhere else: no address, no other request',
    toFunction.length === 1 && toFunction.every((r) => r.method === 'POST' && r.postData.includes(GOOD_ID) && !r.url.includes(GOOD_ID)) && elsewhere.length === 0,
    `${toFunction.length} to the function (${toFunction.map((r) => r.method).join(', ')}); elsewhere: ${elsewhere.map((r) => r.url).join(', ')}`);
  report('Nothing in the console carries the link', !page.consoleLines.some((line) => line.includes(GOOD_ID)), page.consoleLines.filter((line) => line.includes(GOOD_ID)).join(' | '));
  const keys = await storageKeysWith(GOOD_ID);
  report('On the phone it’s in localStorage under ag2.deadlines.<uid> and nowhere else (not sessionStorage)', JSON.stringify(keys) === JSON.stringify([keyFor(nia.uid)]) && (await evaluate(`Object.keys(sessionStorage).some((key) => (sessionStorage.getItem(key) ?? '').includes(${JSON.stringify(GOOD_ID)}))`)) === false, JSON.stringify(keys));
  const record = JSON.stringify(await db.read(`students/${nia.uid}`));
  report('Nothing was written to her record in Firestore', !record.includes(GOOD_ID) && !record.includes('deadline') && !record.includes('Log Task'));

  await page.go('/home');
  report('Home: the next three deadlines, soonest first, with See all', (await waitFor(has('Log Task 3 submission (Fri, week 8)'))) && (await evaluate(`[...document.querySelectorAll('.deadlines li .title')].map((el) => el.textContent.trim()).join('|')`)) === 'Log Task 3 submission (Fri, week 8)|Task 2: Completed ToR (Hurdle)|Group report; final' && (await evaluate(`document.querySelectorAll('.deadlines a[href="/deadlines"]').length`)) >= 1);
  await picture('home-deadlines');
  const callsBefore = page.requests.filter((r) => r.url.includes('/readDeadlines')).length;
  await evaluate(`(document.querySelector('nav.bottom-nav a[href="/checklist"]').click(), true)`);
  report('The checklist: the same card, from what’s kept (no second call to the function within four hours)', (await waitFor(`location.pathname === '/checklist' && ${has('Your deadlines')} && ${has('Log Task 3 submission (Fri, week 8)')}`)) && page.requests.filter((r) => r.url.includes('/readDeadlines')).length === callsBefore);

  await page.go('/deadlines');
  await waitFor(has('Forget this link'));
  await clickText('Forget this link');
  await waitFor(has('Forget the link?'));
  await clickText('Forget it');
  report('Forget this link: the page asks, then shows how to connect again, and nothing is left in storage', (await waitFor(has('Copy the link in Blackboard'))) && (await storageKeysWith(GOOD_ID)).length === 0 && (await storageKeysWith(KEY_PREFIX)).length === 0);
  await page.go('/home');
  report('Home offers to connect again', await waitFor(`document.querySelector('.deadlines a.do[href="/deadlines"]') !== null`));

  await page.go('/deadlines');
  await waitFor(`document.getElementById('calendar-link') !== null`);
  await fill('#calendar-link', LINKS.good);
  await press('Show my deadlines');
  report('Connected again', await waitFor(has('Log Task 3 submission (Fri, week 8)'), 30000));
  report('Logging out forgets the link and the deadlines on this phone', (await page.logOut()) && (await storageKeysWith(KEY_PREFIX)).length === 0 && (await storageKeysWith(GOOD_ID)).length === 0);
  report('Logged in again: not connected, and nothing of hers shows', (await page.logIn(nia.email, nia.password)) && (await waitFor(`document.querySelector('.deadlines a.do[href="/deadlines"]') !== null`)) && !(await evaluate(has('Log Task 3'))));
} finally {
  await page.close();
  app.stop();
  pretend.close();
}

const total = offline.length + 24;
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
