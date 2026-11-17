// Checks that AG2 is for verified Northumbria accounts only.
// 1. Offline: which addresses count (uni-email.js), which screen a signed-in account sees
//    (account-gate.js), the sign-up waiting in the tab (signup/waiting.js), that the forms and the
//    sign-up code turn other addresses away, and that every rule in firestore.rules needs
//    isNorthumbria().
// 2. In the Firebase emulators, with the real firestore.rules. Nothing real is touched (project
//    demo-ag2) and no email is sent: the Auth emulator keeps the verification links.
//    - Who may read and write: a verified Northumbria address (in any case) and the three test
//      accounts may; an unverified one, other addresses, lookalikes and signed-out visitors may not.
//    - Signing up as the app does: the account is made and the email sent, nothing is saved until
//      the link is clicked, then finishSignUp saves the student's record or the mentor's profile.
// Run from the project folder. The emulators need Java 21 or newer, and --engine-strict=false is for
// this project's .npmrc (firebase-tools lists Node 20 to 24, but runs on newer):
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-uni-rules.mjs"
// or just `node scripts/check-uni-rules.mjs` for part 1.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { applyActionCode, connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, setDoc, where } from 'firebase/firestore';
import { ALWAYS_OPEN, gateFor } from '#lib/account-gate.js';
import { checkVerified, sendVerification } from '#lib/firebase/verify.js';
import { finishSignUp } from '#lib/signup/finish.js';
import { waitingSignUp } from '#lib/signup/waiting.js';
import { signUpStudent } from '#lib/students/signup.js';
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
  ['The gate: signed out, the app; not a Northumbria address, told why; not verified, only check-your-inbox; Need help now always opens', () => {
    const uni = { email: 'sam@northumbria.ac.uk', verified: true };
    assert.equal(gateFor(undefined, '/home'), 'app', 'while Firebase checks');
    assert.equal(gateFor(null, '/checklist'), 'app', 'signed out: the pages send them to log in themselves');
    assert.equal(gateFor(uni, '/checklist'), 'app');
    assert.equal(gateFor({ ...uni, verified: false }, '/checklist'), 'verify');
    assert.equal(gateFor({ ...uni, verified: false }, '/home'), 'verify');
    assert.equal(gateFor({ email: 'sam@gmail.com', verified: true }, '/home'), 'northumbria-only');
    assert.equal(gateFor({ email: 'sam@gmail.com', verified: false }, '/home'), 'northumbria-only');
    assert.equal(gateFor(uni, '/home', true), 'finishing');
    assert.deepEqual(ALWAYS_OPEN, ['/need-help']);
    assert.equal(gateFor({ ...uni, verified: false }, '/need-help'), 'app');
    assert.equal(gateFor({ email: 'sam@gmail.com', verified: true }, '/need-help'), 'app');
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
  ['Sign-up turns another address away before any account is made, with the forms’ message', async () => {
    const auth = /** @type {any} */ (new Proxy({}, { get: () => { throw new Error('Firebase was used'); } }));
    await assert.rejects(signUpStudent({ auth, waiting: waitingSignUp(memoryStorage()) }, { ...DETAILS, email: 'sam@gmail.com' }), { code: NOT_UNI_EMAIL, message: UNI_EMAIL_MESSAGE });
  }],
  ['Log in, both sign-ups and forgot password check the address; the layout shows the gate’s screens', () => {
    for (const file of ['src/routes/+page.svelte', 'src/routes/signup/+page.svelte', 'src/routes/mentor-signup/+page.svelte', 'src/routes/forgot-password/+page.svelte']) {
      assert.match(readFileSync(file, 'utf8'), /if \(!(?:signedIn && !)?isUniEmail\(email\)\) \{\s*(?:error|message) = UNI_EMAIL_MESSAGE;\s*return;/, file);
    }
    assert.match(readFileSync('src/lib/firebase/auth.js', 'utf8'), /if \(!isUniEmail\(email\)\) return Promise\.reject\(notUniEmail\(\)\);/);
    assert.match(readFileSync('src/lib/matching/mentors.js', 'utf8'), /if \(login && !isUniEmail\(login\.email\)\) throw notUniEmail\(\);\n  const answers/, 'before Gemini runs');
    const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
    assert.match(layout, /gateFor\(account, page\.url\.pathname, finishing\)/);
    assert.match(layout, /<NorthumbriaOnly email=\{account\.email\} \/>/);
    assert.match(layout, /<VerifyEmail email=\{account\.email\} \/>/);
    const verify = readFileSync('src/lib/components/VerifyEmail.svelte', 'utf8');
    for (const words of ['Check your uni inbox', 'Junk', 'I’ve clicked it', 'Resend the email', 'href="/need-help"']) assert.ok(verify.includes(words), words);
  }],
  ['firestore.rules: every rule needs isNorthumbria() (a verified @northumbria.ac.uk address) or is "if false"; the exception is three test uids', () => {
    const allows = [...RULES.matchAll(/allow ([a-z, ]+): if ([^\n]+)/g)].map((m) => m[2]);
    assert.ok(allows.length >= 14, `${allows.length} rules`);
    for (const condition of allows) assert.ok(condition.startsWith('isNorthumbria()') || condition === 'false;', condition);
    assert.equal((RULES.match(/request\.auth != null/g) ?? []).length, 1, 'only inside isNorthumbria()');
    assert.match(RULES, /request\.auth\.token\.email_verified == true/);
    assert.match(RULES, /request\.auth\.token\.email\.lower\(\)\.matches\('\^\[\^@\]\+@northumbria\[\.\]ac\[\.\]uk\$'\)/);
    assert.equal(TEST_UIDS.length, 3, 'two test students and the test mentor');
  }]
];

// ---------- 2. In the emulators ----------
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ag2';
const [firestoreHost, firestorePort] = (FIRESTORE ?? ':').split(':');

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
    assert.deepEqual(Object.keys(saved?.fields ?? {}).sort(), ['arrivalDate', 'course', 'email', 'interests', 'name', 'role']);
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
