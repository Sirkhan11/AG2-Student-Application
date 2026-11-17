// Checks the Blackboard connection (src/lib/server/blackboard and src/lib/server/firebase-token.js)
// offline, against the mock: sealed cookies and PKCE, the Firebase sign-in check, the sign-in address
// and token swap as Learn documents them, connecting end to end, what each module shows, that no
// grades, authors, other people, tokens or secrets reach the browser, the awkward cases (denied,
// forged, expired, removed, down, slow, no modules, someone else's browser), and that nothing can carry
// Blackboard data into Gemini. And the page side: each module's most important thing, the calendar
// files for Outlook, what counts as new, and that only signed-in students see the section and logging
// out forgets the connection. Nothing here goes to the network.
//
// The pretend Allow page is also checked as a student uses it: a local dev server is started on a
// free port (BLACKBOARD_HOST=mock), and the page's own Allow and Deny forms are read from its HTML and
// submitted as a browser submits them, then followed through /blackboard/callback. (The checks before
// those call approve() and deny() directly, which can't notice a form that loses the sign-in request.)
//
// With --build it also builds the app with made-up key, secret and cookie key values and checks
// none of them is anywhere in what the browser downloads (about a minute):
//   node scripts/check-blackboard.mjs [--build]

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { blackboardClient, SCOPE } from '#lib/server/blackboard/client.js';
import { blackboardSettings } from '#lib/server/blackboard/config.js';
import { challengeFor, newState, newVerifier, seal, unseal } from '#lib/server/blackboard/crypto.js';
import { finishConnect, FLOW_COOKIE, NOT_REGISTERED, readView, SESSION_COOKIE, startConnect } from '#lib/server/blackboard/flow.js';
import { approve, deny, MOCK_APP_KEY, MOCK_APP_SECRET, MOCK_HOST, mockFetch } from '#lib/server/blackboard/mock.js';
import { plainText } from '#lib/server/blackboard/read.js';
import { verifyFirebaseIdToken } from '#lib/server/firebase-token.js';
import { deadlineEntry, eventEntry, icsFor } from '#lib/blackboard/ics.js';
import { outlookWebUrl } from '#lib/blackboard/outlook.js';
import { dueText, topThing } from '#lib/blackboard/priority.js';
import { closeGuide, forgetOnDevice, guideDone, markSeen, newIds } from '#lib/blackboard/seen.js';

const ORIGIN = 'http://localhost:5173';
const KEY = randomBytes(32);
const LINKS = { linkHost: `${ORIGIN}/blackboard/mock`, apiHost: MOCK_HOST };
const client = (timeoutMs = 10_000) =>
  blackboardClient({ host: MOCK_HOST, browserHost: `${ORIGIN}/blackboard/mock`, appKey: MOCK_APP_KEY, appSecret: MOCK_APP_SECRET, fetch: mockFetch, timeoutMs });

/** Everything sent to the browser in these checks (addresses, cookies, what the page gets), to search for secrets. */
const toBrowser = /** @type {string[]} */ ([]);
/** Every token the mock issued in these checks. */
const tokensSeen = new Set();

/**
 * Connects a made-up app user to the mock, choosing a scenario on its Allow page.
 * @param {string} uid
 * @param {string} [scenario]
 */
async function connect(uid, scenario = 'normal') {
  const { url, flow } = startConnect({ cookieKey: KEY, client: client(), uid, origin: ORIGIN });
  const q = new URL(url).searchParams;
  const back = approve({ clientId: q.get('client_id'), redirectUri: /** @type {string} */ (q.get('redirect_uri')), state: q.get('state'), codeChallenge: q.get('code_challenge'), method: q.get('code_challenge_method'), scenario });
  const b = new URL(back).searchParams;
  const done = await finishConnect({ cookieKey: KEY, client: client(), query: { code: b.get('code'), state: b.get('state'), error: b.get('error') }, flowCookie: flow, origin: ORIGIN });
  toBrowser.push(url, flow, back, done.redirect, done.session ?? '');
  const session = unseal(done.session, KEY);
  if (session) tokensSeen.add(session.access).add(session.refresh);
  return { ...done, url, flow, back };
}

/** @param {string | undefined} sessionCookie @param {string} uid @param {number} [timeoutMs] */
async function view(sessionCookie, uid, timeoutMs) {
  const result = await readView({ cookieKey: KEY, client: client(timeoutMs), sessionCookie, uid, origin: ORIGIN, links: LINKS, mock: true });
  toBrowser.push(JSON.stringify(result.view), result.session ?? '');
  const session = unseal(result.session, KEY);
  if (session) tokensSeen.add(session.access).add(session.refresh);
  return result;
}

/** A Firebase-style ID token signed with a made-up key, for the sign-in check. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
/** @param {object} payload @param {object} [header] */
const idToken = (payload, header = { alg: 'RS256', kid: 'made-up', typ: 'JWT' }) => {
  const part = (/** @type {object} */ value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part(header)}.${part(payload)}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
};
const seconds = Math.floor(Date.now() / 1000);
const GOOD = { aud: 'made-up-project', iss: 'https://securetoken.google.com/made-up-project', sub: 'student-1', iat: seconds - 60, auth_time: seconds - 60, exp: seconds + 3600 };
const certs = async () => ({ 'made-up': PEM });

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  ['Sealed cookies: the browser can neither read nor change them', () => {
    const sealed = seal({ access: 'secret-token', uid: 'u1' }, KEY);
    assert.deepEqual(unseal(sealed, KEY), { access: 'secret-token', uid: 'u1' });
    assert.ok(!sealed.includes('secret-token') && !Buffer.from(sealed, 'base64url').toString('latin1').includes('secret-token'));
    const flipped = Buffer.from(sealed, 'base64url');
    flipped[20] ^= 1;
    assert.equal(unseal(flipped.toString('base64url'), KEY), null, 'changed');
    assert.equal(unseal(sealed, randomBytes(32)), null, 'another key');
    assert.equal(unseal('not-a-cookie', KEY), null);
    assert.equal(unseal(undefined, KEY), null);
  }],
  ['PKCE: the example from RFC 7636, and fresh verifiers and states of the right form', () => {
    assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const verifier = newVerifier();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(verifier, newVerifier());
    assert.notEqual(newState(), newState());
  }],
  ['Settings: the mock needs nothing; the real Blackboard needs an https address, the key, the secret and a 32-byte cookie key', () => {
    const mock = blackboardSettings({ host: 'mock', appKey: '', appSecret: '', cookieKey: '' });
    assert.equal(mock.ready, true);
    assert.equal(mock.cookieKey?.length, 32);
    const cookieKey = randomBytes(32).toString('base64');
    assert.equal(blackboardSettings({ host: 'https://elp.northumbria.ac.uk', appKey: 'k', appSecret: 's', cookieKey }).ready, true);
    assert.match(String(blackboardSettings({ host: 'https://elp.northumbria.ac.uk', appKey: '', appSecret: 's', cookieKey }).problem), /APP_KEY/);
    assert.match(String(blackboardSettings({ host: 'http://elp.northumbria.ac.uk', appKey: 'k', appSecret: 's', cookieKey }).problem), /https/);
    assert.match(String(blackboardSettings({ host: 'https://elp.northumbria.ac.uk', appKey: 'k', appSecret: 's', cookieKey: 'too-short' }).problem), /COOKIE_KEY/);
    assert.match(String(blackboardSettings({ host: 'https://elp.northumbria.ac.uk', appKey: 'k', appSecret: 's', cookieKey: '' }).problem), /COOKIE_KEY/);
  }],
  ['The Firebase sign-in check: a good token passes; a changed, expired, other-project, unsigned or unknown-key one fails', async () => {
    const options = { projectId: 'made-up-project', certs };
    assert.deepEqual(await verifyFirebaseIdToken(idToken(GOOD), options), { uid: 'student-1' });
    const [h, , s] = idToken(GOOD).split('.');
    const changed = `${h}.${Buffer.from(JSON.stringify({ ...GOOD, sub: 'someone-else' })).toString('base64url')}.${s}`;
    await assert.rejects(verifyFirebaseIdToken(changed, options), /signature/);
    await assert.rejects(verifyFirebaseIdToken(idToken({ ...GOOD, exp: seconds - 10 }), options), /expired/);
    await assert.rejects(verifyFirebaseIdToken(idToken({ ...GOOD, aud: 'another' }), options), /another project/);
    await assert.rejects(verifyFirebaseIdToken(idToken(GOOD, { alg: 'none', kid: 'made-up' }), options), /kind of token/);
    await assert.rejects(verifyFirebaseIdToken(idToken(GOOD, { alg: 'RS256', kid: 'unknown' }), options), /Unknown signing key/);
    await assert.rejects(verifyFirebaseIdToken(null, options), /Not a token/);
  }],
  ['The sign-in address: Blackboard\'s own page, read-only scope, PKCE (S256), a state and our callback', () => {
    const live = blackboardClient({ host: 'https://elp.northumbria.ac.uk', appKey: 'app-key', appSecret: 'app-secret' });
    const url = new URL(live.authoriseUrl({ redirectUri: `${ORIGIN}/blackboard/callback`, state: 'st', codeChallenge: 'ch' }));
    assert.equal(`${url.origin}${url.pathname}`, 'https://elp.northumbria.ac.uk/learn/api/public/v1/oauth2/authorizationcode');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      redirect_uri: `${ORIGIN}/blackboard/callback`, response_type: 'code', client_id: 'app-key', scope: 'read offline', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256'
    });
    assert.equal(SCOPE, 'read offline');
    assert.ok(!url.href.includes('app-secret'));
  }],
  ['The token swap as Learn documents it: POST, Basic key and secret, code, address and verifier in the query, grant type in the body', async () => {
    /** @type {{ url: string, init: RequestInit }[]} */
    const calls = [];
    const fake = blackboardClient({
      host: 'https://elp.example', appKey: 'app-key', appSecret: 'app-secret',
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user_id: 'u' }), { status: 200 });
      }
    });
    await fake.exchangeCode({ code: 'the-code', redirectUri: `${ORIGIN}/blackboard/callback`, verifier: 'the-verifier' });
    await fake.refresh({ refreshToken: 'the-refresh', redirectUri: `${ORIGIN}/blackboard/callback` });
    const [swap, renew] = calls;
    assert.equal(swap.init.method, 'POST');
    assert.equal(new Headers(swap.init.headers).get('authorization'), `Basic ${Buffer.from('app-key:app-secret').toString('base64')}`);
    assert.deepEqual(Object.fromEntries(new URL(swap.url).searchParams), { code: 'the-code', redirect_uri: `${ORIGIN}/blackboard/callback`, code_verifier: 'the-verifier' });
    assert.equal(swap.init.body, 'grant_type=authorization_code');
    assert.deepEqual(Object.fromEntries(new URL(renew.url).searchParams), { refresh_token: 'the-refresh', redirect_uri: `${ORIGIN}/blackboard/callback` });
    assert.equal(renew.init.body, 'grant_type=refresh_token');
  }],
  ['Connecting end to end with the mock: allow, the callback, then this term\'s modules only', async () => {
    const done = await connect('student-a');
    assert.equal(done.redirect, '/checklist?blackboard=connected#blackboard');
    assert.ok(done.session);
    assert.ok(new URL(done.url).href.startsWith(`${ORIGIN}/blackboard/mock/learn/api/public/v1/oauth2/authorizationcode?`));
    const { view: shown } = await view(done.session, 'student-a');
    assert.equal(shown.connected, true);
    assert.ok('modules' in shown);
    assert.deepEqual(shown.modules.map((module) => module.name), ['Programming Fundamentals', 'Academic Writing and Study Skills', 'Data and Society', 'Team Project'], 'not last year\'s, a hidden one or an organisation');
  }],
  ['Each module: deadlines soonest first (overdue too), due dates from the calendar when the gradebook is hidden, events, newest content first, plain-text announcements', async () => {
    const { session } = await connect('student-a');
    const { view: shown } = await view(session, 'student-a');
    assert.ok('modules' in shown);
    const [programming, writing, , team] = shown.modules;
    assert.deepEqual(programming.tasks.map((task) => task.title), ['Assignment 1: Portfolio', 'Quiz 3', 'Assignment 2: Programming project'], 'no total, no repeat from the calendar');
    assert.ok(Date.parse(programming.tasks[0].due) < Date.now(), 'the overdue one is kept');
    assert.deepEqual(writing.partial, ['tasks']);
    assert.deepEqual(writing.tasks.map((task) => task.title), ['Reflective log']);
    assert.deepEqual(programming.events.map((event) => event.title), ['In-class test']);
    assert.deepEqual(team.events.map((event) => event.title), ['Guest lecture: working in teams']);
    assert.equal(programming.content.length, 24, 'both pages of content');
    assert.ok(programming.content.every((item, i, all) => i === 0 || Date.parse(all[i - 1].created) >= Date.parse(item.created)));
    assert.ok(programming.content.every((item) => item.url?.startsWith(`${ORIGIN}/blackboard/mock/ultra/courses/_3101_1/`)));
    assert.equal(programming.url, `${ORIGIN}/blackboard/mock/ultra/courses/_3101_1/outline`);
    assert.deepEqual(programming.announcements.map((a) => a.text), ['This week’s lab is in room CIS 204, not the usual room. See you there!']);
    assert.equal(plainText('<p>A &amp; B</p><p>C&nbsp;D</p>'), 'A & B C D');
  }],
  ['Never grades, scores, authors, other people or personal calendar entries; never a token, the secret or the cookie key', async () => {
    const { session } = await connect('student-a');
    const { view: shown } = await view(session, 'student-a');
    const json = JSON.stringify(shown);
    for (const banned of ['score', 'possible', 'creator', 'createdByUserId', 'userId', 'courseRoleId', '_88_1', '_7701_1', 'Dentist', 'Reading week', 'Total']) {
      assert.ok(!json.includes(banned), `the page got "${banned}"`);
    }
    const everything = toBrowser.join('\n');
    assert.ok(tokensSeen.size >= 2);
    for (const token of tokensSeen) if (token) assert.ok(!everything.includes(token), 'a token reached the browser');
    assert.ok(!everything.includes(MOCK_APP_SECRET), 'the secret reached the browser');
    assert.ok(!everything.includes(KEY.toString('base64')) && !everything.includes(KEY.toString('base64url')), 'the cookie key reached the browser');
  }],
  ['Denied, a forged callback, an old sign-in or a reused code all go back to the checklist without connecting', async () => {
    const { url, flow } = startConnect({ cookieKey: KEY, client: client(), uid: 'student-a', origin: ORIGIN });
    const q = new URL(url).searchParams;
    const denied = new URL(deny({ redirectUri: /** @type {string} */ (q.get('redirect_uri')), state: q.get('state') })).searchParams;
    assert.deepEqual(await finishConnect({ cookieKey: KEY, client: client(), query: { code: null, state: denied.get('state'), error: denied.get('error') }, flowCookie: flow, origin: ORIGIN }), { redirect: '/checklist?blackboard=denied#blackboard' });
    const allowed = new URL(approve({ clientId: q.get('client_id'), redirectUri: /** @type {string} */ (q.get('redirect_uri')), state: q.get('state'), codeChallenge: q.get('code_challenge'), method: 'S256', scenario: 'normal' })).searchParams;
    const query = { code: allowed.get('code'), state: allowed.get('state'), error: null };
    assert.equal((await finishConnect({ cookieKey: KEY, client: client(), query: { ...query, state: 'forged' }, flowCookie: flow, origin: ORIGIN })).redirect, '/checklist?blackboard=failed#blackboard');
    assert.equal((await finishConnect({ cookieKey: KEY, client: client(), query, flowCookie: flow, origin: ORIGIN, now: Date.now() + 11 * 60_000 })).redirect, '/checklist?blackboard=failed#blackboard');
    assert.equal((await finishConnect({ cookieKey: KEY, client: client(), query, flowCookie: undefined, origin: ORIGIN })).redirect, '/checklist?blackboard=failed#blackboard', 'no flow cookie');
    assert.ok((await finishConnect({ cookieKey: KEY, client: client(), query, flowCookie: flow, origin: ORIGIN })).session, 'the real one works once');
    assert.equal((await finishConnect({ cookieKey: KEY, client: client(), query, flowCookie: flow, origin: ORIGIN })).session, undefined, 'and not twice');
  }],
  ['An expired access token is refreshed quietly, and the new one is kept', async () => {
    const { session } = await connect('student-a', 'expired');
    const first = await view(session, 'student-a');
    assert.equal(first.view.connected, true);
    assert.ok('modules' in first.view && first.view.modules.length === 4);
    assert.equal(typeof first.session, 'string', 'the refreshed tokens are sealed into the cookie');
    const second = await view(/** @type {string} */ (first.session), 'student-a');
    assert.ok('modules' in second.view);
    assert.equal(second.session, undefined, 'no refresh needed now');
  }],
  ['A connection removed in Blackboard asks to reconnect, and the cookie is deleted', async () => {
    const { session } = await connect('student-a', 'revoked');
    assert.deepEqual(await view(session, 'student-a'), { view: { connected: false, reason: 'reconnect' }, session: null });
  }],
  ['Blackboard down or too slow: "isn\'t answering", and the connection is kept', async () => {
    const down = await view((await connect('student-a', 'down')).session, 'student-a');
    assert.deepEqual(down.view, { connected: true, error: 'unavailable' });
    assert.equal(down.status, 503);
    assert.equal(down.session, undefined);
    const quiet = console.error;
    console.error = () => {};
    try {
      const slow = await view((await connect('student-a', 'slow')).session, 'student-a', 300);
      assert.deepEqual(slow.view, { connected: true, error: 'unavailable' });
    } finally {
      console.error = quiet;
    }
  }],
  ['No modules this term: an empty list, not an error', async () => {
    const { view: shown } = await view((await connect('student-a', 'no-modules')).session, 'student-a');
    assert.ok('modules' in shown);
    assert.deepEqual(shown.modules, []);
  }],
  ['Someone else\'s connection on the same browser is never shown, and is forgotten; no cookie means not connected', async () => {
    const { session } = await connect('student-a');
    assert.deepEqual(await view(session, 'student-b'), { view: { connected: false, reason: 'not-connected' }, session: null });
    assert.deepEqual(await view(undefined, 'student-a'), { view: { connected: false, reason: 'not-connected' }, session: undefined });
    assert.deepEqual(await view('made-up-cookie', 'student-a'), { view: { connected: false, reason: 'not-connected' }, session: null });
  }],
  ['Each module\'s most important thing: a passed due date, then one due within a week, a new announcement, new content, the next deadline, or nothing new', () => {
    const NOW = Date.parse('2026-11-17T12:00:00Z');
    const day = (/** @type {number} */ n) => new Date(NOW + n * 86_400_000).toISOString();
    /** @param {Partial<import('#lib/blackboard/shapes.js').Module>} parts @returns {import('#lib/blackboard/shapes.js').Module} */
    const module = (parts) => ({ id: 'm', code: 'C', name: 'N', url: null, tasks: [], events: [], content: [], announcements: [], partial: [], ...parts });
    const task = (/** @type {string} */ title, /** @type {number} */ days) => ({ id: title, title, due: day(days), url: null });
    const news = { announcements: [{ id: 'a', title: 'Announced', text: '', posted: day(-1) }], content: [{ id: 'c', title: 'Released', created: day(-1), kind: /** @type {'item'} */ ('item'), url: null }] };
    const all = new Set(['a', 'c']);
    assert.equal(topThing(module({ tasks: [task('Late', -2), task('Soon', 2)], ...news }), all, NOW).kind, 'past-due');
    assert.equal(topThing(module({ tasks: [task('Soon', 2), task('Later', 20)], ...news }), all, NOW).title, 'Soon');
    assert.equal(topThing(module({ tasks: [task('Later', 20)], ...news }), all, NOW).kind, 'announcement');
    assert.equal(topThing(module({ tasks: [task('Later', 20)], ...news }), new Set(['c']), NOW).kind, 'content');
    assert.equal(topThing(module({ tasks: [task('Later', 20)], ...news }), new Set(), NOW).kind, 'next');
    assert.deepEqual(topThing(module({}), new Set(), NOW), { kind: 'nothing', title: 'Nothing new', date: null });
    assert.match(dueText(day(-2), NOW), /^was due 2 days ago$/);
    assert.match(dueText(day(1), NOW), /^due tomorrow at \d\d:\d\d$/);
    assert.match(dueText(day(9), NOW), /^due [A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2}$/);
  }],
  ['Add to Outlook: a standard calendar file, in UTC, with a reminder the day before; a deadline is the half hour before it\'s due', () => {
    const text = icsFor(deadlineEntry({ id: 't1', title: 'Essay, part 1; final', due: '2026-11-20T14:00:00.000Z', url: 'https://example.test/item' }, 'Made-Up Module'), Date.parse('2026-11-17T12:00:00Z'));
    const lines = text.split('\r\n');
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.equal(lines.at(-1), '', 'ends with a line break');
    assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'CRLF line ends only');
    assert.ok(lines.includes('DTSTART:20261120T133000Z') && lines.includes('DTEND:20261120T140000Z'));
    assert.ok(lines.includes('UID:deadline-t1@ag2-student-app'));
    assert.ok(lines.includes('SUMMARY:Due: Essay\\, part 1\\; final (Made-Up Module)'), 'commas and semicolons escaped');
    assert.ok(lines.includes('TRIGGER:-P1D') && lines.includes('BEGIN:VALARM'));
    assert.ok(lines.every((line) => new TextEncoder().encode(line).length <= 75), 'long lines folded');
    const event = icsFor(eventEntry({ id: 'e1', title: 'In-class test', start: '2026-11-22T10:00:00.000Z', end: null }, 'M'));
    assert.ok(event.includes('DTSTART:20261122T100000Z\r\nDTEND:20261122T110000Z'), 'an hour long with no end');
  }],
  ['"Add to calendar" offers both: Outlook on the web (UTC times ending in Z) and a calendar file; made on the phone, nothing sent to our server', () => {
    const url = new URL(outlookWebUrl(deadlineEntry({ id: 't1', title: 'Essay, part 1', due: '2026-11-20T14:00:00.000Z', url: null }, 'Made-Up Module')));
    assert.equal(`${url.origin}${url.pathname}`, 'https://outlook.office.com/calendar/0/deeplink/compose');
    assert.equal(url.searchParams.get('subject'), 'Due: Essay, part 1 (Made-Up Module)');
    assert.equal(url.searchParams.get('startdt'), '2026-11-20T13:30:00Z');
    assert.equal(url.searchParams.get('enddt'), '2026-11-20T14:00:00Z');
    assert.equal(url.searchParams.get('rru'), 'addevent');
    assert.equal(url.searchParams.get('path'), '/calendar/action/compose');
    assert.ok(/Essay, part 1 is due/.test(url.searchParams.get('body') ?? ''));
    const button = readFileSync('src/lib/components/AddToCalendar.svelte', 'utf8');
    assert.match(button, /outlookWebUrl\(entry\)/);
    assert.match(button, /downloadIcs\(entry\)/);
    for (const file of ['src/lib/components/AddToCalendar.svelte', 'src/lib/blackboard/outlook.js', 'src/lib/blackboard/ics.js']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\bfetch\(|\/api\//, `${file} sends nothing to the server`);
    }
    const section = readFileSync('src/lib/components/BlackboardSection.svelte', 'utf8');
    assert.equal([...section.matchAll(/<AddToCalendar /g)].length, 3, 'one button per date: the top thing, each deadline, each event');
    assert.doesNotMatch(section, /Add to Outlook/);
  }],
  ['After Disconnect: how to revoke AG2 in Blackboard too (Tools, Application Authorization, Revoke), marked to check on Northumbria\'s Blackboard', () => {
    const section = readFileSync('src/lib/components/BlackboardSection.svelte', 'utf8');
    assert.match(section, /go to Tools, then Application Authorization, and choose Revoke next to AG2/);
    assert.match(section, /Authorize access to\s*(?:\/\/\s*)?integrated apps/);
    assert.match(section, /Still to check on Northumbria’s Blackboard once IT registers the app|Still to check on Northumbria's Blackboard once IT registers the app/);
  }],
  ['What counts as new is kept on the device per student (ids only): the first time, the last 7 days; then anything not seen; logging out or disconnecting deletes it', () => {
    const store = new Map();
    const storage = { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v), removeItem: (/** @type {string} */ k) => void store.delete(k) };
    const NOW = Date.parse('2026-11-17T12:00:00Z');
    const ago = (/** @type {number} */ days) => new Date(NOW - days * 86_400_000).toISOString();
    /** @type {import('#lib/blackboard/shapes.js').Module} */
    const module = { id: 'm1', code: 'C', name: 'N', url: null, tasks: [], events: [], partial: [],
      content: [{ id: 'old', title: 'Old', created: ago(20), kind: 'item', url: null }, { id: 'recent', title: 'Recent', created: ago(2), kind: 'item', url: null }],
      announcements: [{ id: 'news', title: 'News', text: 'x', posted: ago(1) }] };
    assert.deepEqual([...newIds('student-a', module, NOW, storage)].sort(), ['news', 'recent']);
    markSeen('student-a', module, storage);
    assert.deepEqual([...newIds('student-a', module, NOW, storage)], []);
    const later = { ...module, content: [...module.content, { id: 'week9', title: 'Week 9', created: ago(40), kind: /** @type {'folder'} */ ('folder'), url: null }] };
    assert.deepEqual([...newIds('student-a', later, NOW, storage)], ['week9'], 'released later but made long ago still counts as new');
    assert.ok(!JSON.stringify([...store.values()]).includes('Week 9'), 'no titles kept');
    assert.deepEqual([...newIds('student-b', module, NOW, storage)].sort(), ['news', 'recent'], 'per student');
    assert.equal(guideDone('student-a', storage), false);
    closeGuide('student-a', storage);
    assert.equal(guideDone('student-a', storage), true);
    forgetOnDevice('student-a', storage);
    assert.equal(store.size, 0);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => { newIds('student-a', module, NOW, blocked); markSeen('student-a', module, blocked); forgetOnDevice('student-a', blocked); });
  }],
  ['The section is only for signed-in students, logging out forgets the connection, and the browser code never handles a Blackboard token', () => {
    const checklist = readFileSync('src/routes/checklist/+page.svelte', 'utf8');
    assert.match(checklist, /\{#if signedIn === true\}\s*<BlackboardSection \/>\s*\{\/if\}/);
    const logout = readFileSync('src/lib/components/LogoutButton.svelte', 'utf8');
    assert.ok(logout.indexOf('disconnectBlackboard()') !== -1 && logout.indexOf('disconnectBlackboard()') < logout.indexOf('signOut(getFirebaseAuth())'), 'disconnect before signing out');
    const browserCode = [...walk('src/lib/blackboard'), 'src/lib/components/BlackboardSection.svelte'].map((file) => readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(browserCode, /access_token|refresh_token|BLACKBOARD_APP|\$app\/env\/private/);
    assert.doesNotMatch(readFileSync('src/lib/components/BlackboardSection.svelte', 'utf8'), /localStorage|sessionStorage/, 'storage only through seen.js');
    assert.match(readFileSync('src/lib/components/BlackboardSection.svelte', 'utf8'), /id="blackboard"/, 'the Late arrivals page links here');
  }],
  ['Nothing from Blackboard can reach Gemini: no chat code imports Blackboard code, and no Blackboard code imports Gemini', () => {
    const chatFiles = [...walk('src/lib/checkin'), ...walk('src/routes/check-in')];
    for (const file of chatFiles) {
      for (const reached of reachable(file)) assert.ok(!/src\/lib\/(blackboard|server)\//.test(reached), `${file} reaches ${reached}`);
    }
    const blackboardFiles = [...walk('src/lib/blackboard'), ...walk('src/lib/server'), ...walk('src/routes/api/blackboard'), ...walk('src/routes/blackboard')];
    assert.ok(blackboardFiles.length >= 8);
    for (const file of blackboardFiles) {
      for (const reached of reachable(file)) assert.ok(!/firebase\/ai|checkin\//.test(reached), `${file} reaches ${reached}`);
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"](?:firebase\/ai|#lib\/firebase\/ai\.js|#lib\/checkin\/)/, file);
    }
  }],

  // ---------- The pretend Allow page itself, through a local dev server ----------
  ['The pretend Allow page: its own Allow form, submitted as a browser does, goes back to the callback with a code and the same state, and connects', async () => {
    const server = await devServer();
    const page = await openAllowPage(server);
    const allow = page.forms.find((form) => form.button === 'Allow');
    assert.ok(allow, 'an Allow form');
    assert.equal(allow.method, 'POST');
    assert.equal(allow.body.get('scenario'), 'normal', 'the first scenario is chosen');
    const response = await submit(server, allow);
    assert.equal(response.status, 303, `Allow answered ${response.status}: ${(await response.text()).replace(/\s+/g, ' ').slice(0, 120)}`);
    const back = new URL(/** @type {string} */ (response.headers.get('location')), server.base);
    assert.equal(`${back.origin}${back.pathname}`, `${server.base}/blackboard/callback`);
    assert.match(back.searchParams.get('code') ?? '', /^mock-code-/);
    assert.equal(back.searchParams.get('state'), page.state);
    const done = await fetch(back, { redirect: 'manual', headers: { cookie: `${FLOW_COOKIE}=${page.flow}` } });
    assert.equal(done.status, 303);
    assert.equal(done.headers.get('location'), '/checklist?blackboard=connected#blackboard');
    assert.ok(done.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && /HttpOnly/i.test(cookie)), 'the sealed session cookie is set');
  }],
  ['The pretend Allow page: its own Deny form goes back to the callback with access_denied and the same state, and nothing is connected', async () => {
    const server = await devServer();
    const page = await openAllowPage(server);
    const deny = page.forms.find((form) => form.button === 'Deny');
    assert.ok(deny, 'a Deny form');
    const response = await submit(server, deny);
    assert.equal(response.status, 303, `Deny answered ${response.status}: ${(await response.text()).replace(/\s+/g, ' ').slice(0, 120)}`);
    const back = new URL(/** @type {string} */ (response.headers.get('location')), server.base);
    assert.equal(`${back.origin}${back.pathname}`, `${server.base}/blackboard/callback`);
    assert.equal(back.searchParams.get('error'), 'access_denied');
    assert.equal(back.searchParams.get('state'), page.state);
    const done = await fetch(back, { redirect: 'manual', headers: { cookie: `${FLOW_COOKIE}=${page.flow}` } });
    assert.equal(done.headers.get('location'), '/checklist?blackboard=denied#blackboard');
    assert.ok(!done.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)), 'no session cookie');
  }],
  ['Blackboard’s "Application not registered with site" (until IT register AG2) gets its own message, with or without the state; any other error stays "failed"', async () => {
    const { url, flow } = startConnect({ cookieKey: KEY, client: client(), uid: 'student-not-registered', origin: ORIGIN });
    const state = new URL(url).searchParams.get('state');
    const notRegistered = { code: null, error: 'invalid_request', errorDescription: 'Application not registered with site' };
    for (const query of [{ ...notRegistered, state }, { ...notRegistered, state: null }, { ...notRegistered, state: 'forged' }]) {
      assert.deepEqual(await finishConnect({ cookieKey: KEY, client: client(), query, flowCookie: flow, origin: ORIGIN }), { redirect: '/checklist?blackboard=not-registered#blackboard' }, `state ${query.state}`);
    }
    for (const [error, errorDescription] of [['invalid_request', 'Missing redirect_uri'], ['invalid_request', null], ['server_error', 'Application not registered with site'],
      ['invalid_request', 'application not registered with site.'], ['access_denied', 'Application not registered with site']]) {
      const { redirect } = await finishConnect({ cookieKey: KEY, client: client(), query: { code: null, state, error, errorDescription }, flowCookie: flow, origin: ORIGIN });
      assert.equal(redirect, error === 'access_denied' ? '/checklist?blackboard=denied#blackboard' : '/checklist?blackboard=failed#blackboard', `${error} / ${errorDescription}`);
    }
    assert.deepEqual(NOT_REGISTERED, { error: 'invalid_request', description: 'Application not registered with site' });
  }],
  ['The section says so in its own words and never shows Blackboard’s text; the callback passes the description only to compare it', () => {
    const section = readFileSync('src/lib/components/BlackboardSection.svelte', 'utf8');
    assert.match(section, /'not-registered': 'Northumbria’s Blackboard hasn’t switched AG2 on yet, so it can’t connect for now\. Please try again later\.'/);
    assert.doesNotMatch(section, /error_description|errorDescription|not registered with site/i);
    assert.match(readFileSync('src/routes/blackboard/callback/+server.js', 'utf8'), /errorDescription: url\.searchParams\.get\('error_description'\)/);
  }],
  ['The pretend Allow page: choosing "not registered" and pressing Allow comes back through the callback as not-registered', async () => {
    const server = await devServer();
    const page = await openAllowPage(server);
    const allow = /** @type {Form} */ (page.forms.find((form) => form.button === 'Allow'));
    allow.body.set('scenario', 'not-registered');
    const response = await submit(server, allow);
    assert.equal(response.status, 303);
    const back = new URL(/** @type {string} */ (response.headers.get('location')), server.base);
    assert.equal(back.searchParams.get('error_description'), 'Application not registered with site');
    const done = await fetch(back, { redirect: 'manual', headers: { cookie: `${FLOW_COOKIE}=${page.flow}` } });
    assert.equal(done.headers.get('location'), '/checklist?blackboard=not-registered#blackboard');
    assert.ok(!done.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)), 'no session cookie');
  }],
  ['The pretend Allow page: what its forms post is checked as the page is (another site\'s callback, no address, another app), and the old bare "?/allow" is refused', async () => {
    const server = await devServer();
    const page = await openAllowPage(server);
    const allow = /** @type {Form} */ (page.forms.find((form) => form.button === 'Allow'));
    /** @param {(query: URLSearchParams) => void} change */
    const changed = (change) => {
      const url = new URL(allow.action);
      change(url.searchParams);
      return url.href;
    };
    for (const [why, action] of [
      ['another site’s callback', changed((query) => query.set('redirect_uri', 'https://evil.example/blackboard/callback'))],
      ['no redirect address', changed((query) => query.delete('redirect_uri'))],
      ['another app', changed((query) => query.set('client_id', 'someone-else'))],
      ['the old bare ?/allow', new URL('?/allow', page.url).href]
    ]) {
      const response = await submit(server, allow, action);
      assert.equal(response.status, 400, `${why}: answered ${response.status}`);
    }
  }]
];

/** @typedef {{ button: string | undefined, method: string, action: string, body: URLSearchParams }} Form */
/** @typedef {{ base: string, cookieKey: Buffer, stop: () => void }} DevServer */

/** @type {Promise<DevServer> | undefined} */
let started;
/** The local dev server for the page checks, started once on a free port (mock Blackboard). */
const devServer = () => (started ??= startDevServer());

/** @returns {Promise<DevServer>} */
async function startDevServer() {
  const port = await new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = /** @type {import('node:net').AddressInfo} */ (probe.address());
      probe.close(() => done(free));
    });
  });
  const cookieKey = randomBytes(32);
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, BLACKBOARD_HOST: 'mock', BLACKBOARD_COOKIE_KEY: cookieKey.toString('base64') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  const stop = () => child.kill();
  for (let tries = 0; tries < 120; tries++) {
    if (child.exitCode !== null) throw new Error(`the dev server stopped:\n${output.split('\n').slice(-8).join('\n')}`);
    const ready = await fetch(`${base}/`).then((response) => response.status < 500, () => false);
    if (ready) return { base, cookieKey, stop };
    await new Promise((wait) => setTimeout(wait, 500));
  }
  stop();
  throw new Error('the dev server didn’t start within a minute');
}

/**
 * Opens the pretend Allow page as the app sends a student there (the same sign-in address and
 * flow cookie as /api/blackboard/connect makes), and reads its forms as a browser would: each
 * form's action resolved against the page's address, and the fields it would send.
 * @param {DevServer} server
 */
async function openAllowPage(server) {
  const client = blackboardClient({ host: MOCK_HOST, browserHost: `${server.base}/blackboard/mock`, appKey: MOCK_APP_KEY, appSecret: MOCK_APP_SECRET, fetch: mockFetch });
  const { url, flow } = startConnect({ cookieKey: server.cookieKey, client, uid: 'page-check-student', origin: server.base });
  const response = await fetch(url);
  assert.equal(response.status, 200, `the page answered ${response.status}`);
  const { document } = parseHTML(await response.text());
  /** @type {Form[]} */
  const forms = [...document.querySelectorAll('form')].map((form) => ({
    button: form.querySelector('button')?.textContent?.trim(),
    method: (form.getAttribute('method') ?? 'GET').toUpperCase(),
    action: new URL(form.getAttribute('action') ?? '', url).href,
    body: new URLSearchParams(
      [...form.querySelectorAll('input[name], select[name], textarea[name]')]
        .filter((field) => !['radio', 'checkbox'].includes(field.getAttribute('type') ?? '') || field.hasAttribute('checked'))
        .map((field) => [field.getAttribute('name') ?? '', field.getAttribute('value') ?? 'on'])
    )
  }));
  return { url, flow, state: new URL(url).searchParams.get('state'), forms };
}

/**
 * Submits a form as a browser does (a same-site POST of its fields), without following the redirect.
 * @param {DevServer} server @param {Form} form @param {string} [action] a changed address, to try tampering
 */
function submit(server, form, action = form.action) {
  return fetch(action, {
    method: form.method,
    redirect: 'manual',
    body: form.body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: server.base, accept: 'text/html' }
  });
}

/** Every .js and .svelte file under a folder. @param {string} folder @returns {string[]} */
function walk(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(js|svelte)$/.test(name) ? [path] : [];
  });
}

/** Every file in src a file imports, directly or through others. @param {string} start */
function reachable(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!spec) continue;
      if (spec.startsWith('#lib/')) queue.push(join('src/lib', spec.slice(5)));
      else if (spec.startsWith('$lib/')) queue.push(join('src/lib', spec.slice(5)));
      else if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec).replace(`${resolve('.')}/`, ''));
      else seen.add(spec);
    }
  }
  seen.delete(start);
  return [...seen];
}

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
if (started) (await started.catch(() => null))?.stop();
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

if (process.argv.includes('--build')) {
  const markers = { BLACKBOARD_APP_KEY: 'marker-app-key-5e1f', BLACKBOARD_APP_SECRET: 'marker-app-secret-9c3d', BLACKBOARD_COOKIE_KEY: Buffer.alloc(32, 7).toString('base64') };
  console.log('\nBuilding the app with made-up key, secret and cookie key values...');
  const build = spawnSync('npx', ['vite', 'build'], { encoding: 'utf8', env: { ...process.env, BLACKBOARD_HOST: 'https://elp.northumbria.ac.uk', ...markers }, timeout: 300_000 });
  if (build.status !== 0) {
    console.log(`FAIL  the build didn't finish:\n${(build.stdout + build.stderr).split('\n').slice(-15).join('\n')}`);
    failed++;
  } else {
    const files = walk('.svelte-kit/output/client').concat(walkAll('.svelte-kit/output/client'));
    const found = files.filter((file) => Object.values(markers).some((marker) => readFileSync(file, 'latin1').includes(marker)));
    console.log(found.length ? `FAIL  in what the browser downloads: ${found.join(', ')}` : `PASS  none of them is in the ${files.length} files the browser downloads`);
    if (found.length) failed++;
  }
}

/** Every file under a folder (built assets of any kind). @param {string} folder @returns {string[]} */
function walkAll(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walkAll(path) : /\.(js|svelte)$/.test(name) ? [] : [path];
  });
}
process.exit(failed === 0 ? 0 : 1);
