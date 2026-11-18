// Checks asking the coordinator for a different mentor (the Your Mentor page).
// 1. Offline: the reasons and checks (src/lib/matching/change-reasons.js) agree with firestore.rules;
//    the request stays private (no chat code reads it, nothing is logged, nothing goes to Gemini);
//    the page's form says who sees it and points to Need help now; the chat is told where to send
//    them, and not to ask why.
// 2. In the Firestore emulator, with the real firestore.rules and the app's own functions
//    (src/lib/matching/change-request.js): the student can send, read and cancel their own request,
//    one at a time, and only while they have a mentor; the mentor, other students, unverified and
//    signed-out visitors can't see or touch it; only the expected fields, and their own words up to
//    500 characters. Made-up people and words only, and nothing real is touched (project demo-ag2).
// Run from the project folder (the emulator needs Java 21 or newer):
//   npx --engine-strict=false firebase-tools emulators:exec --only firestore --project demo-ag2 "node scripts/check-mentor-change.mjs"
// or just `node scripts/check-mentor-change.mjs` for part 1.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { CHANGE_REASONS, checkedChangeRequest, MAX_DETAILS_LENGTH, URGENT_REASONS } from '#lib/matching/change-reasons.js';
import { cancelChangeRequest, CHANGE_REQUESTS, loadChangeRequest, sendChangeRequest } from '#lib/matching/change-request.js';

const RULES = readFileSync('firestore.rules', 'utf8');
const COMPONENT = readFileSync('src/lib/components/ChangeMentorRequest.svelte', 'utf8');

/** Every file under a folder. @param {string} folder @returns {string[]} */
const filesIn = (folder) =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['A reason must be picked; their own words are optional (needed for "Something else"), trimmed, and at most 500 characters', () => {
    assert.deepEqual(checkedChangeRequest('times-dont-work', '  We never manage to meet  '), { reason: 'times-dont-work', details: 'We never manage to meet' });
    assert.deepEqual(checkedChangeRequest('not-a-good-fit', undefined), { reason: 'not-a-good-fit', details: '' });
    assert.throws(() => checkedChangeRequest('', 'words'), /Please choose a reason/);
    assert.throws(() => checkedChangeRequest('made-up', 'words'), /Please choose a reason/);
    assert.throws(() => checkedChangeRequest('something-else', '   '), /in your own words/);
    assert.deepEqual(checkedChangeRequest('something-else', 'Our courses clash'), { reason: 'something-else', details: 'Our courses clash' });
    assert.equal(checkedChangeRequest('not-replying', 'x'.repeat(MAX_DETAILS_LENGTH)).details.length, MAX_DETAILS_LENGTH);
    assert.throws(() => checkedChangeRequest('not-replying', 'x'.repeat(MAX_DETAILS_LENGTH + 1)), /500 characters/);
  }],
  ['The reasons and the length limit are the same in the app and in firestore.rules', () => {
    const listed = RULES.match(/record\.reason in \[([^\]]+)\]/)?.[1].match(/'([^']+)'/g)?.map((id) => id.slice(1, -1));
    assert.deepEqual(listed, CHANGE_REASONS.map((option) => option.id));
    assert.match(RULES, new RegExp(`record\\.details\\.size\\(\\) <= ${MAX_DETAILS_LENGTH}\\n`));
    assert.match(RULES, /match \/mentorChangeRequests\/\{studentId\}/);
    assert.equal(CHANGE_REQUESTS, 'mentorChangeRequests');
    assert.deepEqual(URGENT_REASONS, ['uncomfortable']);
  }],
  ['It stays private: the chat’s code never reads it, nothing goes to Gemini, and the reason and words are never logged', () => {
    // The form is shown in the chat too (YourMentorCard), but it saves straight to Firestore: the chat's
    // own code (Gemini, its instructions, the session) and the chat page never touch the request.
    const chatFiles = [...filesIn('src/lib/checkin'), ...filesIn('src/routes/check-in')];
    for (const file of chatFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), /change-request|change-reasons|mentorChangeRequests|ChangeMentorRequest/, file);
    assert.doesNotMatch(readFileSync('src/lib/components/YourMentorCard.svelte', 'utf8'), /from ['"](?:firebase\/ai|#lib\/firebase\/ai\.js|#lib\/checkin\/[^'"]+|#lib\/matching\/change-request\.js)['"]/, 'the card in the chat only shows the form');
    for (const file of ['src/lib/matching/change-request.js', 'src/lib/matching/change-reasons.js', 'src/lib/components/ChangeMentorRequest.svelte']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"](?:firebase\/ai|#lib\/firebase\/ai\.js|#lib\/matching\/summarise\.js|#lib\/checkin\/[^'"]+)['"]/, file);
    }
    for (const call of COMPONENT.match(/console\.error\([^;]*\);/g) ?? []) assert.doesNotMatch(call, /\b(reason|details|request)\b(?!['’ ])/, call);
    assert.doesNotMatch(filesIn('scripts/fixtures').map((file) => readFileSync(file, 'utf8')).join('\n'), /mentorChangeRequests/, 'never in the repo');
  }],
  ['The Your Mentor page offers it only with a mentor, says only the coordinator sees it, points to Need help now, and can cancel', () => {
    const page = readFileSync('src/routes/mentor/+page.svelte', 'utf8');
    assert.match(page, /\{:else if match && match\.status === 'matched'\}[\s\S]*<ChangeMentorRequest \/>\s*\{\/if\}/);
    assert.match(COMPONENT, /This goes only to the mentoring coordinator\. Your mentor won’t see it, and it’s never sent to Gemini\./);
    assert.match(COMPONENT, /If it’s urgent, or you feel unsafe, <a href="\/need-help">get help now<\/a>\./);
    assert.match(COMPONENT, /URGENT_REASONS\.includes\(reason\) \? 'urgent'/, 'stronger when they don’t feel comfortable');
    assert.match(COMPONENT, />\s*\{busy \? 'Cancelling…' : 'Cancel the request'\}/);
    for (const option of CHANGE_REASONS) assert.ok(option.label.length > 5, option.id);
  }],
  ['The chat shows the form right there ({{change-mentor}}) and never asks for the reason', () => {
    const instructions = chatInstructions('(about)', ['(opener)']);
    assert.match(instructions, /If they ask about changing their mentor, show them the form here with \{\{change-mentor\}\} \(see Asking for a different mentor\), where their reason goes only to the mentoring coordinator \(their mentor never sees it\)\. Don't ask for their reason or what went wrong, and don't ask them to tell you\./);
    assert.match(instructions, /Never ask for their reason or what went wrong, and don’t ask them to tell you: the form has the reasons\./);
  }]
];

// ---------- 2. In the Firestore emulator ----------
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ag2';
const [host, port] = (FIRESTORE ?? ':').split(':');

/** Writes a document as the emulator's owner (the rules don't apply). @param {string} path @param {Record<string, string>} fields */
async function seed(path, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { stringValue: value }])) };
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, `seeding ${path}: ${response.status}`);
}

let apps = 0;
/** Firestore as someone (made-up claims, as the emulator allows), or signed out. @param {string} [uid] @param {boolean} [verified] */
function as(uid, verified = true) {
  const db = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `change-${apps++}`));
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid, user_id: uid, email: `${uid}@northumbria.ac.uk`, email_verified: verified } } : undefined);
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

const STUDENT = 'student-one';
/** @type {[string, () => Promise<void>][]} */
const emulated = [
  ['The student can send, read and cancel their own request, one at a time, and send another after cancelling', async () => {
    await seed(`matches/${STUDENT}`, { status: 'matched', mentorId: 'mentor-one', mentorName: 'Alex' });
    const db = as(STUDENT);
    await sendChangeRequest(db, STUDENT, 'times-dont-work', 'We never manage to meet');
    const open = await loadChangeRequest(db, STUDENT);
    assert.equal(open?.reason, 'times-dont-work');
    assert.equal(open?.details, 'We never manage to meet');
    assert.ok(open?.sentAt instanceof Date, 'when it was sent');
    assert.equal(await allowed(() => sendChangeRequest(db, STUDENT, 'not-replying', '')), false, 'a second open request');
    assert.equal(await allowed(() => updateDoc(doc(db, CHANGE_REQUESTS, STUDENT), { details: 'Changed my mind' })), false, 'changing it');
    await cancelChangeRequest(db, STUDENT);
    assert.equal(await loadChangeRequest(db, STUDENT), null);
    await sendChangeRequest(db, STUDENT, 'something-else', 'Our courses clash');
    assert.equal((await loadChangeRequest(db, STUDENT))?.reason, 'something-else');
    await cancelChangeRequest(db, STUDENT);
  }],
  ['Only the expected fields: no extra field, no made-up reason, at most 500 characters, words needed for "something else", the server’s time', async () => {
    const db = as(STUDENT);
    const ref = doc(db, CHANGE_REQUESTS, STUDENT);
    const good = { reason: 'not-a-good-fit', details: '', createdAt: serverTimestamp() };
    for (const [why, record] of [
      ['an extra field (the mentor’s id)', { ...good, mentorId: 'mentor-one' }],
      ['an email', { ...good, email: 'someone@example.com' }],
      ['a made-up reason', { ...good, reason: 'made-up' }],
      ['501 characters', { ...good, details: 'x'.repeat(501) }],
      ['"something else" with no words', { ...good, reason: 'something-else' }],
      ['a time from the phone', { ...good, createdAt: new Date() }],
      ['no reason', { details: 'words', createdAt: serverTimestamp() }]
    ]) assert.equal(await allowed(() => setDoc(ref, record)), false, why);
    assert.equal(await allowed(() => setDoc(ref, { ...good, details: 'x'.repeat(500) })), true, 'exactly 500 characters');
    await deleteDoc(ref);
  }],
  ['Nobody else can see or touch it: not the mentor, another student, the student unverified, or a signed-out visitor', async () => {
    await sendChangeRequest(as(STUDENT), STUDENT, 'uncomfortable', 'Made-up words for the check');
    const ref = (/** @type {import('firebase/firestore').Firestore} */ db) => doc(db, CHANGE_REQUESTS, STUDENT);
    for (const [who, db] of [['their mentor', as('mentor-one')], ['another student', as('student-two')], ['the student, unverified', as(STUDENT, false)], ['a signed-out visitor', as()]]) {
      assert.equal(await allowed(() => getDoc(ref(db))), false, `${who} read it`);
      assert.equal(await allowed(() => deleteDoc(ref(db))), false, `${who} cancelled it`);
    }
    await cancelChangeRequest(as(STUDENT), STUDENT);
  }],
  ['Only a student with a mentor can ask: not one still waiting for the coordinator, or one with no match', async () => {
    await seed('matches/student-waiting', { status: 'coordinator' });
    assert.equal(await allowed(() => sendChangeRequest(as('student-waiting'), 'student-waiting', 'not-a-good-fit', '')), false, 'waiting for the coordinator');
    assert.equal(await allowed(() => sendChangeRequest(as('student-no-match'), 'student-no-match', 'not-a-good-fit', '')), false, 'no match');
    assert.equal(await allowed(() => sendChangeRequest(as('student-two'), STUDENT, 'not-a-good-fit', '')), false, 'for someone else');
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
if (!FIRESTORE) {
  console.log('\n(The rules checks need the emulator: npx --engine-strict=false firebase-tools emulators:exec --only firestore --project demo-ag2 "node scripts/check-mentor-change.mjs")');
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
