// Checks that /mentor-signup saved a mentor correctly in the split data model
// (public mentors/{uid} + private mentorDetails/{uid}, no email), and that the Firestore rules protect it,
// including sending an approved mentor back for checking if they change their display name or vectors.
//
// It runs against whichever Firebase project .env points at, using throwaway test accounts:
// sign up a test mentor at /mentor-signup and a test student at /signup first.
//
// Run from the project folder. Before the coordinator approves the mentor:
//   TEST_MENTOR_EMAIL='...' TEST_MENTOR_PASSWORD='...' \
//   TEST_STUDENT_EMAIL='...' TEST_STUDENT_PASSWORD='...' \
//   node --env-file=.env scripts/check-mentor-signup.mjs
// After approving the mentor in the console, run it again with EXPECT_APPROVED=true added.
// That second run ends by editing the mentor's display name and vectors, which (correctly) un-approves
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
  report('It has only approved, displayName, maxStudents and vectors',
    keys === 'approved, displayName, maxStudents, vectors', `got ${keys}`);
  report(`approved is ${expectApproved}`, pub.approved === expectApproved, `got ${JSON.stringify(pub.approved)}`);
  report('displayName is filled in', isText(pub.displayName));
  report('maxStudents is a number from 1 to 5',
    typeof pub.maxStudents === 'number' && pub.maxStudents >= 1 && pub.maxStudents <= 5,
    `got ${JSON.stringify(pub.maxStudents)}`);

  const vectorKeys = Object.keys(pub.vectors ?? {}).sort();
  report('vectors has exactly q1 to q6', vectorKeys.join() === 'q1,q2,q3,q4,q5,q6',
    `got ${vectorKeys.join() || 'nothing'}`);
  for (const key of vectorKeys) {
    const v = pub.vectors[key];
    const ok = Array.isArray(v) && v.length === 384 && v.every((/** @type {unknown} */ n) => typeof n === 'number');
    // Normalised vectors have length 1, which is what lets similarity.js use a plain dot product.
    const length = ok ? Math.sqrt(v.reduce((/** @type {number} */ t, /** @type {number} */ n) => t + n * n, 0)) : NaN;
    report(`${key} is 384 numbers with length 1`, ok && Math.abs(length - 1) < 1e-3,
      ok ? `length ${length.toFixed(4)}` : 'wrong shape');
  }
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

// A display name and a slightly nudged q1 vector, used to test edits the coordinator would need to re-check.
const canTestEdits = Boolean(pub) && Array.isArray(pub?.vectors?.q1);
const editedName = `${pub?.displayName} (rules test)`;
const nudgedQ1 = canTestEdits ? pub?.vectors.q1.map((/** @type {number} */ n, /** @type {number} */ i) => (i === 0 ? n + 0.01 : n)) : [];

console.log('\n-- Changing what the coordinator checked (display name, vectors)');
if (canTestEdits && !expectApproved) {
  await expectAllowed('Unapproved mentor can change their display name',
    () => updateDoc(publicRef, { displayName: editedName }));
  await expectAllowed('...and it is put back', () => updateDoc(publicRef, { displayName: pub?.displayName }));
  await expectAllowed('Unapproved mentor can change their vectors', () => updateDoc(publicRef, { 'vectors.q1': nudgedQ1 }));
  await expectAllowed('...and they are put back', () => updateDoc(publicRef, { 'vectors.q1': pub?.vectors.q1 }));
  await checkApproval('...and they are still unapproved', false);
}
if (canTestEdits && expectApproved) {
  await expectDenied('Approved mentor cannot change their display name and stay approved',
    () => updateDoc(publicRef, { displayName: editedName }));
  await expectDenied('Approved mentor cannot change their vectors and stay approved',
    () => updateDoc(publicRef, { 'vectors.q1': nudgedQ1 }));
  console.log('      (Making those changes with approved: false is tested at the end, as it un-approves the mentor.)');
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
  await expectAllowed('Approved mentor can change their display name and vectors if approved goes back to false',
    () => updateDoc(publicRef, { displayName: editedName, 'vectors.q1': nudgedQ1, approved: false }));
  await checkApproval('...and they are now unapproved', false);
  await expectAllowed('...and the display name and vectors are put back (still unapproved)',
    () => updateDoc(publicRef, { displayName: pub?.displayName, 'vectors.q1': pub?.vectors.q1 }));
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
