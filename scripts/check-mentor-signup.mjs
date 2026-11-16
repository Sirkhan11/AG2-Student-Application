// Checks that /mentor-signup saved a mentor correctly in the split data model
// (public mentors/{uid} with item vectors + private mentorDetails/{uid} with Gemini's summaries, no email),
// and that the Firestore rules protect it: the item vector shape and 5-phrase cap, and sending an approved
// mentor back for checking if they change their display name or item vectors.
//
// It runs against whichever Firebase project .env points at, using throwaway test accounts:
// sign up a test mentor at /mentor-signup and a test student at /signup first.
//
// Run from the project folder. Before the coordinator approves the mentor:
//   TEST_MENTOR_EMAIL='...' TEST_MENTOR_PASSWORD='...' \
//   TEST_STUDENT_EMAIL='...' TEST_STUDENT_PASSWORD='...' \
//   node --env-file=.env scripts/check-mentor-signup.mjs
// After approving the mentor in the console, run it again with EXPECT_APPROVED=true added.
// That second run ends by editing the mentor's display name and item vectors, which (correctly) un-approves
// them, so re-approve the mentor in the console before running it with EXPECT_APPROVED=true again.
// The student details are optional; without them the "what a student can see" checks are skipped.
//
// It signs in as each test account, so the rules treat it exactly like that person's browser.
// It only writes to the test mentor's own two documents, and puts back everything it changes
// except approval, which only the coordinator can give back.
// Firestore may print "permission-denied" warnings: those are the attempts the rules are meant to block.

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
// "lite" is the REST-only Firestore client: no live connection to tidy up afterwards.
import {
  getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs
} from 'firebase/firestore/lite';

const mentorEmail = process.env.TEST_MENTOR_EMAIL;
const mentorPassword = process.env.TEST_MENTOR_PASSWORD;
const studentEmail = process.env.TEST_STUDENT_EMAIL;
const studentPassword = process.env.TEST_STUDENT_PASSWORD;
const expectApproved = process.env.EXPECT_APPROVED === 'true';

if (!mentorEmail || !mentorPassword || !process.env.VITE_FIREBASE_PROJECT_ID) {
  console.log('Firebase loaded OK. To run the checks, set TEST_MENTOR_EMAIL and TEST_MENTOR_PASSWORD');
  console.log('(and optionally the student ones) and run with --env-file=.env from the project folder.');
  process.exit(2);
}

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
});
const auth = getAuth(app);
const db = getFirestore(app);

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
function report(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
/** The rules should block this. @param {string} name @param {() => Promise<unknown>} action */
async function expectDenied(name, action) {
  try {
    await action();
    report(name, false, 'it was allowed, but the rules should block it');
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err).code;
    report(name, code === 'permission-denied', code ?? String(err));
  }
}
/** The rules should allow this. @param {string} name @param {() => Promise<any>} action */
async function expectAllowed(name, action) {
  try {
    const value = await action();
    report(name, true);
    return value;
  } catch (err) {
    report(name, false, /** @type {{ code?: string }} */ (err).code ?? String(err));
  }
}
/** @param {unknown} value */
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** all-MiniLM-L6-v2 vectors have 384 numbers, and Gemini gives at most 5 phrases per answer. */
const VECTOR_LENGTH = 384;
const MAX_PHRASES = 5;
const QUESTION_KEYS = 'q1,q2,q3,q4,q5,q6';
/**
 * Splits one question's flat list back into 384-number vectors (see mentors.js for the layout).
 * @param {number[]} flat
 */
function splitVectors(flat) {
  const vectors = [];
  for (let start = 0; start < flat.length; start += VECTOR_LENGTH) vectors.push(flat.slice(start, start + VECTOR_LENGTH));
  return vectors;
}
/** @param {number[]} vector */
const lengthOf = (vector) => Math.sqrt(vector.reduce((total, n) => total + n * n, 0));

console.log(`Project: ${process.env.VITE_FIREBASE_PROJECT_ID}`);
console.log(`Expecting the mentor to be ${expectApproved ? 'approved' : 'not approved yet'}.\n`);

// ---------- As the mentor ----------
const { user: mentor } = await signInWithEmailAndPassword(auth, mentorEmail, mentorPassword);
const publicRef = doc(db, 'mentors', mentor.uid);
const privateRef = doc(db, 'mentorDetails', mentor.uid);

/** Reads the public profile again and checks its approval. @param {string} name @param {boolean} expected */
async function checkApproval(name, expected) {
  const now = (await getDoc(publicRef)).data();
  report(name, now?.approved === expected, `approved is ${JSON.stringify(now?.approved)}`);
}

console.log('-- Public profile: mentors/{uid}');
const pub = (await expectAllowed('Mentor can read their own public profile', () => getDoc(publicRef)))?.data();
report('Public profile exists', Boolean(pub));
if (pub) {
  const keys = Object.keys(pub).sort().join(', ');
  report('It has only approved, displayName, itemVectors and maxStudents',
    keys === 'approved, displayName, itemVectors, maxStudents', `got ${keys}`);
  report(`approved is ${expectApproved}`, pub.approved === expectApproved, `got ${JSON.stringify(pub.approved)}`);
  report('displayName is filled in', isText(pub.displayName));
  report('maxStudents is a number from 1 to 5',
    typeof pub.maxStudents === 'number' && pub.maxStudents >= 1 && pub.maxStudents <= 5,
    `got ${JSON.stringify(pub.maxStudents)}`);

  const vectorKeys = Object.keys(pub.itemVectors ?? {}).sort();
  report('itemVectors has exactly q1 to q6', vectorKeys.join() === QUESTION_KEYS,
    `got ${vectorKeys.join() || 'nothing'}`);
  let totalVectors = 0;
  for (const key of vectorKeys) {
    const flat = pub.itemVectors[key];
    const ok = Array.isArray(flat) && flat.length % VECTOR_LENGTH === 0 && flat.length <= VECTOR_LENGTH * MAX_PHRASES
      && flat.every((/** @type {unknown} */ n) => typeof n === 'number');
    const vectors = ok ? splitVectors(flat) : [];
    totalVectors += vectors.length;
    // Normalised vectors have length 1, which is what lets similarity.js use a plain dot product.
    const lengths = vectors.map(lengthOf);
    report(`${key} holds 0 to 5 vectors of 384 numbers, each with length 1`,
      ok && lengths.every((length) => Math.abs(length - 1) < 1e-3),
      ok ? `${vectors.length} vector(s)` : `wrong shape: ${Array.isArray(flat) ? `${flat.length} numbers` : typeof flat}`);
  }
  report('At least one question has something to match on', totalVectors > 0, `${totalVectors} vectors in all`);
}

console.log('\n-- Private details: mentorDetails/{uid}');
const priv = (await expectAllowed('Mentor can read their own private details', () => getDoc(privateRef)))?.data();
report('Private details exist', Boolean(priv));
if (priv) {
  for (const field of ['name', 'course', 'availability', 'meetingFrequency']) {
    report(`${field} is filled in`, isText(priv[field]));
  }
  report('answers has 6 filled-in answers',
    Array.isArray(priv.answers) && priv.answers.length === 6 && priv.answers.every(isText));
  report('createdAt is a server timestamp', typeof priv.createdAt?.toDate === 'function');

  const summaryKeys = Object.keys(priv.summaries ?? {}).sort();
  report('summaries has exactly q1 to q6', summaryKeys.join() === QUESTION_KEYS,
    `got ${summaryKeys.join() || 'nothing'}`);
  for (const key of summaryKeys) {
    const phrases = priv.summaries[key];
    const ok = Array.isArray(phrases) && phrases.length <= MAX_PHRASES && phrases.every(isText);
    // The nth vector goes with the nth phrase, so match explanations can say which phrases matched.
    const flat = pub?.itemVectors?.[key];
    const vectorCount = Array.isArray(flat) ? flat.length / VECTOR_LENGTH : NaN;
    report(`${key} summary is 0 to 5 phrases, one per stored vector`, ok && vectorCount === phrases.length,
      ok ? `${phrases.length} phrase(s): ${JSON.stringify(phrases)}; ${vectorCount} vector(s)` : 'wrong shape');
  }
}

console.log('\n-- No email stored');
for (const [label, data] of /** @type {[string, any][]} */ ([['Public profile', pub], ['Private details', priv]])) {
  if (!data) continue;
  const emailField = Object.keys(data).find((key) => /e-?mail/i.test(key));
  const containsAddress = JSON.stringify(data).toLowerCase().includes(mentorEmail.toLowerCase());
  report(`${label} has no email field and doesn't contain the login email anywhere`,
    !emailField && !containsAddress, emailField ? `found field "${emailField}"` : containsAddress ? 'address found' : '');
}

console.log("\n-- What the mentor can and can't change");
if (pub) {
  await expectDenied(`Mentor cannot change their own approval (to ${!pub.approved})`,
    () => updateDoc(publicRef, { approved: !pub.approved }));
  await expectDenied('Mentor cannot add an email field to their public profile',
    () => updateDoc(publicRef, { email: mentorEmail }));
  const original = pub.maxStudents;
  await expectAllowed('Mentor can change maxStudents',
    () => updateDoc(publicRef, { maxStudents: original === 5 ? 4 : original + 1 }));
  await checkApproval('...without affecting their approval', expectApproved);
  await expectAllowed('...and it is put back', () => updateDoc(publicRef, { maxStudents: original }));
}
if (priv) {
  const original = priv.availability;
  await expectAllowed('Mentor can edit their private details (availability)',
    () => updateDoc(privateRef, { availability: `${original} (rules test)` }));
  await expectAllowed('...and it is put back', () => updateDoc(privateRef, { availability: original }));
}
await expectDenied('Listing mentors without the approved == true filter is blocked',
  () => getDocs(collection(db, 'mentors')));

// The edit tests change one question's vectors, so pick a question that has some (an empty one can't be
// nudged), and nudge its first number slightly.
const editKey = Object.keys(pub?.itemVectors ?? {}).sort()
  .find((key) => Array.isArray(pub?.itemVectors[key]) && pub?.itemVectors[key].length > 0);
const canTestEdits = Boolean(pub) && editKey !== undefined;
const editPath = `itemVectors.${editKey}`;
/** @type {number[]} */
const originalVectors = canTestEdits ? pub?.itemVectors[/** @type {string} */ (editKey)] : [];
const nudgedVectors = originalVectors.map((n, i) => (i === 0 ? n + 0.01 : n));
const editedName = `${pub?.displayName} (rules test)`;

console.log(`\n-- Changing what the coordinator checked (display name, item vectors for ${editKey ?? 'no question'})`);
if (canTestEdits && !expectApproved) {
  await expectAllowed('Unapproved mentor can change their display name',
    () => updateDoc(publicRef, { displayName: editedName }));
  await expectAllowed('...and it is put back', () => updateDoc(publicRef, { displayName: pub?.displayName }));
  await expectAllowed('Unapproved mentor can change their item vectors',
    () => updateDoc(publicRef, { [editPath]: nudgedVectors }));
  await expectAllowed('...and they are put back', () => updateDoc(publicRef, { [editPath]: originalVectors }));
  await checkApproval('...and they are still unapproved', false);
}
if (canTestEdits && expectApproved) {
  await expectDenied('Approved mentor cannot change their display name and stay approved',
    () => updateDoc(publicRef, { displayName: editedName }));
  await expectDenied('Approved mentor cannot change their item vectors and stay approved',
    () => updateDoc(publicRef, { [editPath]: nudgedVectors }));
  console.log('      (Making those changes with approved: false is tested at the end, as it un-approves the mentor.)');
}

// Shape checks only run while the mentor is unapproved. Then an edit with the right shape is allowed,
// so a refusal can only come from the shape rules. (For an approved mentor, any change to the vectors
// is refused anyway, so a refusal wouldn't prove anything about the shape.)
console.log('\n-- Item vector shape (5-phrase cap and whole vectors)');
if (canTestEdits && !expectApproved) {
  const oneVector = originalVectors.slice(0, VECTOR_LENGTH);
  await expectDenied('Mentor cannot store 6 vectors for one question (the cap is 5)',
    () => updateDoc(publicRef, { [editPath]: Array(MAX_PHRASES + 1).fill(oneVector).flat() }));
  await expectDenied('Mentor cannot store a vector that is not 384 numbers',
    () => updateDoc(publicRef, { [editPath]: oneVector.slice(0, VECTOR_LENGTH - 1) }));
  await expectDenied('Mentor cannot add a seventh question', () => updateDoc(publicRef, { 'itemVectors.q7': oneVector }));
  await expectDenied('Mentor cannot add the old whole-answer vectors field',
    () => updateDoc(publicRef, { vectors: { q1: oneVector } }));
  await expectAllowed('Mentor can store a question with no vectors (an empty summary)',
    () => updateDoc(publicRef, { [editPath]: [] }));
  await expectAllowed('...and it is put back', () => updateDoc(publicRef, { [editPath]: originalVectors }));
  await checkApproval('...and they are still unapproved', false);
} else {
  console.log('      Skipped: these only run before the mentor is approved.');
}
await signOut(auth);

// ---------- As a student ----------
if (studentEmail && studentPassword) {
  console.log('\n-- What a student can see');
  await signInWithEmailAndPassword(auth, studentEmail, studentPassword);
  if (expectApproved) {
    await expectAllowed("Student can read an approved mentor's public profile", () => getDoc(publicRef));
  } else {
    await expectDenied("Student cannot read an unapproved mentor's public profile", () => getDoc(publicRef));
  }
  await expectDenied("Student cannot read the mentor's private details", () => getDoc(privateRef));
  await expectDenied("Student cannot list anyone's private details", () => getDocs(collection(db, 'mentorDetails')));
  const list = await expectAllowed('Student can list mentors where approved == true',
    () => getDocs(query(collection(db, 'mentors'), where('approved', '==', true))));
  if (list) {
    const included = list.docs.some((/** @type {{ id: string }} */ d) => d.id === mentor.uid);
    report(`The test mentor is ${expectApproved ? '' : 'not '}in that list`, included === expectApproved,
      `${list.size} approved mentor(s) listed`);
  }
  await expectDenied('Student cannot approve or change a mentor', () => updateDoc(publicRef, { approved: true }));
  await signOut(auth);
} else {
  console.log('\n-- Student checks skipped (set TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD to run them)');
}

// ---------- Back to the mentor: an approved mentor edits their profile ----------
if (canTestEdits && expectApproved) {
  console.log('\n-- Sending an approved mentor back for checking');
  await signInWithEmailAndPassword(auth, mentorEmail, mentorPassword);
  await expectAllowed('Approved mentor can change their display name and item vectors if approved goes back to false',
    () => updateDoc(publicRef, { displayName: editedName, [editPath]: nudgedVectors, approved: false }));
  await checkApproval('...and they are now unapproved', false);
  await expectAllowed('...and the display name and item vectors are put back (still unapproved)',
    () => updateDoc(publicRef, { displayName: pub?.displayName, [editPath]: originalVectors }));
  await expectDenied('...and they cannot re-approve themselves', () => updateDoc(publicRef, { approved: true }));
  await signOut(auth);
  console.log('      The test mentor is now unapproved, as it should be after an edit. Re-approve it in the console.');
}

// ---------- Logged out ----------
console.log('\n-- Logged-out visitors');
await expectDenied('Cannot read the public profile', () => getDoc(publicRef));
await expectDenied('Cannot read the private details', () => getDoc(privateRef));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
