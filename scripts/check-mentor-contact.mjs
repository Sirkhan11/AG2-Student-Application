// Checks a mentor sharing their email address with the students matched with them (Thomas's choice
// at 00:25 on 18 November: mentors agree at sign-up to share one contact detail, which only their
// matched students can read, shown on the card and never sent to Gemini). The detail is their own
// login address; src/lib/matching/mentor-contact.js has the why.
// 1. Offline: the sign-up box starts unticked and the address goes with the profile only when it's
//    ticked; the rules as written; Gemini never sees it (no chat code reads it, and what Gemini and
//    the app's own lines say never claims how they'll get in touch); the three cards say it the same
//    way; a mentor can change it on Your mentor; Privacy says who sees it.
// 2. In the Firestore emulator, with the real firestore.rules and the app's own functions: a mentor
//    shares, sees and stops sharing only their own login address, with the server's time; only their
//    matched student reads it, one document at a time; another student, one waiting, one without a
//    match, an unverified one, another mentor and a signed-out visitor can't, and nobody can list
//    them; it follows the match when the coordinator moves a student; signing up with the box ticked
//    saves it with the profile in one batch, and an address that isn't theirs saves nothing at all;
//    with the Auth emulator, a mentor who typed their address with capitals still signs up; once the
//    coordinator removes a mentor's profile, their students can't read the address any more.
// 3. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators): a student whose
//    mentor shared sees the address, as a link that opens their email app, on Home and Your mentor;
//    a mentor shares it and stops on Your mentor, with the focus kept for the keyboard; the sign-up
//    box starts unticked. (The chat's card is checked in check-your-mentor.mjs, with Gemini's requests.)
// Made-up people only; nothing real is touched (project demo-ag2), and nothing goes to Gemini.
// Run from the project folder (the emulators need Java 21 or newer, and Google Chrome):
//   node scripts/check-mentor-contact.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-mentor-contact.mjs"

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { describeForGemini, matchLine } from '#lib/checkin/opener.js';
import { outcomeText } from '#lib/matching/find-mentor-steps.js';
import { contactToSave, loadMentorContact, loadMySharing, mailtoHref, MENTOR_CONTACTS, shareMyEmail, stopSharing, withContact } from '#lib/matching/mentor-contact.js';
import { saveMentor } from '#lib/signup/finish.js';
import { CHECKLIST_DONE, emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';

const RULES = readFileSync('firestore.rules', 'utf8');
const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');
/** Every file under a folder. @param {string} folder @returns {string[]} */
const filesIn = (folder) =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
/** A student's match with this mentor, as loadMyMatch gives it. @param {string} mentorId */
const matchWith = (mentorId) => /** @type {const} */ ({ status: 'matched', mentorId, mentorName: null, reasons: [], meetingFrequency: 'weekly', availability: null });
const AFTER_MATCH = 'Thanks for answering those questions. You’ve been matched with Alex. Your mentor page says how to get in touch.';

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['Sign-up: the box starts unticked, says who sees it and that Gemini never does; the account’s own address goes with the profile only when it’s ticked, in the same batch', () => {
    const page = source('src/routes/mentor-signup/+page.svelte');
    assert.match(page, /let shareEmail = \$state\(false\);/);
    assert.match(page, /<input type="checkbox" bind:checked=\{shareEmail\} aria-describedby="share-email-note" \/>\s*Let the students I’m matched with see my email address, so they can get in touch with me\s*<\/label>/);
    assert.ok(oneLine(page).includes('Optional. Only students matched with you can see it, and it’s never sent to Gemini. If you don’t share it, the coordinator introduces you. You can change your mind on Your mentor at any time.'));
    assert.match(page, /maxStudents: Number\(maxStudents\),\s*shareEmail\s*\}/);
    const mentors = source('src/lib/matching/mentors.js');
    assert.match(mentors, /await saveMentor\(db, user\.uid, withContact\(mentor, profile\.shareEmail, user\.email\)\);/, 'already signed in');
    assert.match(mentors, /waiting\.save\(\{ uid: user\.uid, mentor: withContact\(mentor, profile\.shareEmail, user\.email\) \}\);/, 'a new account, saved once verified');
    const base = { profile: { displayName: 'Alex' }, details: { name: 'Alex Mentor' } };
    assert.deepEqual(withContact(base, true, 'alex@northumbria.ac.uk'), { ...base, contact: { email: 'alex@northumbria.ac.uk' } });
    for (const share of [false, undefined, 'yes', 1]) assert.equal(withContact(base, /** @type {any} */ (share), 'alex@northumbria.ac.uk'), base, `ticked: ${String(share)}`);
    assert.equal(withContact(base, true, null), base, 'no address, nothing to share');
    assert.match(source('src/lib/signup/finish.js'), /if \(mentor\.contact\) batch\.set\(doc\(db, MENTOR_CONTACTS, uid\), contactToSave\(mentor\.contact\.email\)\);\s*await batch\.commit\(\);/);
  }],
  ['The rules: only the mentor’s own login address and when they agreed, for an account with a mentor profile; read one at a time by the mentor and a student whose match names them; never listed', () => {
    const block = RULES.match(/match \/mentorContacts\/\{mentorId\} \{[\s\S]*?\n    \}/)?.[0] ?? '';
    assert.match(block, /allow get: if hasAccess\(\) && \(request\.auth\.uid == mentorId\s*\|\| \(matchedWith\(mentorId\) && exists\(\/databases\/\$\(database\)\/documents\/mentors\/\$\(mentorId\)\)\)\);/, 'a student, only while the mentor’s profile is there');
    assert.doesNotMatch(block, /allow (read|list)\b/, 'never a list');
    assert.match(block, /request\.resource\.data\.keys\(\)\.hasOnly\(\['email', 'agreedAt'\]\)/);
    assert.match(block, /request\.resource\.data\.email == request\.auth\.token\.email/);
    assert.match(block, /request\.resource\.data\.agreedAt == request\.time/);
    assert.match(block, /existsAfter\(\/databases\/\$\(database\)\/documents\/mentors\/\$\(mentorId\)\)/);
    assert.match(block, /allow delete: if hasAccess\(\) && request\.auth\.uid == mentorId;/);
    assert.match(RULES, /function matchedWith\(mentorId\) \{\s*let theirs = \/databases\/\$\(database\)\/documents\/matches\/\$\(request\.auth\.uid\);\s*return exists\(theirs\)\s*&& get\(theirs\)\.data\.get\('status', ''\) == 'matched'\s*&& get\(theirs\)\.data\.get\('mentorId', ''\) == mentorId;/);
    assert.equal(MENTOR_CONTACTS, 'mentorContacts');
  }],
  ['Gemini never sees it: no chat code reads it, Gemini is told to show the card rather than say how to get in touch, and the app’s lines after a match point to the mentor page', () => {
    // Nothing imported from it, and the collection never named in code (a comment may point to it).
    for (const file of [...filesIn('src/lib/checkin'), ...filesIn('src/routes/check-in'), 'src/lib/matching/matches.js', 'src/lib/firebase/ai.js']) {
      assert.doesNotMatch(source(file), /from ['"][^'"]*(?:mentor-contact|MentorContact)[^'"]*['"]|['"`]mentorContacts['"`]|MENTOR_CONTACTS|loadMentorContact/, file);
    }
    const told = describeForGemini({ match: matchWith('mentor-alex'), tasks: null, profile: null });
    assert.ok(told.includes('You aren’t told the mentor’s name or how to reach them: if they ask, show their mentor (the mentor tool), which has both, rather than saying how yourself.'), told);
    assert.doesNotMatch(told, /introduce/, 'nor that the coordinator introduces them, which isn’t true once the mentor shares their address');
    assert.equal(matchLine({ ...matchWith('m'), mentorName: 'Alex' }), AFTER_MATCH);
    assert.equal(outcomeText(/** @type {any} */ ({ outcome: 'matched', mentorName: 'Alex' })), AFTER_MATCH);
    const card = source('src/lib/components/YourMentorCard.svelte');
    assert.match(card, /match = await loadMyMatch\(\);\s*contact = await loadMentorContact\(db, match\);/, 'the chat’s card loads it itself');
    assert.doesNotMatch(card, /from ['"](?:#lib\/checkin\/|firebase\/ai|#lib\/firebase\/ai\.js)/);
  }],
  ['The three cards say it the same way: “Getting in touch:”, then the address as a link that opens their email app, or the coordinator introducing them', () => {
    assert.match(oneLine(source('src/lib/components/MentorContact.svelte')), /\{#if contact\}email <a class="address" href=\{mailtoHref\(contact\.email\)\}>\{contact\.email\}<\/a>\.\{:else\}your coordinator will introduce you\.\{\/if\}/);
    for (const [file, line, loads] of [
      ['src/routes/mentor/+page.svelte', '<p><strong>Getting in touch:</strong> <MentorContact {contact} /></p>', 'contact = await loadMentorContact(db, found);'],
      ['src/lib/components/YourMentorCard.svelte', '<p><strong>Getting in touch:</strong> <MentorContact {contact} /></p>', 'contact = await loadMentorContact(db, match);'],
      ['src/routes/home/+page.svelte', "<p>Getting in touch: <MentorContact {contact} />{#if match.meetingFrequency}{' '}You asked to meet {match.meetingFrequency}.{/if}</p>", 'contact = isMentor ? null : await loadMentorContact(db, found);']
    ]) {
      assert.ok(source(file).includes(line), `${file}: ${line}`);
      assert.ok(source(file).includes(loads), `${file}: ${loads}`);
    }
    assert.equal(mailtoHref('alex.mentor@northumbria.ac.uk'), 'mailto:alex.mentor@northumbria.ac.uk');
    assert.equal(mailtoHref('a+b@northumbria.ac.uk'), 'mailto:a%2Bb@northumbria.ac.uk');
    assert.equal(mailtoHref('x?cc=y@example.org'), 'mailto:x%3Fcc%3Dy@example.org', 'nothing in it can add a copy or a subject');
  }],
  ['A mentor shares it or stops on Your mentor, and Home’s card sends them there; Privacy and What the chat knows say who sees what, that Gemini never does, and how to stop', () => {
    const page = oneLine(source('src/routes/mentor/+page.svelte'));
    for (const words of [
      "<h1>{view === 'mentor' ? 'You’re a mentor' : 'Your mentor'}</h1>",
      'Students matched with you can see it, <strong class="address">{sharing.email}</strong>, so they can get in touch with you.',
      'Students matched with you can’t see it, so the coordinator introduces you.',
      "{busy ? 'Stopping…' : 'Stop sharing it'}", "{busy ? 'Sharing…' : 'Share it with them'}",
      // Every place it appears, before they agree (agent1.md A6, 16:36).
      'Only students matched with you can see it: on their Home screen, their Your mentor page and their chat’s mentor card. It’s never sent to Gemini.'
    ]) assert.ok(page.includes(words), words);
    assert.match(source('src/routes/home/+page.svelte'), /<p>You’re a mentor yourself, so there’s nothing to find here\.<\/p>\s*<a class="secondary-button do" href="\/mentor">Sharing your email<\/a>/);
    const privacy = oneLine(source('src/routes/privacy/+page.svelte'));
    for (const words of [
      'Your email address too, only if you chose to share it with the students matched with you.',
      'Your full name, your email address, or your mentor’s name or email address.',
      'only if you chose to share it, your email address, on their Home screen, their Your mentor page and their chat’s mentor card. You can stop sharing it on Your mentor at any time.',
      '<strong>Your email address, if you’re a mentor sharing it with your students:</strong> Stop sharing it, on Your mentor.',
      // agent1.md A10: what the mentor is told replaces the old "To confirm" line.
      '<strong>Your mentor</strong> sees nothing of yours in the app: not your name, your email address, your answers, your checklist, the chat or a request for a different mentor. If they chose to share their email address with you, it’s on your Home screen and Your mentor page, so you can get in touch yourself and decide what to tell them. If not, the mentoring coordinator introduces you.'
    ]) assert.ok(privacy.includes(words), words);
    assert.doesNotMatch(privacy, /To confirm<\/span> what they’re told when the coordinator introduces you/);
    const knows = oneLine(source('src/routes/about-you/+page.svelte'));
    for (const words of [
      'It’s never told your full name, your email, your mentor’s name or email address, or when you’re free to meet',
      'It’s never told your email address, even if you share it with the students matched with you: you choose that, and can stop, on Your mentor.',
      'Your mentor isn’t shown anything about you; if they chose to share their email address with you, it’s on Home and Your mentor.'
    ]) assert.ok(knows.includes(words), `What the chat knows: ${words}`);
  }]
];

// ---------- 2. In the Firestore emulator ----------
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ag2';
const [host, port] = (FIRESTORE ?? ':').split(':');
const store = owner({ auth: '', firestore: FIRESTORE ?? '', project: PROJECT });
const emailOf = (/** @type {string} */ uid) => `${uid}@northumbria.ac.uk`;

let apps = 0;
/**
 * Firestore as someone (made-up claims, as the emulator allows), or signed out.
 * @param {string} [uid] @param {{ verified?: boolean }} [options]
 */
function as(uid, { verified = true } = {}) {
  const db = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `contact-${apps++}`));
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid, user_id: uid, email: emailOf(uid), email_verified: verified } } : undefined);
  return db;
}

/** Resolves true if the rules allowed it, false if they refused it. @param {() => Promise<unknown>} action */
async function allowed(action) {
  try {
    await action();
    return true;
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code === 'permission-denied') return false;
    throw err;
  }
}

/** A new mentor's two documents, as registerMentor makes them (empty answers: nothing to match yet). */
const NEW_MENTOR = { profile: { displayName: 'Cal', itemVectors: { q1: [], q2: [], q3: [], q4: [], q5: [], q6: [] }, approved: false, maxStudents: 2, studentCount: 0 }, details: { name: 'Cal Mentor', course: 'Law', answers: [], summaries: {}, meetingFrequency: 'weekly', availability: 'evenings' } };

/** Deletes a record as the emulator's owner, as the coordinator does in the console. @param {string} path */
async function ownerDelete(path) {
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
  assert.ok(response.ok, `deleting ${path}`);
}

/** Marks an account verified, as clicking the link in the email would (the Auth emulator's owner). @param {string} uid */
async function markVerified(uid) {
  const response = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: uid, emailVerified: true }) });
  assert.ok(response.ok, 'marking the account verified');
}

/** A student's match as the coordinator or the app saves it. @param {string} mentorId */
const matchRecord = (mentorId) => ({ status: 'matched', mentorId, mentorName: 'Alex', reasons: [], meetingFrequency: 'weekly', availability: '', createdAt: new Date() });

/** @type {[string, () => Promise<void>][]} */
const emulated = [
  ['A mentor shares their own login address (with the server’s time), sees it, stops and shares again; an account without a mentor profile can’t', async () => {
    for (const mentor of ['mentor-a', 'mentor-b']) await store.seed(`mentors/${mentor}`, { displayName: mentor, approved: true, maxStudents: 2, studentCount: 1 });
    await store.seed('matches/student-a', matchRecord('mentor-a'));
    await store.seed('matches/student-b', matchRecord('mentor-b'));
    await store.seed('matches/student-waiting', { status: 'coordinator', meetingFrequency: 'weekly', availability: '', createdAt: new Date() });
    const mentor = as('mentor-a');
    await shareMyEmail(mentor, { uid: 'mentor-a', email: emailOf('mentor-a') });
    const mine = await loadMySharing(mentor, 'mentor-a');
    assert.equal(mine?.email, emailOf('mentor-a'));
    assert.ok(mine?.agreedAt instanceof Date && Math.abs(mine.agreedAt.getTime() - Date.now()) < 120_000, 'when they agreed');
    await stopSharing(mentor, 'mentor-a');
    assert.equal(await loadMySharing(mentor, 'mentor-a'), null);
    await shareMyEmail(mentor, { uid: 'mentor-a', email: emailOf('mentor-a') });
    assert.equal(await allowed(() => shareMyEmail(as('student-a'), { uid: 'student-a', email: emailOf('student-a') })), false, 'a student, with no mentor profile');
  }],
  ['Only their own login address and when they agreed: not another address, not in capitals, nothing extra, not the phone’s time, not for another mentor', async () => {
    const mentor = as('mentor-a');
    const ref = doc(mentor, MENTOR_CONTACTS, 'mentor-a');
    for (const [why, record] of [
      ['another address', { email: 'someone.else@northumbria.ac.uk', agreedAt: serverTimestamp() }],
      ['their address in capitals', { email: emailOf('mentor-a').toUpperCase(), agreedAt: serverTimestamp() }],
      ['a phone number as well', { ...contactToSave(emailOf('mentor-a')), phone: '07700 900123' }],
      ['a time from the phone', { email: emailOf('mentor-a'), agreedAt: new Date() }],
      ['no time', { email: emailOf('mentor-a') }]
    ]) assert.equal(await allowed(() => setDoc(ref, record)), false, /** @type {string} */ (why));
    assert.equal(await allowed(() => setDoc(doc(mentor, MENTOR_CONTACTS, 'mentor-b'), contactToSave(emailOf('mentor-a')))), false, 'theirs for another mentor');
    assert.equal(await allowed(() => deleteDoc(doc(as('mentor-b'), MENTOR_CONTACTS, 'mentor-a'))), false, 'another mentor stopping it');
    assert.equal((await loadMySharing(mentor, 'mentor-a'))?.email, emailOf('mentor-a'), 'still shared');
  }],
  ['Their matched student reads it; another student, one waiting, one with no match, their student unverified, another mentor and a signed-out visitor can’t; nobody lists them or changes them', async () => {
    assert.deepEqual(await loadMentorContact(as('student-a'), matchWith('mentor-a')), { email: emailOf('mentor-a') });
    for (const [who, db] of /** @type {[string, import('firebase/firestore').Firestore][]} */ ([
      ['a student matched with another mentor', as('student-b')], ['a student still waiting for the coordinator', as('student-waiting')],
      ['a student with no match', as('student-none')], ['their own student, unverified', as('student-a', { verified: false })],
      ['another mentor', as('mentor-b')], ['a signed-out visitor', as()]
    ])) assert.equal(await allowed(() => getDoc(doc(db, MENTOR_CONTACTS, 'mentor-a'))), false, `${who} read it`);
    for (const [who, db] of /** @type {[string, import('firebase/firestore').Firestore][]} */ ([['their own student', as('student-a')], ['the mentor', as('mentor-a')]])) {
      assert.equal(await allowed(() => getDocs(collection(db, MENTOR_CONTACTS))), false, `${who} listed them`);
    }
    const student = as('student-a');
    assert.equal(await allowed(() => setDoc(doc(student, MENTOR_CONTACTS, 'mentor-a'), contactToSave(emailOf('student-a')))), false, 'their student changing it');
    assert.equal(await allowed(() => deleteDoc(doc(student, MENTOR_CONTACTS, 'mentor-a'))), false, 'their student deleting it');
  }],
  ['A mentor who hasn’t shared: their student may look and finds nothing (the coordinator line); a moved student loses the old mentor’s address; once a mentor stops, nothing', async () => {
    assert.equal(await allowed(() => getDoc(doc(as('student-b'), MENTOR_CONTACTS, 'mentor-b'))), true, 'their own mentor’s, which doesn’t exist');
    assert.equal(await loadMentorContact(as('student-b'), matchWith('mentor-b')), null);
    assert.equal(await loadMentorContact(as('student-a'), { status: 'coordinator', meetingFrequency: 'weekly', availability: null }), null, 'waiting: nothing to load');
    assert.equal(await loadMentorContact(as('student-a'), null), null, 'no match: nothing to load');
    // The coordinator moves student-a to mentor-b in the console, then back.
    await store.seed('matches/student-a', matchRecord('mentor-b'));
    assert.equal(await allowed(() => getDoc(doc(as('student-a'), MENTOR_CONTACTS, 'mentor-a'))), false, 'the old mentor’s, after the move');
    await store.seed('matches/student-a', matchRecord('mentor-a'));
    await stopSharing(as('mentor-a'), 'mentor-a');
    assert.equal(await loadMentorContact(as('student-a'), matchWith('mentor-a')), null, 'after stopping');
  }],
  ['Signing up with the box ticked saves the address with the profile, in one batch; unticked, nothing is shared; an address that isn’t theirs saves nothing at all', async () => {
    const mentor = NEW_MENTOR;
    await saveMentor(as('mentor-c'), 'mentor-c', withContact(mentor, true, emailOf('mentor-c')));
    assert.equal((await store.read('mentorContacts/mentor-c'))?.fields?.email?.stringValue, emailOf('mentor-c'));
    assert.ok((await store.read('mentorContacts/mentor-c'))?.fields?.agreedAt?.timestampValue, 'with when they agreed');
    assert.ok(await store.read('mentors/mentor-c'), 'and the profile');
    await saveMentor(as('mentor-d'), 'mentor-d', withContact(mentor, false, emailOf('mentor-d')));
    assert.ok(await store.read('mentors/mentor-d'));
    assert.equal(await store.read('mentorContacts/mentor-d'), null, 'unticked: nothing shared');
    await assert.rejects(saveMentor(as('mentor-e'), 'mentor-e', { ...mentor, contact: { email: 'not.theirs@northumbria.ac.uk' } }), { code: 'permission-denied' });
    assert.equal(await store.read('mentors/mentor-e'), null, 'nothing at all: the profile goes with it');
  }],
  // agent1.md A11 (17:51): an address left behind when the coordinator removes a mentor isn't read by anyone.
  ['When the coordinator removes a mentor’s profile, their students stop seeing the address at once, before the record itself goes; the mentor can still see it and delete it', async () => {
    await store.seed('mentors/mentor-f', { displayName: 'Fen', approved: true, maxStudents: 2, studentCount: 1 });
    await store.seed('mentorContacts/mentor-f', { email: emailOf('mentor-f'), agreedAt: new Date() });
    await store.seed('matches/student-f', matchRecord('mentor-f'));
    assert.deepEqual(await loadMentorContact(as('student-f'), matchWith('mentor-f')), { email: emailOf('mentor-f') }, 'while the profile is there');
    await ownerDelete('mentors/mentor-f');
    assert.equal(await allowed(() => getDoc(doc(as('student-f'), MENTOR_CONTACTS, 'mentor-f'))), false, 'their student, once the profile has gone');
    assert.equal(await loadMentorContact(as('student-f'), matchWith('mentor-f')), null, 'so the card says the coordinator will introduce them');
    assert.equal((await loadMySharing(as('mentor-f'), 'mentor-f'))?.email, emailOf('mentor-f'), 'the mentor still sees what they shared');
    await stopSharing(as('mentor-f'), 'mentor-f');
    assert.equal(await store.read('mentorContacts/mentor-f'), null, 'and can delete it');
  }],
  // agent1.md A6 (16:36): the rule compares the saved address with the sign-in's exactly, and the address
  // goes in the same batch as the profile, so a difference in case would refuse the whole sign-up.
  ['A mentor who types their address with capitals and ticks the box: the sign-up saves, profile and address together, the address exactly as their sign-in has it', async () => {
    assert.ok(AUTH, 'this one needs the Auth emulator too (--only auth,firestore)');
    const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com` }, `capitals-${apps++}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, host, Number(port));
    const typed = `Ava.Mentor.${randomBytes(3).toString('hex')}@Northumbria.ac.uk`;
    // As registerMentor does: the account first, then what waits for verification, with the account's own address.
    const { user } = await createUserWithEmailAndPassword(auth, typed, randomBytes(18).toString('base64url'));
    const waiting = withContact(NEW_MENTOR, true, user.email);
    // They click the link; the app then gets a fresh token (verify.js) and saves what waited (finishSignUp).
    await markVerified(user.uid);
    await user.reload();
    const signedInAs = (await user.getIdTokenResult(true)).claims.email;
    await saveMentor(db, user.uid, waiting);
    const saved = (await store.read(`mentorContacts/${user.uid}`))?.fields?.email?.stringValue;
    assert.equal(saved, signedInAs, 'the saved address is exactly the sign-in’s');
    assert.ok(await store.read(`mentors/${user.uid}`), 'and the profile is saved with it');
    assert.equal(saved?.toLowerCase(), typed.toLowerCase(), 'their own address');
    console.log(`      (Firebase ${saved === typed ? 'kept the capitals' : 'kept it in small letters'}, in the account and its sign-in alike)`);
  }]
];

const checks = FIRESTORE ? [...offline, ...emulated] : offline;
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
let total = checks.length;
const where = emulators();
if (where) {
  const results = await inTheBrowser(where);
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The rules and browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-mentor-contact.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * The cards and the mentor's own page in Chrome.
 * @param {{ auth: string, firestore: string, project: string }} where
 * @returns {Promise<boolean[]>}
 */
async function inTheBrowser(where) {
  /** @type {boolean[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const report = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const db = owner(where);
  const password = randomBytes(18).toString('base64url');
  // A mentor who shares, with a student matched with them; and a mentor who doesn't share yet.
  const sharer = 'sam.sharer@northumbria.ac.uk';
  const sharerUid = await db.verifiedAccount(sharer, password);
  await db.seed(`mentors/${sharerUid}`, { displayName: 'Sam', approved: true, maxStudents: 2, studentCount: 1 });
  await db.seed(`mentorContacts/${sharerUid}`, { email: sharer, agreedAt: new Date() });
  const pip = 'pip.matched@northumbria.ac.uk';
  const pipUid = await db.verifiedAccount(pip, password);
  await db.seed(`students/${pipUid}`, { name: 'Pip Student', course: 'BSc Law', email: pip, arrivalDate: '', role: 'student', studentType: 'home', wantsMentor: true, interests: [], ...CHECKLIST_DONE });
  await db.seed(`matches/${pipUid}`, { status: 'matched', mentorId: sharerUid, mentorName: 'Sam', reasons: ['You share interests: films'], meetingFrequency: 'weekly', availability: '', createdAt: new Date() });
  const quiet = 'quinn.mentor@northumbria.ac.uk';
  const quietUid = await db.verifiedAccount(quiet, password);
  await db.seed(`mentors/${quietUid}`, { displayName: 'Quinn', approved: true, maxStudents: 2, studentCount: 0 });

  const app = await startApp();
  /** @typedef {Awaited<ReturnType<typeof openChrome>>} Page */
  /** @param {(page: Page) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    try {
      await part(page);
    } finally {
      await page.close();
    }
  };
  /** What a link says and where it goes, for the links to this address. @param {Page} page @param {string} email */
  const linksTo = (page, email) => page.evaluate(`[...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === 'mailto:${email}').map((a) => a.textContent.trim())`);
  try {
    // 1. Pip, whose mentor shared: the address on Home and Your mentor, as a link to email them.
    await inFreshChrome(async (page) => {
      report('A student whose mentor shared their address logs in', await page.logIn(pip, password));
      const home = await page.waitFor(page.has(`Getting in touch: email ${sharer}. You asked to meet weekly.`));
      report('Home’s mentor card: “Getting in touch: email” and the address, then how often', home, JSON.stringify(await linksTo(page, sharer)));
      report('...the address is a link that opens their email app', JSON.stringify(await linksTo(page, sharer)) === JSON.stringify([sharer]));
      await page.go('/mentor');
      const mentorPage = await page.waitFor(`${page.has(`Getting in touch: email ${sharer}.`)} && ${page.has('You’ve been matched with Sam')}`);
      report('Your mentor: the same, under why they were matched', mentorPage && JSON.stringify(await linksTo(page, sharer)) === JSON.stringify([sharer]));
    });

    // 2. Quinn, a mentor who doesn't share yet: Your mentor offers it; sharing and stopping, from the keyboard.
    await inFreshChrome(async (page) => {
      await page.logIn(quiet, password);
      report('A mentor’s Home sends them to choose', await page.waitFor(`${page.has('You’re a mentor yourself')} && document.querySelector('a.do[href="/mentor"]')?.textContent.trim() === 'Sharing your email'`));
      await page.go('/mentor');
      const offered = await page.waitFor(`${page.has('You’re a mentor')} && ${page.has('Students matched with you can’t see it, so the coordinator introduces you.')}`);
      report('Your mentor, for a mentor: “You’re a mentor”, not sharing, and Share it with them', offered && !(await page.evaluate(page.has('Find a mentor'))));
      await page.evaluate(`(document.getElementById('sharing-button').focus(), true)`);
      await page.press('Share it with them');
      const shared = await page.waitFor(`${page.has('Done: the students matched with you can see it now.')} && ${page.has(`Students matched with you can see it, ${quiet}`)}`);
      await sleep(300);
      const saved = (await db.read(`mentorContacts/${quietUid}`))?.fields;
      const focused = await page.evaluate(`document.activeElement?.id === 'sharing-button' && document.activeElement.textContent.trim() === 'Stop sharing it'`);
      report('Share it with them: saved with their own address and when, and the focus moves to Stop sharing it', shared && saved?.email?.stringValue === quiet && Boolean(saved?.agreedAt?.timestampValue) && focused, `focus kept: ${focused}`);
      await page.press('Stop sharing it');
      const stopped = await page.waitFor(`${page.has('Done: they can’t see it any more.')} && ${page.has('Students matched with you can’t see it')}`);
      await sleep(300);
      report('Stop sharing it: gone from Firestore, and the page says so', stopped && (await db.read(`mentorContacts/${quietUid}`)) === null);
    });

    // 3. Signed out: Become a mentor, with the box unticked.
    await inFreshChrome(async (page) => {
      await page.go('/mentor-signup');
      await page.waitFor(page.has('Become a mentor'));
      const box = await page.evaluate(`(() => { const box = document.querySelector('input[type=checkbox][aria-describedby="share-email-note"]'); return box ? { checked: box.checked, label: box.closest('label').innerText.trim() } : null; })()`);
      report('Become a mentor: the box to share their address starts unticked', box?.checked === false && box?.label === 'Let the students I’m matched with see my email address, so they can get in touch with me', JSON.stringify(box));
    });
  } finally {
    app.stop();
  }
  return results;
}
