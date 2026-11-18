// Checks that AG2 is for verified Northumbria accounts only, unless the access switch is off.
// 1. Offline: which addresses count (uni-email.js), the access switch's reading and wording
//    (access.js), which screen a signed-in account sees (account-gate.js), the sign-up waiting in the
//    tab (signup/waiting.js), that the forms and the sign-up code turn other addresses away (and take
//    any address with the switch off), and that every rule in firestore.rules needs hasAccess().
// 2. In the Firebase emulators, with the real firestore.rules. Nothing real is touched (project
//    demo-ag2) and no email is sent: the Auth emulator keeps the verification links.
//    - Who may read and write: a verified Northumbria address (in any case) and the three test
//      accounts may; an unverified one, other addresses, lookalikes and signed-out visitors may not.
//    - The switch (config/access, uniOnly): with it false, any verified address may; unverified ones
//      and signed-out visitors still may not; anything but false (true, a string, no field, no
//      document) means Northumbria only; anyone can read it and nobody can write it from the app.
//    - Signing up as the app does: the account is made and the email sent, nothing is saved until
//      the link is clicked, then finishSignUp saves the student's record or the mentor's profile;
//      with the switch off, the same from an address anywhere. Opened afresh after clicking the
//      link, the saved token still says unverified, so the layout gets a fresh one before saving.
// Run from the project folder. The emulators need Java 21 or newer, and --engine-strict=false is for
// this project's .npmrc (firebase-tools lists Node 20 to 24, but runs on newer):
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-uni-rules.mjs"
// or just `node scripts/check-uni-rules.mjs` for part 1.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { applyActionCode, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, reload } from 'firebase/auth';
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ACCESS_COLLECTION, ACCESS_DOCUMENT, fieldsFrom, isAllowedEmail, readUniOnly, uniOnlyFrom, wordingFor } from '#lib/access.js';
import { ALWAYS_OPEN, gateFor, PUBLIC_PAGES } from '#lib/account-gate.js';
import { firstName, greetingFor } from '#lib/students/greeting.js';
import { checkVerified, freshVerifiedToken, sendVerification } from '#lib/firebase/verify.js';
import { finishSignUp } from '#lib/signup/finish.js';
import { waitingSignUp } from '#lib/signup/waiting.js';
import { loadDetailsNeeded, needsDetails, saveStudentDetails, signUpStudent } from '#lib/students/signup.js';
import { isUniEmail, NOT_UNI_EMAIL, UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';

const RULES = readFileSync('firestore.rules', 'utf8');
/** The test accounts' uids, as firestore.rules lists them. */
const TEST_UIDS = [...(RULES.match(/function isTestAccount\(\) \{[\s\S]*?\}/)?.[0] ?? '').matchAll(/'([A-Za-z0-9]{28})'/g)].map((m) => m[1]);

/** Storage that lives in memory, standing in for the tab's sessionStorage. */
function memoryStorage() {
  const items = new Map();
  return {
    getItem: (/** @type {string} */ key) => items.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => void items.set(key, value),
    removeItem: (/** @type {string} */ key) => void items.delete(key)
  };
}

const DETAILS = { name: 'Sam Student', course: 'BSc Computer Science', interests: 'chess, gigs', arrivalDate: '2026-09-20', password: 'not-a-real-password-1' };

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['Northumbria addresses count, in any case; other domains, subdomains and lookalikes don’t', () => {
    for (const email of ['sam.student@northumbria.ac.uk', 'W21012345@Northumbria.AC.UK', '  sam@northumbria.ac.uk ']) assert.equal(isUniEmail(email), true, email);
    for (const email of ['sam@gmail.com', 'sam@live.northumbria.ac.uk', 'sam@northumbria.ac.uk.example.com', 'sam@notnorthumbria.ac.uk',
      'northumbria.ac.uk@example.com', '@northumbria.ac.uk', 'sam @northumbria.ac.uk', 'sam@northumbria.ac', '', null, undefined, 42]) {
      assert.equal(isUniEmail(email), false, String(email));
    }
    assert.match(UNI_EMAIL_MESSAGE, /Northumbria email address \(ending @northumbria\.ac\.uk\)/);
  }],
  ['The access switch: only the exact value false opens the app to any address (no document, no field or anything else: Northumbria only), and the wording follows it', () => {
    assert.equal(uniOnlyFrom(undefined), true, 'no document');
    assert.equal(uniOnlyFrom({}), true, 'no field');
    assert.equal(uniOnlyFrom({ uniOnly: true }), true);
    assert.equal(uniOnlyFrom({ uniOnly: 'false' }), true, 'a string');
    assert.equal(uniOnlyFrom({ uniOnly: 0 }), true, 'a number');
    assert.equal(uniOnlyFrom({ uniOnly: null }), true, 'null');
    assert.equal(uniOnlyFrom({ uniOnly: false }), false, 'exactly false');
    assert.equal(`${ACCESS_COLLECTION}/${ACCESS_DOCUMENT}`, 'config/access', 'the document the rules read');
    assert.deepEqual(fieldsFrom({ uniOnly: { booleanValue: false }, note: { stringValue: 'x' }, n: { integerValue: '3' }, nothing: { nullValue: null }, when: { timestampValue: '2026-01-01T00:00:00Z' } }),
      { uniOnly: false, note: 'x', n: 3, nothing: null, when: { timestampValue: '2026-01-01T00:00:00Z' } }, 'the REST API’s fields as plain values');
    assert.equal(fieldsFrom(undefined), undefined, 'a document with no fields');
    assert.equal(uniOnlyFrom(fieldsFrom({ uniOnly: { booleanValue: false } })), false);
    assert.equal(uniOnlyFrom(fieldsFrom({ uniOnly: { stringValue: 'false' } })), true, 'a string, as the console could hold');
    for (const uniOnly of [true, null, undefined]) {
      assert.equal(isAllowedEmail('sam@northumbria.ac.uk', uniOnly), true, `Northumbria, switch ${uniOnly}`);
      assert.equal(isAllowedEmail('sam@gmail.com', uniOnly), false, `Gmail, switch ${uniOnly}`);
    }
    assert.equal(isAllowedEmail('sam@gmail.com', false), true, 'Gmail, switch off');
    assert.equal(isAllowedEmail('sam@northumbria.ac.uk', false), true, 'Northumbria, switch off');
    assert.equal(isAllowedEmail(undefined, false), false, 'no address at all');
    const on = wordingFor(true);
    assert.deepEqual([on.emailLabel, on.emailPlaceholder, on.inboxHeading, on.testingNote], ['Northumbria email address', 'ending @northumbria.ac.uk', 'Check your uni inbox', '']);
    assert.match(on.wrongAddress, /with your Northumbria email\.$/);
    assert.deepEqual(wordingFor(null), on, 'not read yet: as if on');
    assert.deepEqual(wordingFor(undefined), on, 'left out: as if on');
    const off = wordingFor(false);
    assert.deepEqual([off.emailLabel, off.emailPlaceholder, off.inboxHeading, off.testingNote], ['Email address', undefined, 'Check your inbox', 'Testing: open to any email address']);
    assert.doesNotMatch(JSON.stringify(off), /Northumbria|uni /, 'nothing about Northumbria with the switch off');
  }],
  ['The gate: logged out, only the six public pages (others go to log in, nothing shows while Firebase checks); not Northumbria, told why (unless the switch is off; nothing until it’s read); not verified, only check-your-inbox; Need help always opens', () => {
    const uni = { email: 'sam@northumbria.ac.uk', verified: true };
    assert.deepEqual(PUBLIC_PAGES, ['/', '/signup', '/forgot-password', '/mentor-signup', '/need-help', '/privacy']);
    for (const path of PUBLIC_PAGES) {
      assert.equal(gateFor(null, path), 'app', `${path} logged out`);
      assert.equal(gateFor(undefined, path), 'app', `${path} while checking`);
    }
    for (const path of ['/home', '/check-in', '/checklist', '/gp-finder', '/nhs-guide', '/societies/15', '/sport', '/mentor', '/find-mentor', '/more', '/students-union', '/late-arrivals', '/no-such-page']) {
      assert.equal(gateFor(null, path), 'login', `${path} logged out`);
      assert.equal(gateFor(undefined, path), 'checking', `${path} while checking: never login before Firebase knows`);
      assert.equal(gateFor(uni, path), 'app', `${path} signed in: never sent to log in`);
    }
    assert.equal(gateFor(null, '/blackboard/mock/learn/api/public/v1/oauth2/authorizationcode', false, true), 'app', 'a page that says it’s public: only the pretend Blackboard (dev only)');
    assert.equal(gateFor(undefined, '/blackboard/mock/learn', false, true), 'app');
    assert.equal(gateFor(null, '/blackboard/mock/learn'), 'login', 'only when the page itself says so');
    assert.equal(gateFor({ ...uni, verified: false }, '/checklist'), 'verify');
    assert.equal(gateFor({ ...uni, verified: false }, '/'), 'verify', 'as before, on a public page too');
    const elsewhere = { email: 'sam@gmail.com', verified: true };
    assert.equal(gateFor(elsewhere, '/home'), 'northumbria-only', 'the switch left out: Northumbria only');
    assert.equal(gateFor(elsewhere, '/home', false, false, true), 'northumbria-only', 'the switch on');
    assert.equal(gateFor(elsewhere, '/home', false, false, null), 'checking', 'the switch not read yet: nothing, not the Northumbria-only screen for a moment');
    assert.equal(gateFor(elsewhere, '/', false, false, null), 'checking', 'on a public page too');
    assert.equal(gateFor(elsewhere, '/home', false, false, false), 'app', 'the switch off: in');
    assert.equal(gateFor({ ...elsewhere, verified: false }, '/home', false, false, false), 'verify', 'the switch off, unverified: still check-your-inbox');
    assert.equal(gateFor(elsewhere, '/home', true, false, false), 'finishing', 'the switch off, saving a sign-up that waited');
    assert.equal(gateFor(uni, '/home', false, false, null), 'app', 'a Northumbria account never waits for the switch');
    assert.equal(gateFor({ ...uni, verified: false }, '/home', false, false, false), 'verify', 'and is still verified first');
    assert.equal(gateFor(uni, '/home', true), 'finishing');
    assert.deepEqual(ALWAYS_OPEN, ['/need-help']);
    for (const account of [undefined, null, { ...uni, verified: false }, { email: 'sam@gmail.com', verified: true }]) {
      assert.equal(gateFor(account, '/need-help'), 'app', `Need help with ${JSON.stringify(account)}`);
    }
    const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
    assert.match(layout, /if \(screen === 'login' && !getFirebaseAuth\(\)\.currentUser\) sendToLogin\(\);/, 'one place sends them to log in, and never someone who has just logged in');
    assert.match(layout, /\{#if screen === 'checking' \|\| screen === 'login'\}/, 'nothing shows meanwhile');
    for (const file of ['src/routes/check-in/+page.svelte', 'src/routes/mentor/+page.svelte', 'src/routes/find-mentor/+page.svelte', 'src/routes/checklist/+page.svelte']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /sendToLogin|loginPathFor/, `${file} leaves it to the layout`);
    }
    assert.match(readFileSync('src/lib/login-redirect.js', 'utf8'), /loginPathFor\(location\.pathname \+ location\.search\)/, 'and back to where they were');
  }],
  ['Home greets the student by the first name they gave ("Hi there" without one), hidden until it’s known; the chat gets only their first name, never their email', () => {
    assert.equal(greetingFor('Sam Student'), 'Hi Sam');
    assert.equal(greetingFor('  sam  '), 'Hi sam', 'as they typed it');
    for (const none of ['', '   ', null, undefined, 42]) assert.equal(greetingFor(none), 'Hi there', String(none));
    assert.equal(firstName('x'.repeat(60))?.length, 40);
    const home = readFileSync('src/routes/home/+page.svelte', 'utf8');
    assert.doesNotMatch(home, /Hi Sam<\/h1>/, 'no name typed into the page');
    assert.match(home, /<h1 class:waiting=\{greeting === null\}>\{greeting \?\? 'Hi there'\}<\/h1>/);
    assert.match(home, /\.waiting \{\s*visibility: hidden;/);
    assert.match(home, /const record = await loadMyRecord\(\);\s*greeting = greetingFor\(record\.name\);/, 'from their record, which has only the first name (loadMyRecord)');
    for (const file of readdirSync('src/lib/checkin').map((name) => `src/lib/checkin/${name}`)) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /loadMyName|greetingFor/, file);
    }
    const loadMyRecord = readFileSync('src/lib/checklist/store.js', 'utf8').match(/export async function loadMyRecord[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(loadMyRecord, /name: firstName\(data\?\.name\),/, 'loadMyRecord (the chat’s) has only the first name');
    assert.doesNotMatch(loadMyRecord, /\.email\b/, 'and no email');
  }],
  ['The sign-up waits in the tab only, for one account, and a storage that refuses just means nothing waits', () => {
    const waiting = waitingSignUp(memoryStorage());
    assert.equal(waiting.load(), null);
    waiting.save({ uid: 'u1', student: { name: 'Sam' } });
    assert.deepEqual(waiting.load(), { uid: 'u1', student: { name: 'Sam' } });
    waiting.clear();
    assert.equal(waiting.load(), null);
    const refusing = waitingSignUp({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } });
    refusing.save({ uid: 'u1' });
    assert.equal(refusing.load(), null);
    refusing.clear();
    assert.equal(waitingSignUp(undefined).load(), null, 'no storage at all (as in Node)');
    assert.match(readFileSync('src/lib/signup/waiting.js', 'utf8'), /globalThis\.sessionStorage/, 'the tab’s sessionStorage, not localStorage');
  }],
  ['Sign-up turns another address away before any account is made, with the forms’ message; only with the switch off does it go ahead', async () => {
    const auth = /** @type {any} */ (new Proxy({}, { get: () => { throw new Error('Firebase was used'); } }));
    await assert.rejects(signUpStudent({ auth, waiting: waitingSignUp(memoryStorage()) }, { ...DETAILS, email: 'sam@gmail.com' }), { code: NOT_UNI_EMAIL, message: UNI_EMAIL_MESSAGE });
    await assert.rejects(signUpStudent({ auth, waiting: waitingSignUp(memoryStorage()), uniOnly: true }, { ...DETAILS, email: 'sam@gmail.com' }), { code: NOT_UNI_EMAIL }, 'the switch on');
    await assert.rejects(signUpStudent({ auth, waiting: waitingSignUp(memoryStorage()), uniOnly: null }, { ...DETAILS, email: 'sam@gmail.com' }), { code: NOT_UNI_EMAIL }, 'the switch not read yet: as if on');
    await assert.rejects(signUpStudent({ auth, waiting: waitingSignUp(memoryStorage()), uniOnly: false }, { ...DETAILS, email: 'sam@gmail.com' }), { message: 'Firebase was used' }, 'the switch off: the account is made');
  }],
  ['Log in, both sign-ups and forgot password read the switch, then check the address, and their wording follows it; the layout reads it and shows the gate’s screens', () => {
    for (const file of ['src/routes/+page.svelte', 'src/routes/signup/+page.svelte', 'src/routes/mentor-signup/+page.svelte', 'src/routes/forgot-password/+page.svelte']) {
      const page = readFileSync(file, 'utf8');
      assert.match(page, /const uniOnly = await loadAccess\(\);\s*if \(!(?:signedIn && !)?isAllowedEmail\(email, uniOnly\)\) \{\s*(?:error|message) = UNI_EMAIL_MESSAGE;\s*return;/, file);
      assert.match(page, /<label for="email">\{words\.emailLabel\}<\/label>/, `${file}: the label follows the switch`);
      assert.match(page, /let words = \$derived\(wordingFor\(access\.uniOnly\)\);\s*onMount\(\(\) => void loadAccess\(\)\);/, `${file}: from the switch, read as the page opens`);
      assert.doesNotMatch(page, /Northumbria email address|ending @northumbria/, `${file}: no Northumbria wording typed into the page`);
    }
    assert.match(readFileSync('src/routes/+page.svelte', 'utf8'), /await logIn\(email, password, uniOnly\);/);
    const signup = readFileSync('src/routes/signup/+page.svelte', 'utf8');
    assert.match(signup, /\{ auth: getFirebaseAuth\(\), waiting: waitingSignUp\(\), uniOnly \},/);
    assert.match(signup, /placeholder=\{words\.emailPlaceholder\}/);
    assert.match(signup, /\{#if words\.testingNote\}\s*<p class="muted">\{words\.testingNote\}<\/p>\s*\{\/if\}/, 'the testing line, only with the switch off');
    assert.match(readFileSync('src/routes/mentor-signup/+page.svelte', 'utf8'), /signedIn \? null : \{ email, password, uniOnly \}/);
    assert.match(readFileSync('src/lib/firebase/auth.js', 'utf8'), /if \(!isAllowedEmail\(email, uniOnly\)\) return Promise\.reject\(notUniEmail\(\)\);/);
    assert.match(readFileSync('src/lib/matching/mentors.js', 'utf8'), /if \(login && !isAllowedEmail\(login\.email, login\.uniOnly\)\) throw notUniEmail\(\);\n  const answers/, 'before Gemini runs');
    const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
    assert.match(layout, /gateFor\(account, page\.url\.pathname, finishing, page\.data\?\.publicPage === true, access\.uniOnly\)/);
    assert.match(layout, /\$effect\(\(\) => \{\s*if \(account && !isUniEmail\(account\.email\)\) void loadAccess\(\);\s*\}\);/, 'the layout reads the switch only for an account from elsewhere');
    assert.doesNotMatch(layout, /onMount\(\(\) => void loadAccess\(\)\);/, 'not on every page load: a Northumbria student never reads it');
    assert.match(layout, /await freshVerifiedToken\(getFirebaseAuth\(\)\.currentUser\);\s*const saved = await finishSignUp\(db, account\.uid, waitingSignUp\(\)\);/, 'a token that says verified before the save');
    assert.match(layout, /<NorthumbriaOnly email=\{account\.email\} \/>/);
    assert.match(layout, /<VerifyEmail email=\{account\.email\} uniOnly=\{access\.uniOnly\} \/>/);
    assert.match(readFileSync('src/lib/access.svelte.js', 'utf8'), /export const access = \$state\(\{ uniOnly: null \}\);/, 'null until the switch is read');
    const verify = readFileSync('src/lib/components/VerifyEmail.svelte', 'utf8');
    for (const words of ['{words.inboxHeading}', '{words.wrongAddress}', 'Junk', 'I’ve clicked it', 'Resend the email', 'href="/need-help"']) assert.ok(verify.includes(words), words);
    assert.doesNotMatch(verify.slice(verify.indexOf('<main')), /uni inbox|Northumbria/, 'no Northumbria wording typed into the screen');
  }],
  ['Home asks for lost sign-up details (no name or course), never a mentor; the sign-up page then saves them to the logged-in account', () => {
    assert.equal(needsDetails(undefined, false), true, 'no record');
    assert.equal(needsDetails({ checklist: [] }, false), true, 'only a checklist');
    assert.equal(needsDetails({ name: 'Sam', course: '' }, false), true, 'no course');
    assert.equal(needsDetails({ name: 'Sam', course: 'Law' }, false), true, 'from before the about-you questions: asked once for them');
    assert.equal(needsDetails({ name: 'Sam', course: 'Law', studentType: 'home' }, false), false);
    assert.equal(needsDetails(undefined, true), false, 'a mentor');
    assert.match(readFileSync('src/routes/home/+page.svelte', 'utf8'), /<FinishDetailsCard \/>/);
    const card = readFileSync('src/lib/components/FinishDetailsCard.svelte', 'utf8');
    assert.match(card, /href="\/signup">Add my details<\/a>/);
    assert.match(card, /onclick=\{notNow\}>Not now<\/button>/);
    assert.match(card, /sessionStorage/, '"Not now" lasts until the tab closes');
    const signup = readFileSync('src/routes/signup/+page.svelte', 'utf8');
    assert.match(signup, /if \(account\) \{\s*await saveStudentDetails\(db, account\.uid, account\.email, \{ name, studentType, course, interests, arrivalDate, wantsMentor \}\);/);
    assert.match(signup, /filledIn = true;\s*step = 2;/, 'logged in: straight to step 2 (about you)');
    assert.match(signup, /\{#if step === 1\}\s*<label for="email">/, 'so no email or password boxes when logged in');
  }],
  ['firestore.rules: every rule needs hasAccess() (a verified address the switch lets in: Northumbria first, then the test uids, then the switch) or is "if false"; only the switch itself is readable by anyone, and nobody can write it', () => {
    const allows = [...RULES.matchAll(/allow ([a-z, ]+): if ([^\n]+)/g)].map((m) => `${m[1]}: ${m[2]}`);
    assert.ok(allows.length >= 16, `${allows.length} rules`);
    const open = allows.filter((rule) => !/^[a-z, ]+: (hasAccess\(\)|false;)/.test(rule));
    assert.deepEqual(open, ['read: true;'], 'one rule for anyone: reading the switch');
    assert.match(RULES, /match \/config\/access \{\s*allow read: if true;\s*allow write: if false;\s*\}/);
    assert.equal((RULES.match(/request\.auth != null/g) ?? []).length, 1, 'only inside hasAccess()');
    assert.match(RULES, /function hasAccess\(\) \{\s*return request\.auth != null\s*&& \(isNorthumbria\(\) \|\| isTestAccount\(\) \|\| anyVerifiedAddress\(\)\);/, 'the Northumbria check first, so those accounts never read the switch');
    const northumbria = RULES.match(/function isNorthumbria\(\) \{[\s\S]*?\n    \}/)?.[0] ?? '';
    assert.match(northumbria, /request\.auth\.token\.email_verified == true/);
    assert.match(northumbria, /request\.auth\.token\.email\.lower\(\)\.matches\('\^\[\^@\]\+@northumbria\[\.\]ac\[\.\]uk\$'\)/);
    const anywhere = RULES.match(/function anyVerifiedAddress\(\) \{[\s\S]*?\n    \}/)?.[0] ?? '';
    assert.match(anywhere, /request\.auth\.token\.email_verified == true/, 'verification is still needed with the switch off');
    assert.match(anywhere, /exists\(\/databases\/\$\(database\)\/documents\/config\/access\)\s*&& get\(\/databases\/\$\(database\)\/documents\/config\/access\)\.data\.get\('uniOnly', true\) == false;/, 'only exactly false, and a missing document or field counts as true');
    assert.equal(TEST_UIDS.length, 3, 'two test students and the test mentor');
  }]
];

// ---------- 2. In the emulators ----------
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ag2';
const [firestoreHost, firestorePort] = (FIRESTORE ?? ':').split(':');
/** Firestore's REST API in the emulator, as the app reads the switch (firestoreRest in client.js). */
const REST = { documentsUrl: `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents` };

/** Writes a document as the emulator's owner, which the rules don't apply to. @param {string} path @param {Record<string, unknown>} fields */
async function seed(path, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: String(value) }])) };
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, `seeding ${path}: ${response.status}`);
}

/** A document as the emulator's owner sees it, or null. @param {string} path */
async function ownerRead(path) {
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } });
  return response.status === 404 ? null : /** @type {{ fields: Record<string, unknown> }} */ (await response.json());
}

/** Deletes a document as the emulator's owner (as the coordinator would in the console). @param {string} path */
async function ownerDelete(path) {
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
  assert.ok(response.ok, `deleting ${path}: ${response.status}`);
}

let apps = 0;
/** Firestore as someone with this token says (made-up claims, as the emulator allows), or signed out. @param {object} [token] */
function firestoreAs(token) {
  const db = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `as-${apps++}`));
  connectFirestoreEmulator(db, firestoreHost, Number(firestorePort), token ? { mockUserToken: /** @type {any} */ (token) } : undefined);
  return db;
}

/** True if the rules allowed it, false if they refused it. @param {() => Promise<unknown>} action */
async function allowed(action) {
  try {
    await action();
    return true;
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code === 'permission-denied') return false;
    throw err;
  }
}

/** What someone can do: read and write their own record, read a society and a club, list approved mentors. @param {string} uid @param {object} [token] */
async function whatTheyCanDo(uid, token) {
  const db = firestoreAs(token);
  return {
    'read own record': await allowed(() => getDoc(doc(db, 'students', uid))),
    'change own checklist': await allowed(() => setDoc(doc(db, 'students', uid), { checklist: [{ id: 'gp', title: 'Register with a GP', done: true }] }, { merge: true })),
    'read a society': await allowed(() => getDoc(doc(db, 'societies', '1'))),
    'read a sports club': await allowed(() => getDoc(doc(db, 'sportClubs', 'swimming'))),
    'list approved mentors': await allowed(() => getDocs(query(collection(db, 'mentors'), where('approved', '==', true))))
  };
}

/** @param {string} uid @param {string | undefined} email @param {boolean} verified */
const token = (uid, email, verified) => ({ sub: uid, user_id: uid, ...(email === undefined ? {} : { email }), email_verified: verified });

/** @type {[string, () => Promise<void>][]} */
const emulated = [
  ['A verified Northumbria address may do everything its own (also in capitals); so may each test account, unverified and not at Northumbria', async () => {
    await seed('societies/1', { name: 'Chess' });
    await seed('sportClubs/swimming', { name: 'Swimming' });
    await seed('mentors/m1', { approved: true, displayName: 'Alex', maxStudents: 2, studentCount: 0 });
    const everyone = [
      ['verified', 'uni-verified', 'sam.student@northumbria.ac.uk'],
      ['verified, in capitals', 'uni-capitals', 'Sam.Student@Northumbria.AC.UK'],
      ...TEST_UIDS.map((uid, i) => [`test account ${i + 1}`, uid, 'someone@example.com'])
    ];
    for (const [who, uid, email] of everyone) {
      await seed(`students/${uid}`, { name: 'Test' });
      const can = await whatTheyCanDo(uid, token(uid, email, !who.startsWith('test')));
      assert.deepEqual(Object.entries(can).filter(([, ok]) => !ok).map(([what]) => what), [], `${who} was refused`);
    }
  }],
  ['Unverified, another address, a subdomain, lookalikes, no email and signed out may do nothing', async () => {
    const no = [
      ['unverified Northumbria address', token('u-unverified', 'sam@northumbria.ac.uk', false)],
      ['verified Gmail', token('u-gmail', 'sam@gmail.com', true)],
      ['verified subdomain', token('u-sub', 'sam@live.northumbria.ac.uk', true)],
      ['verified lookalike ending', token('u-look1', 'sam@northumbria.ac.uk.example.com', true)],
      ['verified lookalike start', token('u-look2', 'sam@notnorthumbria.ac.uk', true)],
      ['domain before the @', token('u-look3', 'northumbria.ac.uk@example.com', true)],
      ['verified, no email', token('u-noemail', undefined, true)],
      ['signed out', undefined]
    ];
    for (const [who, claims] of no) {
      const uid = /** @type {any} */ (claims)?.sub ?? 'nobody';
      await seed(`students/${uid}`, { name: 'Test' });
      const can = await whatTheyCanDo(uid, /** @type {object | undefined} */ (claims));
      assert.deepEqual(Object.entries(can).filter(([, ok]) => ok).map(([what]) => what), [], `${who} was allowed`);
    }
  }],
  ['A verified student whose sign-up details were lost (the tab closed before verifying) has no record, and can still use the checklist', async () => {
    const uid = 'uni-no-record';
    const db = firestoreAs(token(uid, 'lost.details@northumbria.ac.uk', true));
    assert.equal((await getDoc(doc(db, 'students', uid))).exists(), false, 'no record, and reading it is allowed');
    await setDoc(doc(db, 'students', uid), { checklist: [{ id: 'gp', title: 'Register with a GP', done: true }] }, { merge: true });
    assert.deepEqual(Object.keys((await ownerRead(`students/${uid}`))?.fields ?? {}), ['checklist'], 'the first save makes the record');
  }],
  ['Lost details: a student with only a checklist is asked, saving keeps the checklist, and then they aren’t asked; a mentor never is', async () => {
    const uid = 'uni-lost-details';
    const db = firestoreAs(token(uid, 'lost.details2@northumbria.ac.uk', true));
    await setDoc(doc(db, 'students', uid), { checklist: [{ id: 'gp', title: 'Register with a GP', done: true }] }, { merge: true });
    assert.equal(await loadDetailsNeeded(db, uid), true, 'asked (reading their own missing mentor profile is allowed)');
    await saveStudentDetails(db, uid, 'lost.details2@northumbria.ac.uk', { name: 'Sam Student', studentType: 'home', course: 'BSc Law', interests: 'chess, gigs', arrivalDate: '' });
    const saved = (await ownerRead(`students/${uid}`))?.fields ?? {};
    assert.deepEqual(Object.keys(saved).sort(), ['arrivalDate', 'checklist', 'course', 'email', 'interests', 'name', 'role', 'studentType', 'wantsMentor'], 'the checklist is kept');
    assert.equal(await loadDetailsNeeded(db, uid), false, 'not asked again');
    await seed('mentors/uni-mentor', { approved: false, displayName: 'Alex' });
    assert.equal(await loadDetailsNeeded(firestoreAs(token('uni-mentor', 'alex.mentor@northumbria.ac.uk', true)), 'uni-mentor'), false, 'a mentor');
  }],
  ['Signing up as a student: the account and email, nothing saved until the link is clicked, then the record', async () => {
    const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com` }, 'student-signup');
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
    const waiting = waitingSignUp(memoryStorage());
    const email = `sam.${Date.now()}@northumbria.ac.uk`;

    const user = await signUpStudent({ auth, waiting }, { ...DETAILS, email });
    assert.equal(user.emailVerified, false);
    assert.equal(waiting.load()?.uid, user.uid, 'the record waits in the tab');
    assert.equal(await ownerRead(`students/${user.uid}`), null, 'nothing saved yet');
    const link = await verificationLink(email);
    assert.ok(link, 'the verification email was sent');

    await assert.rejects(finishSignUp(db, user.uid, waiting), { code: 'permission-denied' }, 'saving before the link is clicked is refused');
    assert.equal(waiting.load()?.uid, user.uid, 'and it keeps waiting');
    assert.equal(await checkVerified(user), false, '"I’ve clicked it" before clicking');

    await applyActionCode(auth, /** @type {string} */ (link));
    assert.equal(await checkVerified(user), true, '"I’ve clicked it" after clicking');
    assert.equal(await finishSignUp(db, user.uid, waiting), 'student');
    assert.equal(waiting.load(), null, 'nothing waits any more');
    const saved = await ownerRead(`students/${user.uid}`);
    assert.deepEqual(Object.keys(saved?.fields ?? {}).sort(), ['arrivalDate', 'course', 'email', 'interests', 'name', 'role', 'wantsMentor']);
    assert.equal(await finishSignUp(db, user.uid, waiting), null, 'a second time does nothing');
  }],
  ['Signing up as a mentor: the profile waits too, then both documents are saved together', async () => {
    const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com` }, 'mentor-signup');
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
    const waiting = waitingSignUp(memoryStorage());
    const email = `alex.${Date.now()}@northumbria.ac.uk`;
    // As registerMentor does after Gemini (which can't run here): the account, the waiting profile, the email.
    const { user } = await createUserWithEmailAndPassword(auth, email, DETAILS.password);
    const empty = { q1: [], q2: [], q3: [], q4: [], q5: [], q6: [] };
    waiting.save({ uid: user.uid, mentor: { profile: { displayName: 'Alex', itemVectors: empty, approved: false, maxStudents: 2, studentCount: 0 }, details: { name: 'Alex Mentor', course: 'Law', answers: [], summaries: {}, meetingFrequency: 'weekly', availability: 'evenings' } } });
    await sendVerification(user);

    await assert.rejects(finishSignUp(db, user.uid, waiting), { code: 'permission-denied' });
    await applyActionCode(auth, /** @type {string} */ (await verificationLink(email)));
    assert.equal(await checkVerified(user), true);
    assert.equal(await finishSignUp(db, user.uid, waiting), 'mentor');
    assert.equal((await ownerRead(`mentors/${user.uid}`))?.fields?.approved?.booleanValue, false, 'starts unapproved');
    assert.ok((await ownerRead(`mentorDetails/${user.uid}`))?.fields?.createdAt, 'details saved, with createdAt');
  }],
  ['Opening the app afresh after clicking the link: Firebase knows the account is verified before the saved token does, so the save would be refused; the layout gets a fresh token first (freshVerifiedToken), then the record saves', async () => {
    const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com` }, 'afresh-signup');
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
    const waiting = waitingSignUp(memoryStorage());
    const email = `afresh.${Date.now()}@northumbria.ac.uk`;
    const user = await signUpStudent({ auth, waiting }, { ...DETAILS, email });
    await applyActionCode(auth, /** @type {string} */ (await verificationLink(email)));
    await reload(user);
    assert.equal(user.emailVerified, true, 'Firebase knows (as the app does on loading)');
    assert.equal((await user.getIdTokenResult()).claims.email_verified, false, 'but the saved token doesn’t yet');
    await assert.rejects(finishSignUp(db, user.uid, waiting), { code: 'permission-denied' }, 'so the save is refused');
    await freshVerifiedToken(user);
    assert.equal((await user.getIdTokenResult()).claims.email_verified, true, 'a fresh token says verified');
    assert.equal(await finishSignUp(db, user.uid, waiting), 'student', 'and the save goes through');
    await freshVerifiedToken(user);
    await freshVerifiedToken(null);
  }],
  // ---------- The access switch (config/access, uniOnly). Everything above ran with no document: Northumbria only. ----------
  ['The switch off (uniOnly false): a verified address from anywhere may do everything; unverified ones, no email and signed out still may not; Northumbria and the test accounts still may', async () => {
    await seed('config/access', { uniOnly: false });
    const yes = [
      ['verified Gmail', token('sw-gmail', 'sam@gmail.com', true)],
      ['verified subdomain', token('sw-sub', 'sam@live.northumbria.ac.uk', true)],
      ['verified Northumbria', token('sw-uni', 'sam@northumbria.ac.uk', true)],
      ...TEST_UIDS.map((uid, i) => [`test account ${i + 1}`, token(uid, 'someone@example.com', false)])
    ];
    for (const [who, claims] of yes) {
      const uid = /** @type {{ sub: string }} */ (claims).sub;
      await seed(`students/${uid}`, { name: 'Test' });
      const can = await whatTheyCanDo(uid, /** @type {object} */ (claims));
      assert.deepEqual(Object.entries(can).filter(([, ok]) => !ok).map(([what]) => what), [], `${who} was refused`);
    }
    const no = [
      ['unverified Gmail', token('sw-gmail-unverified', 'sam@gmail.com', false)],
      ['unverified Northumbria address', token('sw-uni-unverified', 'sam@northumbria.ac.uk', false)],
      ['verified, no email', token('sw-noemail', undefined, true)],
      ['signed out', undefined]
    ];
    for (const [who, claims] of no) {
      const uid = /** @type {any} */ (claims)?.sub ?? 'nobody';
      await seed(`students/${uid}`, { name: 'Test' });
      const can = await whatTheyCanDo(uid, /** @type {object | undefined} */ (claims));
      assert.deepEqual(Object.entries(can).filter(([, ok]) => ok).map(([what]) => what), [], `${who} was allowed`);
    }
  }],
  ['Anyone can read the switch, signed out too; nobody can replace, change or delete it from the app, and nothing else under config can be read or written', async () => {
    await seed('config/other', { note: 'not the switch' });
    const everyone = [
      ['signed out', undefined],
      ['verified Northumbria', token('sw-uni', 'sam@northumbria.ac.uk', true)],
      ['verified Gmail', token('sw-gmail', 'sam@gmail.com', true)],
      ['test account', token(TEST_UIDS[0], 'someone@example.com', false)]
    ];
    for (const [who, claims] of everyone) {
      const db = firestoreAs(/** @type {object | undefined} */ (claims));
      assert.equal((await getDoc(doc(db, 'config', 'access'))).data()?.uniOnly, false, `${who} can read the switch`);
      assert.equal(await allowed(() => setDoc(doc(db, 'config', 'access'), { uniOnly: true })), false, `${who} can't replace it`);
      assert.equal(await allowed(() => updateDoc(doc(db, 'config', 'access'), { uniOnly: true })), false, `${who} can't change it`);
      assert.equal(await allowed(() => deleteDoc(doc(db, 'config', 'access'))), false, `${who} can't delete it`);
      assert.equal(await allowed(() => getDoc(doc(db, 'config', 'other'))), false, `${who} can't read another config document`);
      assert.equal(await allowed(() => setDoc(doc(db, 'config', 'other'), { uniOnly: false })), false, `${who} can't write another config document`);
    }
    assert.equal((await ownerRead('config/access'))?.fields?.uniOnly?.booleanValue, false, 'still off, untouched');
    assert.equal(await readUniOnly(REST), false, 'as the app reads it: one plain request, with no account');
    assert.equal(await readUniOnly({ documentsUrl: 'http://127.0.0.1:1/nowhere' }), true, 'if it can’t be read at all: Northumbria only');
  }],
  ['Only exactly false opens it: true, a string "false", a missing field and a missing document all mean Northumbria only (a Northumbria account is never affected); flipping it back on deletes nothing', async () => {
    const gmail = token('sw-gmail', 'sam@gmail.com', true);
    const uni = token('sw-uni', 'sam@northumbria.ac.uk', true);
    const northumbriaOnly = async (/** @type {string} */ position) => {
      assert.equal(await allowed(() => getDoc(doc(firestoreAs(gmail), 'students', gmail.sub))), false, `Gmail, ${position}`);
      assert.equal(await allowed(() => getDoc(doc(firestoreAs(uni), 'students', uni.sub))), true, `Northumbria, ${position}`);
      assert.equal(await readUniOnly(REST), true, `as the app reads it, ${position}`);
    };
    await seed('config/access', { uniOnly: true });
    await northumbriaOnly('uniOnly true');
    await seed('config/access', { uniOnly: 'false' });
    await northumbriaOnly('uniOnly "false", a string');
    await ownerDelete('config/access');
    await seed('config/access', { note: 'no uniOnly field' });
    await northumbriaOnly('no uniOnly field');
    await ownerDelete('config/access');
    assert.equal(await ownerRead('config/access'), null);
    await northumbriaOnly('no document');
    assert.equal((await ownerRead(`students/${gmail.sub}`))?.fields?.name?.stringValue, 'Test', 'the record made while the switch was off is still there');
    await seed('config/access', { uniOnly: false });
    assert.equal(await readUniOnly(REST), false, 'off again, as the app reads it');
    assert.equal(await allowed(() => getDoc(doc(firestoreAs(gmail), 'students', gmail.sub))), true, 'off again: Gmail is back in, with their record');
    await ownerDelete('config/access');
  }],
  ['Signing up from anywhere with the switch off: the account and email, nothing saved until the link is clicked, then the record; with it on, refused before any account is made; flipped back on, refused again with the record kept', async () => {
    await seed('config/access', { uniOnly: false });
    const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com` }, 'anywhere-signup');
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
    const waiting = waitingSignUp(memoryStorage());
    const email = `tess.${Date.now()}@example.com`;
    await assert.rejects(signUpStudent({ auth, waiting, uniOnly: true }, { ...DETAILS, email }), { code: NOT_UNI_EMAIL }, 'the switch on: no account');
    assert.equal(waiting.load(), null, 'and nothing waits');

    const user = await signUpStudent({ auth, waiting, uniOnly: false }, { ...DETAILS, email });
    assert.equal(user.emailVerified, false);
    assert.equal(waiting.load()?.uid, user.uid, 'the record waits in the tab');
    assert.equal(await ownerRead(`students/${user.uid}`), null, 'nothing saved yet');
    assert.ok(await verificationLink(email), 'the verification email was sent');
    await assert.rejects(finishSignUp(db, user.uid, waiting), { code: 'permission-denied' }, 'unverified: refused, switch or no switch');
    await applyActionCode(auth, /** @type {string} */ (await verificationLink(email)));
    assert.equal(await checkVerified(user), true);
    assert.equal(await finishSignUp(db, user.uid, waiting), 'student');
    assert.equal((await ownerRead(`students/${user.uid}`))?.fields?.email?.stringValue, email, 'the record is saved');
    assert.equal((await getDoc(doc(db, 'students', user.uid))).data()?.name, DETAILS.name, 'and they can read it');

    await ownerDelete('config/access');
    await assert.rejects(getDoc(doc(db, 'students', user.uid)), { code: 'permission-denied' }, 'flipped back on: refused again');
    assert.equal((await ownerRead(`students/${user.uid}`))?.fields?.email?.stringValue, email, 'with the record kept');
  }]
];

/** The oob code of the verification email the Auth emulator kept for this address. @param {string} email */
async function verificationLink(email) {
  const response = await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes } = /** @type {{ oobCodes: { email: string, requestType: string, oobCode: string }[] }} */ (await response.json());
  return oobCodes.filter((code) => code.email === email && code.requestType === 'VERIFY_EMAIL').at(-1)?.oobCode ?? null;
}

const checks = FIRESTORE && AUTH ? [...offline, ...emulated] : offline;
let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
if (!FIRESTORE || !AUTH) {
  console.log('\n(The rules and sign-up checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-uni-rules.mjs")');
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
