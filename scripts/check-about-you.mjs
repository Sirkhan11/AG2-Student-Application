// Checks what the check-in chat always knows about a student (the about-you record, about-you.js),
// the things they choose for it to remember ({{remember: …}}, remember-notes.js and chat-notes.js),
// and the "What the chat knows about you" page (/about-you).
// 1. Offline, in Node: the record (only the first name, contact details blanked, the summary, at most
//    10 notes); what Gemini is told; the marker, and what's never offered (health, money, worries,
//    safety, other people, contact details); saving and deleting; the chat's instructions and notes;
//    the card, the page and its links; the rules' shape; finding a mentor keeping the summary.
// 2. In the Firestore emulator, with the real firestore.rules and the app's own functions
//    (chat-notes.js): only the student can read or change their notes; at most 10, each a line of at
//    most 100 characters, and nothing else.
// 3. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators), with a stand-in
//    for Gemini (scripts/lib/stand-in-gemini.mjs) so no request reaches Google: what the app sends
//    Gemini (first name only, contact details blanked), the Remember card and what's saved, a worry
//    never offered, and the page's Delete and Delete all.
// Made-up people only; nothing real is touched (project demo-ag2). Run from the project folder:
//   node scripts/check-about-you.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-about-you.mjs"
// The second needs Java 21 or newer, and Google Chrome (or CHROME=<path to Chrome>). With
// SCREENSHOTS=<folder>, it also saves phone-size pictures of the card and the page there.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, setDoc, setLogLevel, Timestamp } from 'firebase/firestore';
import { aboutYou, aboutYouForGemini, MAX_NOTE_LENGTH, MAX_NOTES, summaryForChat } from '#lib/checkin/about-you.js';
import { forgetAllNotes, forgetNote, loadMyNotes, rememberNote } from '#lib/checkin/chat-notes.js';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { chatWith } from '#lib/checkin/chat-turns.js';
import { describeForGemini } from '#lib/checkin/opener.js';
import { notesInReply, screenNote, withNote, withoutNote } from '#lib/checkin/remember-notes.js';
import { ANSWERS_NOTE } from '#lib/matching/find-mentor-steps.js';
import { standInGemini } from './lib/stand-in-gemini.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');

const RECORD = {
  name: 'Sam Student',
  email: 'sam.student@northumbria.ac.uk',
  course: 'BSc Law',
  interests: ['swimming', 'salsa', 'Swimming', 'sam.student@northumbria.ac.uk'],
  arrivalDate: '2027-01-20',
  matchingSummary: { likes: ['swimming', 'salsa dancing'], avoids: ['rugby'], styles: { social: 'going out', planning: 'planning ahead', working: null } }
};

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  ['The record: only the first name, contact details blanked, an arrival date only if it’s a real date, the summary, at most 10 notes', () => {
    const about = aboutYou({ ...RECORD, notes: Array.from({ length: 12 }, (_, i) => `Note ${i}`) });
    assert.equal(about.firstName, 'Sam');
    assert.deepEqual(about.interests, ['swimming', 'salsa', '[email]']);
    assert.equal(about.arrivalDate, '2027-01-20');
    assert.equal(about.notes.length, MAX_NOTES);
    assert.equal(aboutYou({ ...RECORD, arrivalDate: '2027-02-30' }).arrivalDate, null, 'not a real date');
    assert.equal(aboutYou({ name: 'sam@example.com' }).firstName, null, 'an email typed as a name');
    assert.equal(aboutYou(null).firstName, null);
    assert.deepEqual(
      summaryForChat({ likes: [['swimming', 'films'], ['Swimming'], []], avoids: [['rugby'], ['07123 456789']], styles: { social: 'both', planning: null, working: 'with others' } }),
      { likes: ['swimming', 'films'], avoids: ['rugby', '[phone number]'], styles: { social: 'both', planning: null, working: 'with others' } }
    );
  }],
  ['What Gemini is told: their first name (never the rest, or their email), arrival date and today, the summary, and what they asked it to remember', () => {
    const told = describeForGemini({ match: null, tasks: null, profile: { ...RECORD, notes: ['Planning to join a running club'] }, today: '2026-11-17' });
    assert.match(told, /^Their first name: Sam\. It's the only name you're told\./m);
    assert.doesNotMatch(told, /Sam Student|sam\.student@/);
    assert.match(told, /Interests they gave when they signed up: swimming, salsa, \[email\]\./);
    assert.match(told, /Their arrival date \(from when they signed up\): 20 January 2027\. Today is 17 November 2026\./);
    assert.match(told, /they're into swimming, salsa dancing; they'd rather avoid rugby; they describe themselves as going out, planning ahead\./);
    assert.match(told, /Things they asked you to remember \(they chose these, and can see and delete them on \[\[What the chat knows\]\]\):\n- Planning to join a running club/);
    assert.match(describeForGemini({ match: null, tasks: null, profile: null }), /Their first name: not known, so don't use a name or ask for one\.\nThings they asked you to remember: nothing yet\./);
    assert.deepEqual(aboutYouForGemini(aboutYou({ name: 'Sam' })).length, 2, 'only what there is');
  }],
  ['A reply offering to remember something: the student sees it without the marker, with the card; Gemini keeps its own marker', async () => {
    /** @type {any[]} */
    const sent = [];
    const model = { generateContent: async (/** @type {any} */ request) => (sent.push(request), { response: { text: () => 'Good plan! Shall I remember that? {{remember: Planning to join a running club}}', candidates: [{ finishReason: 'STOP' }] } }) };
    const chat = chatWith(model);
    const reply = await chat.send('I want to join a running club');
    assert.equal(reply.text, 'Good plan! Shall I remember that?');
    assert.deepEqual(reply.notes, ['Planning to join a running club']);
    await chat.send('Thanks');
    assert.match(sent[1].contents[1].parts[0].text, /\{\{remember: Planning to join a running club\}\}/, 'Gemini sees what it wrote');
  }],
  ['Never offered, whatever Gemini writes: health, money, worries, safety, other people, contact details, or too long; the question about it goes too', () => {
    for (const [note, reason] of [
      ['Has asthma', 'health'], ['Seeing a counsellor', 'health'], ['Struggling with rent', 'money'], ['Stressed about exams', 'worries'],
      ['Feels homesick', 'worries'], ['Feels unsafe walking home', 'safety'], ['Visiting my mum in Leeds', 'other people'],
      ['Email is sam@example.com', 'contact details'], ['Number is 07123 456789', 'contact details'], ['Instagram @samdances', 'contact details'],
      ['Lives at 12 Park Road', 'contact details'], ['x'.repeat(MAX_NOTE_LENGTH + 1), 'too long']
    ]) assert.equal(screenNote(note), reason, note);
    assert.deepEqual(notesInReply('Exams can be a lot. Want me to remember that for later? {{remember: Stressed about exams}}'), { text: 'Exams can be a lot.', notes: [] });
    assert.deepEqual(notesInReply('Good luck! {{remember: half written'), { text: 'Good luck!', notes: [] });
  }],
  ['Ordinary things can be: a plan, something they’re into, how they like to do things; one at a time', () => {
    for (const note of ['Planning to join a running club in January', 'Prefers studying in the mornings', 'Into climbing and films', 'Likes working with others']) assert.equal(screenNote(note), null, note);
    assert.deepEqual(notesInReply('Shall I remember both? {{remember: Into climbing}} {{remember: Into films}}').notes, ['Into climbing']);
  }],
  ['Saving: no repeats, at most 10; deleting takes out only that one', () => {
    // Stand-ins for saved times, compared the way Firestore's Timestamps are (isEqual).
    const stamps = Array.from({ length: 12 }, (_, n) => ({ n, isEqual: (/** @type {any} */ other) => other?.n === n }));
    const at = (/** @type {number} */ n) => stamps[n];
    const ten = Array.from({ length: MAX_NOTES }, (_, i) => ({ text: `Note ${i}`, savedAt: at(i) }));
    assert.deepEqual(withNote(ten.slice(0, 2), 'Note 2.', at(2)), { notes: [...ten.slice(0, 2), { text: 'Note 2', savedAt: at(2) }] });
    assert.deepEqual(withNote(ten.slice(0, 2), 'NOTE 1', at(9)), { refused: 'exists' });
    assert.deepEqual(withNote(ten, 'One more', at(11)), { refused: 'full' });
    assert.deepEqual(withNote([], 'Has asthma', at(1)), { refused: 'health' });
    assert.deepEqual(withoutNote(ten, { text: 'Note 3', savedAt: at(3) }).map((note) => note.text), ten.filter((_, i) => i !== 3).map((note) => note.text));
    assert.equal(withoutNote(ten, { text: 'Note 3', savedAt: at(4) }).length, MAX_NOTES, 'only the one saved then');
  }],
  ['The chat’s instructions: when to offer, never health, money, worries, safety, other people or contact details, never say it’s remembered, and where to see and delete them', () => {
    const instructions = oneLine(chatInstructions('(about)', ['(opener)']));
    assert.match(instructions, /Remembering something for later chats \(\{\{remember: Planning to join a running club\}\}\):/);
    assert.match(instructions, /Never offer to remember anything about their health, money, worries or feelings, or their safety, anything about other people \(names, or details about someone\), or contact details, and never while they’re worried or upset\./);
    assert.match(instructions, /Never say you've remembered something, or that you will: only they can save it, with the card's Remember button\./);
    assert.match(instructions, /\[\[What the chat knows\]\] \(what you're told about them, including what they asked you to remember, which they can delete there\)/);
    assert.match(instructions, /their first name, the course, interests and arrival date they gave when they signed up, a summary of their answers if they've found a mentor, and anything they asked you to remember/);
  }],
  ['Nothing says Gemini is never told their name any more; the chat’s note says it’s told their first name, never the full name or email, and links to the page', () => {
    const files = ['src/routes/check-in/+page.svelte', 'src/lib/checkin/opener.js', 'src/lib/checkin/chat-prompt.js', 'src/lib/checklist/store.js', 'src/lib/checkin/about-you.js', 'src/routes/about-you/+page.svelte'];
    for (const file of files) assert.doesNotMatch(oneLine(source(file)), /never told (your|their) name|never has their name|never gets (the|their) name|Never names \(not theirs/i, file);
    const note = oneLine(source('src/routes/check-in/+page.svelte'));
    assert.match(note, /Gemini is told your first name;/);
    assert.match(note, /It’s never told your full name or email, or your mentor’s name\. <a href="\/about-you">See what the chat knows about you<\/a>\./);
  }],
  ['The chat shows the card under its reply, only the card’s Remember saves, and a saved note is passed on to Gemini', () => {
    const page = source('src/routes/check-in/+page.svelte');
    assert.match(page, /note: reply\.notes\?\.\[0\] \? \{ text: reply\.notes\[0\], state: 'offered' \} : undefined/);
    assert.match(page, /<RememberCard bind:note=\{item\.note\} onsaved=\{noteSaved\} \/>/);
    assert.match(page, /if \(notes\) notesChanged\(notes\.map\(\(note\) => note\.text\)\);/);
    assert.match(page, /const profile = \{ \.\.\.record, checklist: undefined, notes: notes\.map\(\(note\) => note\.text\) \};/);
    const card = source('src/lib/components/RememberCard.svelte');
    assert.equal(card.match(/rememberNote\(/g)?.length, 1, 'one place saves');
    assert.match(card.slice(card.indexOf('async function remember()')), /^async function remember\(\) \{[\s\S]*rememberNote\(db, signedInUid\(\), note\.text\)/);
    assert.match(card, /onclick=\{remember\}/);
  }],
  ['The page: linked from More and the chat’s note; shows the record and the notes, with Delete for each and Delete all after a confirm; deleting tells a running chat', () => {
    assert.match(source('src/routes/more/+page.svelte'), /\{ name: 'What the chat knows about you', href: '\/about-you' \}/);
    const page = source('src/routes/about-you/+page.svelte');
    for (const words of ['<h1>What the chat knows about you</h1>', 'First name', 'Course', 'Interests', 'Arrival date', 'Your mentor', 'From your answers when finding a mentor', 'Your checklist', 'Things you asked it to remember']) assert.ok(page.includes(words), words);
    assert.match(page, /aria-label=\{`Delete: \$\{note\.text\}`\}>Delete<\/button>/);
    assert.match(page, /\{#if confirmingAll\}[\s\S]*onclick=\{removeAll\}/);
    assert.match(page, /notesChanged\(notes\.map\(\(saved\) => saved\.text\)\);/);
    assert.match(page, /notesChanged\(\[\]\);/);
  }],
  ['The rules: chatNotes has exactly MAX_NOTES places, each line at most MAX_NOTE_LENGTH characters, and only for the student themselves', () => {
    const rules = source('firestore.rules');
    const places = rules.slice(rules.indexOf('function validChatNotes'), rules.indexOf('}', rules.indexOf('function validChatNotes')));
    assert.equal(places.match(/validChatNote\(notes\[\d+\]\)/g)?.length, MAX_NOTES);
    assert.match(places, new RegExp(`notes\\.size\\(\\) <= ${MAX_NOTES}`));
    assert.match(rules, new RegExp(`note\\.text\\.size\\(\\) <= ${MAX_NOTE_LENGTH}`));
    assert.match(rules, /match \/chatNotes\/\{userId\} \{\s*allow read, delete: if isNorthumbria\(\) && request\.auth\.uid == userId;/);
  }],
  ['Finding a mentor keeps the summary for the chat (after taking a place, and with a request for the coordinator), and the note before the questions says so', () => {
    const findMatch = source('src/lib/matching/find-match.js');
    assert.match(findMatch, /await takePlace\([^)]*\);\s*\/\/[^\n]*\n\s*await keepMatchingSummary\(prepared\.summary\)\.catch/);
    assert.match(source('src/lib/matching/matches.js'), /\.\.\.\(request\.summary \? \{ matchingSummary: summaryForChat\(request\.summary\) \} : \{\}\)/);
    assert.match(ANSWERS_NOTE, /A short summary \(what you’re into, what you’d rather avoid and how you like to do things\) is also kept for the check-in chat/);
    assert.doesNotMatch(ANSWERS_NOTE, /only used for matching/);
  }]
];

// ---------- 2. The rules, in the Firestore emulator ----------
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-ag2';
const [host, port] = (FIRESTORE ?? ':').split(':');
const STUDENT = 'student-notes';

// The refusals below are expected: don't print each one.
setLogLevel('silent');

let apps = 0;
/** Firestore as someone (made-up claims, as the emulator allows), or signed out. @param {string} [uid] @param {boolean} [verified] */
function as(uid, verified = true) {
  const db = getFirestore(initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `notes-${apps++}`));
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

/** @type {[string, () => Promise<void>][]} */
const emulated = [
  ['The student can save, read and delete their own notes with the app’s own functions', async () => {
    const db = as(STUDENT);
    assert.equal(await rememberNote(db, STUDENT, 'Planning to join a running club'), 'saved');
    assert.equal(await rememberNote(db, STUDENT, 'Prefers studying in the mornings'), 'saved');
    assert.equal(await rememberNote(db, STUDENT, 'planning to join a running club.'), 'exists');
    const notes = await loadMyNotes(db, STUDENT);
    assert.deepEqual(notes.map((note) => note.text), ['Planning to join a running club', 'Prefers studying in the mornings']);
    await forgetNote(db, STUDENT, notes[0]);
    assert.deepEqual((await loadMyNotes(db, STUDENT)).map((note) => note.text), ['Prefers studying in the mornings']);
    await forgetAllNotes(db, STUDENT);
    assert.deepEqual(await loadMyNotes(db, STUDENT), []);
  }],
  ['At most 10 notes, each 1 to 100 characters with when it was saved, and nothing else in the document', async () => {
    const db = as(STUDENT);
    const ref = doc(db, 'chatNotes', STUDENT);
    const note = (/** @type {string} */ text) => ({ text, savedAt: Timestamp.now() });
    const ten = Array.from({ length: MAX_NOTES }, () => note('x'.repeat(MAX_NOTE_LENGTH)));
    assert.equal(await allowed(() => setDoc(ref, { notes: ten })), true, '10 of 100 characters');
    for (const [why, record] of [
      ['11 notes', { notes: [...ten, note('One more')] }],
      ['101 characters', { notes: [note('x'.repeat(MAX_NOTE_LENGTH + 1))] }],
      ['an empty note', { notes: [note('')] }],
      ['no time', { notes: [{ text: 'A plan' }] }],
      ['a time as words', { notes: [{ text: 'A plan', savedAt: 'yesterday' }] }],
      ['an extra field in a note', { notes: [{ ...note('A plan'), email: 'someone@example.com' }] }],
      ['an extra field in the document', { notes: [note('A plan')], name: 'Sam' }],
      ['notes that aren’t a list', { notes: 'A plan' }]
    ]) assert.equal(await allowed(() => setDoc(ref, record)), false, why);
    assert.equal(await rememberNote(db, STUDENT, 'One more'), 'full', 'the app says it’s full rather than trying');
    await deleteDoc(ref);
  }],
  ['Nobody else can read or change them: another student, the student unverified, or a signed-out visitor', async () => {
    await rememberNote(as(STUDENT), STUDENT, 'Planning to join a running club');
    for (const [who, db] of [['another student', as('student-two')], ['the student, unverified', as(STUDENT, false)], ['a signed-out visitor', as()]]) {
      const ref = doc(db, 'chatNotes', STUDENT);
      assert.equal(await allowed(() => getDoc(ref)), false, `${who} read them`);
      assert.equal(await allowed(() => setDoc(ref, { notes: [] })), false, `${who} changed them`);
      assert.equal(await allowed(() => deleteDoc(ref)), false, `${who} deleted them`);
    }
    assert.equal(await allowed(() => setDoc(doc(as('student-two'), 'chatNotes', 'student-two'), { notes: [{ text: 'Mine', savedAt: Timestamp.now() }] })), true, 'their own, yes');
    await forgetAllNotes(as(STUDENT), STUDENT);
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
if (FIRESTORE && AUTH) {
  const results = await inTheBrowser();
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The rules and browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-about-you.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

// ---------- 3. In Chrome, against the emulators, with a stand-in for Gemini ----------
/** @returns {Promise<boolean[]>} */
async function inTheBrowser() {
  const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const SCREENSHOTS = process.env.SCREENSHOTS;
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
        const { port: free } = /** @type {import('node:net').AddressInfo} */ (probe.address());
        probe.close(() => done(free));
      });
    });

  // A verified student with the whole record, in the emulators.
  /** @param {unknown} value @returns {any} */
  const asValue = (value) =>
    value === null ? { nullValue: null }
      : value instanceof Date ? { timestampValue: value.toISOString() }
        : typeof value === 'boolean' ? { booleanValue: value }
          : Number.isInteger(value) ? { integerValue: String(value) }
            : typeof value === 'number' ? { doubleValue: value }
              : Array.isArray(value) ? { arrayValue: { values: value.map(asValue) } }
                : typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(/** @type {object} */ (value)).map(([key, v]) => [key, asValue(v)])) } }
                  : { stringValue: String(value) };
  /** @param {string} path @param {Record<string, unknown>} fields */
  async function seed(path, fields) {
    const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
      method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: asValue(fields).mapValue.fields })
    });
    assert.ok(response.ok, `seeding ${path}`);
  }
  /** @param {string} path @returns {Promise<any>} */
  const ownerRead = async (path) => {
    const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { authorization: 'Bearer owner' } });
    return response.status === 404 ? null : response.json();
  };
  const password = randomBytes(18).toString('base64url');
  const made = await (await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: RECORD.email, password, returnSecureToken: true })
  })).json();
  const uid = /** @type {string} */ (made.localId);
  await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: uid, emailVerified: true })
  });
  await seed(`students/${uid}`, { ...RECORD, interests: ['swimming', 'salsa', RECORD.email], role: 'student' });

  // The app, and Chrome at phone size.
  const appPort = await freePort();
  const BASE = `http://127.0.0.1:${appPort}`;
  const app = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--mode', 'emulators', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { stdio: 'ignore' });
  for (let tries = 0; ; tries++) {
    if (app.exitCode !== null || tries > 120) throw new Error('the app didn’t start');
    if (await fetch(`${BASE}/`).then((response) => response.ok, () => false)) break;
    await sleep(500);
  }
  const chromePort = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'ag2-about-you-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  /** @type {WebSocket | undefined} */
  let socket;
  try {
    let target;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json()).find((/** @type {any} */ t) => t.type === 'page');
      } catch {
        await sleep(250);
      }
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    socket = ws;
    await new Promise((done) => ws.addEventListener('open', done, { once: true }));
    let id = 0;
    const pending = new Map();
    /** @type {((message: any) => void)[]} */
    const handlers = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else for (const handler of handlers) handler(message);
    });
    /** @param {string} method @param {object} [params] @returns {Promise<any>} */
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, (/** @type {any} */ m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const gemini = await standInGemini(send, (handler) => handlers.push(handler));
    /** @param {string} expression @returns {Promise<any>} */
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    /** @param {string} expression @param {number} [ms] */
    const waitFor = async (expression, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
        if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
      }
      return false;
    };
    /** @param {string} words */
    const has = (words) => `document.body.innerText.includes(${JSON.stringify(words)})`;
    /** @param {string} path */
    const go = async (path) => {
      await send('Page.navigate', { url: BASE + path });
      await waitFor(`document.readyState === 'complete'`);
      await sleep(1500);
    };
    /** @param {string} selector @param {string} value */
    const fill = (selector, value) =>
      evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    /** Clicks the last button with exactly these words that isn't switched off. @param {string} words */
    const press = (words) =>
      evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((e) => e.textContent.trim() === ${JSON.stringify(words)} && !e.disabled).at(-1); if (!b) return false; b.click(); return true; })()`);
    /** Sends a chat message and waits for the reply. @param {string} text */
    const say = async (text) => {
      const before = gemini.requests.length;
      await fill('#chat-message', text);
      await evaluate(`(document.getElementById('chat-message').form.requestSubmit(), true)`);
      for (const end = Date.now() + 20000; gemini.requests.length === before && Date.now() < end; ) await sleep(150);
      await waitFor(`!document.querySelector('.typing')`);
      await sleep(300);
    };
    /**
     * Phone-screen pictures, when SCREENSHOTS is set: what's showing now, or (whole) the top of the
     * page and then its end, as a phone shows them.
     * @param {string} name @param {boolean} [whole]
     */
    const picture = async (name, whole = false) => {
      if (!SCREENSHOTS) return;
      const shoot = async (/** @type {string} */ file) => writeFileSync(join(SCREENSHOTS, `${file}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      if (!whole) return shoot(name);
      await evaluate('(scrollTo(0, 0), true)');
      await sleep(300);
      await shoot(`${name}-top`);
      await evaluate('(scrollTo(0, document.body.scrollHeight), true)');
      await sleep(300);
      await shoot(`${name}-end`);
      await evaluate('(scrollTo(0, 0), true)');
    };
    const lastBubble = () => evaluate(`[...document.querySelectorAll('.bubble')].at(-1)?.innerText.trim() ?? ''`);

    // Log in, and open the chat.
    await go('/');
    await waitFor(has('Welcome back'));
    await fill('#email', RECORD.email);
    await fill('#password', password);
    await evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
    await waitFor(`location.pathname === '/home'`);
    await go('/check-in');
    await waitFor(`document.querySelector('[data-chat-ready]')`, 30000);

    // 1. What the app sends Gemini.
    gemini.replyWith('That sounds great, Sam. Shall I remember that for next time? {{remember: Planning to join a running club in January}}');
    await say('Hi, my number is 07123 456789. I’m planning to join a running club in January.');
    const told = gemini.lastInstructions();
    const everything = JSON.stringify(gemini.requests.at(-1)?.body ?? {});
    const message = gemini.lastMessages().at(-1) ?? '';
    report('In Chrome, Gemini is told their first name only (not their full name or email), their arrival date, the summary and that there are no notes yet; an email in their interests and a phone number in a message are blanked',
      /Their first name: Sam\./.test(told) && !/Sam Student/.test(everything) && !everything.includes(RECORD.email)
        && /Interests they gave when they signed up: swimming, salsa, \[email\]\./.test(told)
        && /Their arrival date \(from when they signed up\): 20 January 2027\. Today is /.test(told)
        && /they're into swimming, salsa dancing; they'd rather avoid rugby; they describe themselves as going out, planning ahead\./.test(told)
        && /Things they asked you to remember: nothing yet\./.test(told)
        && message.includes('[phone number]') && !message.includes('07123'),
      `${gemini.requests.length} request(s) to the stand-in`);

    // 2. The card, Remember, and Gemini being told.
    const cardShown = await waitFor(`document.querySelector('[aria-label="Remember this for later chats"]')?.innerText.includes('Planning to join a running club in January')`);
    const bubble = await lastBubble();
    await picture('remember-card');
    const pressed = await press('Remember');
    const saved = await waitFor(has('Remembered: Planning to join a running club in January'));
    const stored = await ownerRead(`chatNotes/${uid}`);
    gemini.replyWith('Any time.');
    await say('Thanks!');
    report('A reply offering to remember shows the card, without the marker; Remember saves it, and Gemini is then told it',
      cardShown && !/\{\{|remember:/i.test(bubble) && bubble.includes('Shall I remember that for next time?') && pressed && saved
        && stored?.fields?.notes?.arrayValue?.values?.[0]?.mapValue?.fields?.text?.stringValue === 'Planning to join a running club in January'
        && gemini.lastInstructions().includes('- Planning to join a running club in January'),
      `card ${cardShown}, saved ${saved}, told ${gemini.lastInstructions().includes('- Planning to join a running club in January')}`);

    // 3. A worry is never offered.
    gemini.replyWith('Exams can be a lot. Want me to remember that for later? {{remember: Stressed about exams}}');
    const cards = await evaluate(`document.querySelectorAll('[aria-label="Remember this for later chats"]').length`);
    await say('Exams are stressing me out a bit');
    const worry = await lastBubble();
    report('A reply offering to remember a worry shows no card, and no question about it',
      worry === 'Exams can be a lot.' && (await evaluate(`document.querySelectorAll('[aria-label="Remember this for later chats"]').length`)) === cards, JSON.stringify(worry));

    // 4. The page, from the chat's note: the record and the note; Delete, then Delete all.
    await evaluate(`(document.querySelector('a[href="/about-you"]').click(), true)`);
    const shown = await waitFor(`location.pathname === '/about-you' && ${has('From your account')}`);
    const text = oneLine(await evaluate('document.body.innerText'));
    const record = ['Sam', 'BSc Law', 'swimming, salsa, [email]', '20 January 2027', 'You haven’t got one yet.', 'Into: swimming, salsa dancing', 'Would rather avoid: rugby', 'How you like to do things: going out, planning ahead', 'Planning to join a running club in January'].filter((words) => !text.includes(words));
    await picture('about-you-page', true);
    await evaluate(`(document.querySelector('button[aria-label="Delete: Planning to join a running club in January"]').click(), true)`);
    const deleted = await waitFor(`${has('Deleted.')} && !${has('Planning to join a running club in January')}`);
    const goneOne = (await ownerRead(`chatNotes/${uid}`)) === null;
    await seed(`chatNotes/${uid}`, { notes: ['Into climbing', 'Prefers studying in the mornings', 'Wants to try salsa'].map((note) => ({ text: note, savedAt: new Date() })) });
    await go('/about-you');
    await waitFor(has('Wants to try salsa'));
    await press('Delete all');
    const asked = await waitFor(has('Delete all 3? The chat won’t know them any more.'));
    await press('Delete all');
    const allGone = await waitFor(`${has('Everything it remembered has been deleted.')} && !${has('Into climbing')}`);
    report('The page (from the chat’s note) shows the record and the note; Delete takes it out; Delete all, after a confirm, takes out the rest',
      shown && record.length === 0 && deleted && goneOne && asked && allGone && (await ownerRead(`chatNotes/${uid}`)) === null,
      record.length ? `missing: ${record.join('; ')}` : `deleted ${deleted}, asked ${asked}, all gone ${allGone}`);

    // 5. More links to it.
    await go('/more');
    await evaluate(`([...document.querySelectorAll('a')].find((a) => a.textContent.includes('What the chat knows about you'))?.click(), true)`);
    report('More links to the page', await waitFor(`location.pathname === '/about-you' && ${has('What the chat knows about you')}`));
  } finally {
    socket?.close();
    chrome.kill();
    app.kill();
    await sleep(800);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  return results;
}
