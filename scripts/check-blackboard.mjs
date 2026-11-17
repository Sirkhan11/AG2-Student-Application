// Checks the Blackboard connection (src/lib/server/blackboard and src/lib/server/firebase-token.js)
// offline, against the mock: sealed cookies and PKCE, the Firebase sign-in check, the sign-in address
// and token swap as Learn documents them, connecting end to end, what each module shows, that no
// grades, authors, other people, tokens or secrets reach the browser, the awkward cases (denied,
// forged, expired, removed, down, slow, no modules, someone else's browser), and that nothing can carry
// Blackboard data into Gemini. Nothing here goes to the network.
//
// With --build it also builds the app with made-up key, secret and cookie key values and checks
// none of them is anywhere in what the browser downloads (about a minute):
//   node scripts/check-blackboard.mjs [--build]

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { blackboardClient, SCOPE } from '#lib/server/blackboard/client.js';
import { blackboardSettings } from '#lib/server/blackboard/config.js';
import { challengeFor, newState, newVerifier, seal, unseal } from '#lib/server/blackboard/crypto.js';
import { finishConnect, readView, startConnect } from '#lib/server/blackboard/flow.js';
import { approve, deny, MOCK_APP_KEY, MOCK_APP_SECRET, MOCK_HOST, mockFetch } from '#lib/server/blackboard/mock.js';
import { plainText } from '#lib/server/blackboard/read.js';
import { verifyFirebaseIdToken } from '#lib/server/firebase-token.js';

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
  }]
];

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
