// Checks the two-step sign-up with "About you" (src/routes/signup, src/lib/students/signup.js) and
// the right information first for home and international students (src/lib/students/student-type.js):
// 1. Offline, in Node: the record and its new answers (home or international, a mentor), what an
//    account from before the questions is missing (needsDetails), the password rule and the about-you
//    checks, the interests to pick (each a word the chat's suggestions understand), the NHS guide's
//    order for each kind of student, the Enrol how-to's visa-only step and its pointer to Arriving
//    late, the one word the chat is told and its setting, and the pages that describe it all.
// 2. In the Firestore emulator, with the real firestore.rules: the two answers are accepted, anything
//    else is refused, and a record from before the questions still saves.
// 3. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators): step 1 (the
//    password rule shown before typing, the two passwords must match), step 2 (the two buttons, the
//    chips and adding your own, the mentor box), Finish makes the account and nothing is saved until
//    the address is verified, then the record has the answers and Home offers to find their mentor;
//    an account from before the questions gets the Finish your details card, which shows only step 2
//    with the known answers filled in; a home student sees Register with a GP first and no visa line
//    under Enrol; an international student sees the visa section first, the visa line and the pointer
//    to Arriving late, and What the chat knows about you says so. With SCREENSHOTS=<folder>, it saves
//    phone-size pictures of both steps there.
// Made-up people only; nothing real is touched (project demo-ag2) and no email is sent. Run from the
// project folder (the emulators need Java 21 or newer, and Google Chrome or CHROME=<path to Chrome>):
//   node scripts/check-sign-up.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-sign-up.mjs"

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { aboutYou, aboutYouForGemini, TELL_CHAT_STUDENT_TYPE } from '#lib/checkin/about-you.js';
import { HOW_TO, howToFor, INTERNATIONAL_POINTERS, VISA_ONLY_STEPS } from '#lib/checklist/how-to.js';
import { SECTIONS, sectionsFor, VISA_SECTION_TITLE } from '#lib/nhs/guide.js';
import {
  aboutYouProblem,
  accountProblem,
  INTEREST_CHOICES,
  loadDetailsNeeded,
  loadStudentDetails,
  MAX_INTEREST_LENGTH,
  MAX_INTERESTS,
  needsDetails,
  PASSWORD_MIN_LENGTH,
  saveStudentDetails,
  studentRecord,
  tidyInterests
} from '#lib/students/signup.js';
import { STUDENT_TYPES, studentTypeFrom, studentTypeInWords } from '#lib/students/student-type.js';
import { shortlist } from '#lib/suggestions/shortlist.js';
import { CHECKLIST_DONE, emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const RULES = source('firestore.rules');
const SIGN_UP_PAGE = source('src/routes/signup/+page.svelte');

// ---------- 1. Offline ----------
/** @type {[string, () => void][]} */
const offline = [
  ['The record keeps the new answers: home or international (only those two words) and whether they’d like a mentor (true or false); interests picked or typed, tidied', () => {
    const record = studentRecord({ name: 'Sam Student', email: 'sam@northumbria.ac.uk', course: 'BSc Law', interests: ['Climbing', ' Gaming ', 'climbing', ''], arrivalDate: '2026-09-20', studentType: 'home', wantsMentor: true });
    assert.deepEqual(record, { name: 'Sam Student', email: 'sam@northumbria.ac.uk', course: 'BSc Law', interests: ['Climbing', 'Gaming'], arrivalDate: '2026-09-20', role: 'student', studentType: 'home', wantsMentor: true });
    assert.deepEqual(studentRecord({ name: 'S', email: 'e', course: 'c', interests: 'chess, gigs', arrivalDate: '' }), { name: 'S', email: 'e', course: 'c', interests: ['chess', 'gigs'], arrivalDate: '', role: 'student', wantsMentor: false }, 'the old form’s comma list, no answers: nothing made up');
    assert.equal('studentType' in studentRecord({ name: 'S', email: 'e', course: 'c', interests: [], arrivalDate: '', studentType: 'martian' }), false, 'anything else is dropped');
    assert.deepEqual(tidyInterests(Array.from({ length: 14 }, (_, i) => `Interest ${i}`)).length, MAX_INTERESTS, `at most ${MAX_INTERESTS}`);
    assert.equal(tidyInterests(['x'.repeat(60)])[0].length, MAX_INTEREST_LENGTH, `each at most ${MAX_INTEREST_LENGTH} characters`);
    assert.deepEqual(STUDENT_TYPES, ['home', 'international']);
    for (const value of ['home', 'international']) assert.equal(studentTypeFrom(value), value);
    for (const value of ['Home', 'eu', '', null, undefined, 1, true]) assert.equal(studentTypeFrom(value), null, String(value));
    assert.equal(studentTypeInWords('home'), 'a home student');
    assert.equal(studentTypeInWords('international'), 'an international student');
    assert.equal(studentTypeInWords(null), null);
  }],
  ['Step 1’s checks: the password rule (shown before they type) and the two passwords matching; step 2’s: a name, home or international, a course, not too many interests', () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.match(accountProblem({ password: 'short', confirm: 'short' }) ?? '', /at least 8 characters/);
    assert.match(accountProblem({ password: 'long-enough-1', confirm: 'long-enough-2' }) ?? '', /don’t match/);
    assert.equal(accountProblem({ password: 'long-enough-1', confirm: 'long-enough-1' }), null);
    const ok = { name: 'Sam Student', studentType: 'home', course: 'BSc Law', interests: ['Gaming'] };
    assert.equal(aboutYouProblem(ok), null);
    assert.match(aboutYouProblem({ ...ok, name: '  ' }) ?? '', /your name/);
    assert.match(aboutYouProblem({ ...ok, studentType: '' }) ?? '', /home or international/);
    assert.match(aboutYouProblem({ ...ok, course: '' }) ?? '', /your course/);
    assert.match(aboutYouProblem({ ...ok, interests: Array.from({ length: 11 }, (_, i) => `i${i}`) }) ?? '', /at most 10 interests/);
    assert.match(SIGN_UP_PAGE, /At least \{PASSWORD_MIN_LENGTH\} characters\./, 'the rule before they type');
    assert.match(SIGN_UP_PAGE, /minlength=\{PASSWORD_MIN_LENGTH\}/);
    for (const words of ['Step 1 of 2', 'Step 2 of 2', 'Confirm password', 'Already have an account? Log in', 'We only ask for what the app needs. No date of birth or health questions.',
      'Are you a home or international student?', 'When do you arrive?', 'Your course', 'What are you into? Pick a few', 'Something else?',
      'Match me with a second- or third-year mentor (optional)', 'Why we ask: this sets up your checklist and mentor match. You can change it later']) {
      assert.ok(SIGN_UP_PAGE.includes(words), words);
    }
    assert.doesNotMatch(SIGN_UP_PAGE, /Where will you live/, 'left out: nothing in the app would use it');
    assert.match(SIGN_UP_PAGE, /step = 2;\s*try \{\s*const known = await loadStudentDetails\(db, account\.uid\);/, 'logged in: straight to step 2, filled in');
  }],
  ['Accounts from before the questions are asked once: a record with a name and course but no home-or-international answer needs details; a complete one doesn’t; a mentor never does', () => {
    assert.equal(needsDetails({ name: 'Sam', course: 'Law' }, false), true, 'no answer yet');
    assert.equal(needsDetails({ name: 'Sam', course: 'Law', studentType: 'home' }, false), false);
    assert.equal(needsDetails({ name: 'Sam', course: 'Law', studentType: 'other' }, false), true, 'an odd value');
    assert.equal(needsDetails({ course: 'Law', studentType: 'home' }, false), true, 'no name');
    assert.equal(needsDetails(undefined, true), false, 'a mentor');
    assert.match(source('src/lib/components/FinishDetailsCard.svelte'), /home or international student/, 'the card says what it asks');
    assert.match(source('src/routes/home/+page.svelte'), /<FinishDetailsCard \/>\s*<!--[^>]*-->\s*<FindMentorCard \/>/, 'Home has both cards');
  }],
  ['The interests to pick are everyday words the chat’s suggestions understand: each gives it societies, clubs or services to suggest', () => {
    assert.ok(INTEREST_CHOICES.length >= 8 && INTEREST_CHOICES.length <= 12, `${INTEREST_CHOICES.length} choices`);
    assert.equal(new Set(INTEREST_CHOICES.map((word) => word.toLowerCase())).size, INTEREST_CHOICES.length, 'no repeats');
    for (const word of INTEREST_CHOICES) {
      assert.ok(shortlist({ message: '', interests: [word] }).length > 0, `"${word}" gives the chat nothing to suggest`);
    }
  }],
  ['The NHS guide: an international student (or one who hasn’t said) sees "What you’ve paid for" first; a home student sees "Register with a GP" first, with that section moved down under a title that says who it’s for, and nothing left out', () => {
    assert.equal(sectionsFor('international'), SECTIONS, 'as now');
    assert.equal(sectionsFor(null), SECTIONS, 'as now');
    assert.equal(SECTIONS[0].id, 'paid');
    const home = sectionsFor('home');
    assert.equal(home[0].id, 'gp');
    assert.deepEqual(home.map((section) => section.id).sort(), SECTIONS.map((section) => section.id).sort(), 'every section, once');
    const paidAt = home.findIndex((section) => section.id === 'paid');
    assert.equal(home[paidAt].title, VISA_SECTION_TITLE);
    assert.match(VISA_SECTION_TITLE, /student visa/);
    assert.equal(home[paidAt + 1].id, 'words', 'just above Words you’ll hear');
    assert.deepEqual(home[paidAt].points, SECTIONS[0].points, 'the same facts, with their sources');
    assert.match(source('src/routes/nhs-guide/+page.svelte'), /sections = sectionsFor\(\(await loadMyRecord\(\)\)\.studentType\)/);
  }],
  ['The checklist’s how-tos: the Right to Study step under Enrol is for students on a visa, so a home student doesn’t see it; an international student sees it and the pointer to Arriving late; others see it as now', () => {
    assert.equal(VISA_ONLY_STEPS.enrol.length, 1);
    assert.match(VISA_ONLY_STEPS.enrol[0], /Right to Study/);
    for (const [task, steps] of Object.entries(VISA_ONLY_STEPS)) for (const step of steps) assert.ok(HOW_TO[task].steps.includes(step), `${task}: a real step`);
    assert.deepEqual(howToFor('enrol', 'home')?.steps, HOW_TO.enrol.steps.slice(1));
    assert.equal(howToFor('enrol', 'home')?.pointer, null);
    assert.deepEqual(howToFor('enrol', 'international')?.steps, HOW_TO.enrol.steps);
    assert.deepEqual(howToFor('enrol', 'international')?.pointer, INTERNATIONAL_POINTERS.enrol);
    assert.equal(INTERNATIONAL_POINTERS.enrol.href, '/late-arrivals');
    assert.deepEqual(howToFor('enrol', null)?.steps, HOW_TO.enrol.steps, 'not said: as now');
    assert.equal(howToFor('enrol')?.pointer, null);
    assert.deepEqual(howToFor('gp', 'home')?.steps, HOW_TO.gp.steps, 'other tasks unchanged');
    assert.equal(howToFor('my-own-task', 'home'), null);
    const page = source('src/routes/checklist/+page.svelte');
    assert.match(page, /howToFor\(task\.id, studentType\)/);
    assert.match(page, /\{#if howTo\.pointer\}\s*<p class="pointer"><a href=\{howTo\.pointer\.href\}>\{howTo\.pointer\.label\}<\/a><\/p>/);
  }],
  ['The chat is told one word, home or international, while TELL_CHAT_STUDENT_TYPE is on; What the chat knows about you and Privacy say so', () => {
    assert.equal(TELL_CHAT_STUDENT_TYPE, true);
    assert.equal(aboutYou({ name: 'Sam', studentType: 'home' }).studentType, 'home');
    assert.equal(aboutYou({ name: 'Sam', studentType: 'international' }).studentType, 'international');
    assert.equal(aboutYou({ name: 'Sam', studentType: 'eu' }).studentType, null);
    assert.equal(aboutYou({ name: 'Sam' }).studentType, null);
    const home = aboutYouForGemini(aboutYou({ name: 'Sam', studentType: 'home' }));
    assert.equal(home.filter((line) => /home student/.test(line)).length, 1);
    assert.match(aboutYouForGemini(aboutYou({ name: 'Sam', studentType: 'international' })).join('\n'), /They're an international student/);
    assert.doesNotMatch(aboutYouForGemini(aboutYou({ name: 'Sam' })).join('\n'), /home student|international student/, 'nothing when they haven’t said');
    assert.match(source('src/lib/checkin/about-you.js'), /studentType: TELL_CHAT_STUDENT_TYPE \? studentTypeFrom\(record\?\.studentType\) : null/, 'one setting turns it off');
    assert.match(source('src/lib/checklist/store.js'), /studentType: studentTypeFrom\(data\?\.studentType\),\s*wantsMentor: data\?\.wantsMentor === true/);
    const aboutPage = source('src/routes/about-you/+page.svelte');
    assert.match(aboutPage, /<dt>Home or international<\/dt>/);
    assert.match(aboutPage, /\{#if !TELL_CHAT_STUDENT_TYPE\}\s*The chat isn’t told this\./);
    assert.match(aboutPage, /<a href="\/signup">change them<\/a>/, 'and where to change the answers');
    const privacy = source('src/routes/privacy/+page.svelte');
    assert.match(privacy, /whether you’re a home or international student, and whether you’d like a mentor/);
    assert.match(privacy, /whether you said you’re a home or international student \(one word/);
  }],
  ['firestore.rules: a student record’s answers must be allowed ones (home or international; a mentor yes or no; at most 15 interests), and a record from before the questions still saves', () => {
    assert.match(RULES, /allow create, update: if hasAccess\(\) && request\.auth\.uid == userId\s*&& \(!\('checklist' in request\.resource\.data\) \|\| validChecklist\(request\.resource\.data\.checklist\)\)\s*&& validAboutYou\(request\.resource\.data\);/);
    const fn = RULES.match(/function validAboutYou\(record\) \{[\s\S]*?\n    \}/)?.[0] ?? '';
    assert.match(fn, /record\.studentType in \['home', 'international'\]/);
    assert.match(fn, /record\.wantsMentor is bool/);
    assert.match(fn, /record\.interests is list && record\.interests\.size\(\) <= 15/);
  }]
];

let failed = 0;
let total = 0;
for (const [name, check] of offline) {
  total++;
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}

// ---------- 2 and 3. In the emulators ----------
const where = emulators();
if (where) {
  const results = [...(await theRules(where)), ...(await inTheBrowser(where))];
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The rules and browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-sign-up.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * The rules, as someone whose token says this (made-up claims, as the emulator allows).
 * @param {{ auth: string, firestore: string, project: string }} where
 * @returns {Promise<boolean[]>}
 */
async function theRules(where) {
  /** @type {boolean[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const report = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const [host, port] = where.firestore.split(':');
  let apps = 0;
  /** @param {string} uid */
  const firestoreAs = (uid) => {
    const db = getFirestore(initializeApp({ projectId: where.project, apiKey: 'demo-key' }, `signup-as-${apps++}`));
    connectFirestoreEmulator(db, host, Number(port), { mockUserToken: /** @type {any} */ ({ sub: uid, user_id: uid, email: `${uid}@northumbria.ac.uk`, email_verified: true }) });
    return db;
  };
  /** @param {() => Promise<unknown>} action */
  const allowed = async (action) => {
    try {
      await action();
      return true;
    } catch (err) {
      if (/** @type {{ code?: string }} */ (err).code === 'permission-denied') return false;
      throw err;
    }
  };
  const uid = 'rules-signup';
  const db = firestoreAs(uid);
  const record = { name: 'Sam', email: `${uid}@northumbria.ac.uk`, course: 'Law', interests: ['Gaming'], arrivalDate: '', role: 'student' };
  try {
    report('The rules take a record with home or international and a mentor yes or no', await allowed(() => setDoc(doc(db, 'students', uid), { ...record, studentType: 'home', wantsMentor: true })));
    report('...and one from before the questions, with neither', await allowed(() => setDoc(doc(db, 'students', uid), record)));
    report('...and adding the answers to it later, merged, as the sign-up page saves them', await allowed(() => saveStudentDetails(db, uid, record.email, { name: 'Sam Student', studentType: 'international', course: 'BSc Law', interests: ['Gaming', 'Chess'], arrivalDate: '2026-09-20', wantsMentor: false })));
    const saved = (await getDoc(doc(db, 'students', uid))).data();
    report('...which the record then holds, and it no longer needs details', saved?.studentType === 'international' && saved?.wantsMentor === false && saved?.name === 'Sam Student' && (await loadDetailsNeeded(db, uid)) === false, JSON.stringify(saved));
    assert.deepEqual(await loadStudentDetails(db, uid), { name: 'Sam Student', studentType: 'international', course: 'BSc Law', interests: ['Gaming', 'Chess'], arrivalDate: '2026-09-20', wantsMentor: false });
    report('loadStudentDetails gives the sign-up page the answers to fill in', true);
    const refused = [
      ['another word for home or international', { ...record, studentType: 'eu' }],
      ['a number for it', { ...record, studentType: 1 }],
      ['"yes" for the mentor box', { ...record, wantsMentor: 'yes' }],
      ['interests as one string', { ...record, interests: 'Gaming, Chess' }],
      ['16 interests', { ...record, interests: Array.from({ length: 16 }, (_, i) => `i${i}`) }]
    ];
    for (const [what, data] of refused) report(`The rules refuse ${what}`, !(await allowed(() => setDoc(doc(db, 'students', uid), data))));
    report('Only the student reads their record', !(await allowed(() => getDoc(doc(firestoreAs('someone-else'), 'students', uid)))));
  } catch (err) {
    report('The rules checks ran', false, String(/** @type {Error} */ (err).message).slice(0, 200));
  }
  return results;
}

/**
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
  const shots = process.env.SCREENSHOTS;

  /** The uid of the account with this address, from the Auth emulator. @param {string} email */
  async function uidOf(email) {
    const response = await fetch(`http://${where.auth}/identitytoolkit.googleapis.com/v1/projects/${where.project}/accounts:lookup`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ email: [email] })
    });
    const { users } = /** @type {{ users?: { localId: string }[] }} */ (await response.json());
    return users?.[0]?.localId ?? null;
  }
  /** Marks an address verified, as clicking the link in the email would. @param {string} email */
  async function markVerified(email) {
    const localId = await uidOf(email);
    assert.ok(localId, `no account for ${email}`);
    const response = await fetch(`http://${where.auth}/identitytoolkit.googleapis.com/v1/projects/${where.project}/accounts:update`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true })
    });
    assert.ok(response.ok, `verifying ${email}`);
  }
  /** A record's fields as plain values, from the emulator's REST API. @param {string | null} uid @returns {Promise<Record<string, unknown> | null>} */
  async function recordOf(uid) {
    const fields = uid ? (await db.read(`students/${uid}`))?.fields : null;
    if (!fields) return null;
    /** @param {any} value */
    const plain = (value) => ('stringValue' in value ? value.stringValue : 'booleanValue' in value ? value.booleanValue : 'arrayValue' in value ? (value.arrayValue.values ?? []).map(plain) : value);
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, plain(value)]));
  }

  // Two accounts made as the emulator's owner: an international student with everything, and one
  // from before the questions (a name and course, no home-or-international answer).
  const intl = 'ines.intl@northumbria.ac.uk';
  const intlUid = await db.verifiedAccount(intl, password);
  await db.seed(`students/${intlUid}`, { name: 'Ines Student', course: 'MSc Data Science', email: intl, arrivalDate: '', role: 'student', studentType: 'international', wantsMentor: false, interests: ['Gaming'], ...CHECKLIST_DONE });
  const old = 'old.account@northumbria.ac.uk';
  const oldUid = await db.verifiedAccount(old, password);
  await db.seed(`students/${oldUid}`, { name: 'Old Student', course: 'BA History', email: old, arrivalDate: '', role: 'student', interests: ['chess', 'gigs'], ...CHECKLIST_DONE });

  const app = await startApp();
  /** @typedef {Awaited<ReturnType<typeof openChrome>>} Page */
  /** @param {(page: Page) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    /** @type {string[]} */
    const errors = [];
    page.listen((message) => {
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((/** @type {any} */ arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 160));
    });
    try {
      await part(page);
    } finally {
      if (errors.length) console.log(`  (console errors in the app: ${errors.join(' | ')})`);
      await page.close();
    }
  };
  /** @param {Page} page */
  const text = (page) => page.evaluate('document.body.innerText');
  /** The first section heading on the NHS guide. @param {Page} page */
  const firstSection = (page) => page.evaluate(`document.querySelector('main section h2')?.textContent.trim() ?? ''`);
  /** Opens every how-to on the checklist and gives the Enrol one's text. @param {Page} page */
  const enrolHowTo = async (page) => {
    await page.go('/checklist');
    await page.waitFor(page.has('Enrol'));
    return page.evaluate(`(() => { const d = [...document.querySelectorAll('details.how-to')]; d.forEach((el) => (el.open = true)); return d.map((el) => el.innerText).find((t) => t.includes('Student Portal')) ?? ''; })()`);
  };

  try {
    // 1. Signing up in two steps, as a new student would, then verifying and finishing.
    const newbie = `new.signup.${Date.now()}@northumbria.ac.uk`;
    await inFreshChrome(async (page) => {
      await page.go('/signup');
      await page.waitFor(page.has('Create your account'));
      const stepOne = await page.evaluate(`({ text: document.body.innerText, boxes: [...document.querySelectorAll('input')].map((i) => i.id), rule: document.getElementById('password')?.getAttribute('aria-describedby') })`);
      report('Step 1 asks only for the account: email, password and confirm password, with the rule shown before they type, "Already have an account? Log in" and the note on what isn’t asked',
        stepOne.text.includes('Step 1 of 2') && stepOne.boxes.join(',') === 'email,password,confirm' && stepOne.text.includes(`At least ${PASSWORD_MIN_LENGTH} characters.`) && stepOne.rule === 'password-rule'
          && stepOne.text.includes('Already have an account? Log in') && stepOne.text.includes('No date of birth or health questions.'), stepOne.boxes.join(','));
      if (shots) await page.picture(join(shots, 'sign-up-step-1.png'));
      await page.fill('#email', newbie);
      await page.fill('#password', password);
      await page.fill('#confirm', `${password}x`);
      await page.press('Continue');
      report('Two passwords that don’t match stop Continue with a message', await page.waitFor(page.has('The two passwords don’t match.')));
      await page.fill('#confirm', password);
      await page.press('Continue');
      const stepTwo = await page.waitFor(`${page.has('Step 2 of 2')} && document.getElementById('name') && !document.getElementById('email')`);
      report('Continue goes to step 2, About you: name, home or international, arrival date, course, interests to pick, and the mentor box', stepTwo && (await page.evaluate(page.has('Are you a home or international student?'))) && (await page.evaluate(page.has('What are you into? Pick a few'))) && (await page.evaluate(page.has('Match me with a second- or third-year mentor (optional)'))));
      await page.fill('#name', 'New Student');
      await page.evaluate(`(document.querySelector('input[name=studentType][value=home]').click(), true)`);
      await page.fill('#course', 'BSc Computer Science');
      for (const word of ['Climbing', 'Gaming']) await page.evaluate(`([...document.querySelectorAll('.chip')].find((c) => c.textContent.trim() === ${JSON.stringify(word)}).querySelector('input').click(), true)`);
      await page.fill('#own-interest', 'Chess');
      await page.press('Add');
      const chess = await page.waitFor(`[...document.querySelectorAll('.chip.picked')].map((c) => c.textContent.trim()).join(',') === 'Climbing,Gaming,Chess'`);
      report('Picking two interests and adding "Chess" shows the three as picked', chess, await page.evaluate(`[...document.querySelectorAll('.chip.picked')].map((c) => c.textContent.trim()).join(',')`));
      await page.evaluate(`(document.querySelector('.tick input').click(), true)`);
      if (shots) {
        // Let the page's entrance animation finish, so the picture shows the step as it settles.
        await sleep(900);
        await page.picture(join(shots, 'sign-up-step-2.png'));
      }
      await page.press('Finish');
      const inbox = await page.waitFor(`${page.has('Check your uni inbox')} && ${page.has(newbie)}`);
      const uid = await uidOf(newbie);
      report('Finish makes the account and shows the check-your-inbox screen; nothing is saved until the address is verified', inbox && uid !== null && (await recordOf(uid)) === null, `uid ${uid ? 'made' : 'missing'}`);
      await markVerified(newbie);
      await page.press('I’ve clicked it');
      // The tab is already on Home (the check-your-inbox screen was over it), so Home greeting them by
      // the name from their record is the sign that the record has been saved.
      const home = await page.waitFor(`location.pathname === '/home' && ${page.has('Hi New')}`, 45000);
      const saved = await recordOf(uid);
      report('Once verified, the record is saved with the answers (home, the course, the three interests, a mentor wanted) and Home greets them by name',
        home && saved?.studentType === 'home' && saved?.wantsMentor === true && saved?.course === 'BSc Computer Science' && JSON.stringify(saved?.interests) === JSON.stringify(['Climbing', 'Gaming', 'Chess']) && saved?.name === 'New Student', JSON.stringify(saved));
      report('Home offers to find their mentor (they ticked the box), with Find my mentor going to the questions', (await page.waitFor(page.has('Find your mentor'))) && (await page.evaluate(`[...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Find my mentor' && a.getAttribute('href') === '/find-mentor')`)));
      report('...and no Finish your details card: nothing is missing', !(await page.evaluate(page.has('Finish your details'))));
      await page.press('Not now');
      report('"Not now" hides the mentor offer', await page.waitFor(`!${page.has('Find your mentor')}`));
      await page.go('/nhs-guide');
      await page.waitFor(`document.querySelector('main section h2')`);
      report('A home student’s NHS guide starts with Register with a GP, with the visa section further down under its own title', (await firstSection(page)) === 'Register with a GP' && (await page.evaluate(page.has(VISA_SECTION_TITLE))), await firstSection(page));
      const enrol = await enrolHowTo(page);
      report('A home student’s Enrol how-to has no Right to Study step and no pointer to Arriving late', enrol.includes('Student Portal') && !enrol.includes('Right to Study') && !enrol.includes('Arriving late'), enrol.slice(0, 80));
    });

    // 2. An international student: the visa section first, the visa step and the pointer, and the About you page.
    await inFreshChrome(async (page) => {
      report('An international student logs in', await page.logIn(intl, password));
      await page.go('/nhs-guide');
      await page.waitFor(`document.querySelector('main section h2')`);
      report('Their NHS guide starts with What you’ve paid for, as now', (await firstSection(page)) === 'What you’ve paid for', await firstSection(page));
      const enrol = await enrolHowTo(page);
      report('Their Enrol how-to keeps the Right to Study step and points to Arriving late', enrol.includes('Right to Study') && enrol.includes('Read Arriving late') && (await page.evaluate(`[...document.querySelectorAll('.pointer a')].some((a) => a.getAttribute('href') === '/late-arrivals')`)), enrol.slice(0, 80));
      await page.go('/about-you');
      report('What the chat knows about you says they said they’re an international student, with a way to change it', (await page.waitFor(page.has('You said you’re an international student'))) && (await page.evaluate(`[...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'change them' && a.getAttribute('href') === '/signup')`)));
      await page.go('/home');
      report('No mentor offer for a student who didn’t tick the box', (await page.waitFor(page.has('Hi Ines'))) && !(await page.evaluate(page.has('Find your mentor'))));
    });

    // 3. An account from before the questions: asked once, with what's known filled in.
    await inFreshChrome(async (page) => {
      report('An account from before the questions logs in', await page.logIn(old, password));
      report('Home asks them to finish their details', await page.waitFor(page.has('Finish your details')));
      await page.evaluate(`([...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Add my details').click(), true)`);
      const form = await page.waitFor(`location.pathname === '/signup' && ${page.has('You’re logged in, so these are saved to your account.')} && document.getElementById('name')?.value === 'Old Student' && document.getElementById('course')?.value === 'BA History' && !document.getElementById('email')`);
      report('The sign-up page shows only About you, with their name, course and interests filled in', form && (await page.evaluate(`[...document.querySelectorAll('.chip.picked')].map((c) => c.textContent.trim()).join(',')`)) === 'chess,gigs');
      await page.evaluate(`(document.querySelector('input[name=studentType][value=international]').click(), true)`);
      await page.press('Save');
      const back = await page.waitFor(`location.pathname === '/home' && ${page.has('Hi Old')}`);
      const saved = await recordOf(oldUid);
      report('Save keeps what they had, adds the answer, and Home no longer asks', back && saved?.studentType === 'international' && saved?.course === 'BA History' && JSON.stringify(saved?.interests) === JSON.stringify(['chess', 'gigs']) && !(await page.evaluate(page.has('Finish your details'))), JSON.stringify(saved));
    });
  } finally {
    app.stop();
  }
  return results;
}
