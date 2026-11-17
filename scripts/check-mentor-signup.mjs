// Checks that /mentor-signup saved a mentor correctly in the split data model
// (public mentors/{uid} with item vectors + private mentorDetails/{uid} with Gemini's summaries, no email),
// and that the Firestore rules protect it: the item vector shape and 5-phrase cap, and sending an approved
// mentor back for checking if they change their display name or item vectors.
//
// It runs against whichever Firebase project .env points at, using throwaway test accounts:
// sign up a test mentor at /mentor-signup and a test student at /signup first.
//
// Put the test logins in .env.test.local in the project folder. Git ignores it, so the passwords
// never reach the repo or your terminal history:
//   TEST_MENTOR_EMAIL=...
//   TEST_MENTOR_PASSWORD=...
//   TEST_STUDENT_EMAIL=...      (the student is optional; without it those checks are skipped)
//   TEST_STUDENT_PASSWORD=...
// Run from the project folder. Before the coordinator approves the mentor:
//   node --env-file=.env --env-file=.env.test.local scripts/check-mentor-signup.mjs
// After approving the mentor in the console, run it again with EXPECT_APPROVED=true in front:
//   EXPECT_APPROVED=true node --env-file=.env --env-file=.env.test.local scripts/check-mentor-signup.mjs
// That second run ends by editing the mentor's display name and item vectors, which (correctly) un-approves
// them, so re-approve the mentor in the console before running it with EXPECT_APPROVED=true again.
// The student details are optional; without them the student and capacity checks are skipped.
//
// Capacity: a student takes one of a mentor's places by creating matches/{their uid} and adding 1 to the
// mentor's studentCount in one batch (see src/lib/matching/matches.js). The script tries every way of
// abusing that, each of which must be refused. In the approved run it then takes a real place with the
// test student, which the app can't undo. So before each approved run, in the Firebase console:
//   - set the test mentor's studentCount to 2, as if two places were already taken (the "past maxStudents"
//     and "maxStudents below studentCount" checks need some places taken), and
//   - delete matches/{test student's uid} if an earlier run created it.
// While it runs, the script sets the mentor's maxStudents to 5 so there's room, and puts it back at the end.
//
// It signs in as each test account, so the rules treat it exactly like that person's browser.
// It only writes to the test mentor's two documents and the test student's match. It puts back everything
// it changes except approval (which only the coordinator can give back) and the place the student takes.
// Firestore may print "permission-denied" warnings: those are the attempts the rules are meant to block.

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
// "lite" is the REST-only Firestore client: no live connection to tidy up afterwards.
import {
  getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs, writeBatch, increment, serverTimestamp
} from 'firebase/firestore/lite';
import { STYLES } from '#lib/matching/summary-prompt.js';

const mentorEmail = process.env.TEST_MENTOR_EMAIL;
const mentorPassword = process.env.TEST_MENTOR_PASSWORD;
const studentEmail = process.env.TEST_STUDENT_EMAIL;
const studentPassword = process.env.TEST_STUDENT_PASSWORD;
const expectApproved = process.env.EXPECT_APPROVED === 'true';

if (!mentorEmail || !mentorPassword || !process.env.VITE_FIREBASE_PROJECT_ID) {
  console.log('Firebase loaded OK. To run the checks, put TEST_MENTOR_EMAIL and TEST_MENTOR_PASSWORD (and');
  console.log('optionally the student ones) in .env.test.local, then from the project folder run:');
  console.log('  node --env-file=.env --env-file=.env.test.local scripts/check-mentor-signup.mjs');
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
  report('It has only approved, displayName, itemVectors, maxStudents and studentCount',
    keys === 'approved, displayName, itemVectors, maxStudents, studentCount', `got ${keys}`);
  report(`approved is ${expectApproved}`, pub.approved === expectApproved, `got ${JSON.stringify(pub.approved)}`);
  report('displayName is filled in', isText(pub.displayName));
  report('maxStudents is a whole number from 1 to 5',
    Number.isInteger(pub.maxStudents) && pub.maxStudents >= 1 && pub.maxStudents <= 5,
    `got ${JSON.stringify(pub.maxStudents)}`);
  report('studentCount is a whole number from 0 to maxStudents',
    Number.isInteger(pub.studentCount) && pub.studentCount >= 0 && pub.studentCount <= pub.maxStudents,
    `got ${JSON.stringify(pub.studentCount)}`);

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

  // summaries holds likes and avoids (one list per question, q1 to q6) and styles.
  report('summaries has likes, avoids and styles', Object.keys(priv.summaries ?? {}).sort().join() === 'avoids,likes,styles',
    `got ${Object.keys(priv.summaries ?? {}).sort().join() || 'nothing'}`);
  for (const part of ['likes', 'avoids']) {
    const keys = Object.keys(priv.summaries?.[part] ?? {}).sort();
    report(`summaries.${part} has exactly q1 to q6`, keys.join() === QUESTION_KEYS, `got ${keys.join() || 'nothing'}`);
    for (const key of keys) {
      const phrases = priv.summaries[part][key];
      const ok = Array.isArray(phrases) && phrases.length <= MAX_PHRASES && phrases.every(isText);
      if (part === 'avoids') {
        report(`${key} avoids are 0 to 5 phrases`, ok, ok ? `${phrases.length} phrase(s)` : 'wrong shape');
        continue;
      }
      // Only likes are embedded. The nth vector goes with the nth liked phrase, so match
      // explanations can say which phrases matched.
      const flat = pub?.itemVectors?.[key];
      const vectorCount = Array.isArray(flat) ? flat.length / VECTOR_LENGTH : NaN;
      report(`${key} likes are 0 to 5 phrases, one per stored vector`, ok && vectorCount === phrases.length,
        ok ? `${phrases.length} phrase(s): ${JSON.stringify(phrases)}; ${vectorCount} vector(s)` : 'wrong shape');
    }
  }
  const styles = priv.summaries?.styles ?? {};
  report('summaries.styles has social, planning and working, each an allowed value or null',
    Object.keys(styles).sort().join() === 'planning,social,working' &&
      Object.entries(STYLES).every(([name, values]) => styles[name] === null || values.includes(styles[name])),
    JSON.stringify(styles));
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
  const count = Number.isInteger(pub.studentCount) ? pub.studentCount : 0;
  // Another value the rules should accept: a whole number from 1 to 5, not below studentCount.
  const otherMax = [1, 2, 3, 4, 5].find((n) => n !== original && n >= count);
  if (otherMax !== undefined) {
    await expectAllowed(`Mentor can change maxStudents (to ${otherMax})`,
      () => updateDoc(publicRef, { maxStudents: otherMax }));
    await checkApproval('...without affecting their approval', expectApproved);
    await expectAllowed('...and it is put back', () => updateDoc(publicRef, { maxStudents: original }));
  }
  for (const bad of [0, 6, 1000, 2.5, '3']) {
    await expectDenied(`Mentor cannot set maxStudents to ${JSON.stringify(bad)} (must be a whole number from 1 to 5)`,
      () => updateDoc(publicRef, { maxStudents: bad }));
  }
  await expectDenied('Mentor cannot change their own studentCount',
    () => updateDoc(publicRef, { studentCount: count + 1 }));
  if (count >= 2) {
    // count - 1 is a valid maxStudents (1 to 5), so only the "not below studentCount" rule can refuse it.
    await expectDenied(`Mentor cannot lower maxStudents below studentCount (${count - 1}, with ${count} places taken)`,
      () => updateDoc(publicRef, { maxStudents: count - 1 }));
  } else {
    console.log(`      Skipped "lowering maxStudents below studentCount": needs studentCount 2 or more (it's ${count}).`);
    console.log('      Set the test mentor\'s studentCount to 2 in the console to run it.');
  }
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

// ---------- Taking a place (capacity) ----------

/** Signs out whoever is signed in, then signs in with this account. @param {string} email @param {string} password */
async function signInAs(email, password) {
  await signOut(auth);
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}
const asMentor = () => signInAs(mentorEmail, mentorPassword);
const asStudent = () => signInAs(String(studentEmail), String(studentPassword));

/**
 * Sorts object keys all the way down, so two reads of the same document compare equal as JSON
 * even if the map keys come back in a different order.
 * @param {unknown} value
 * @returns {unknown}
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(/** @type {any} */ (value)[key])]));
  }
  return value;
}

/**
 * The capacity checks. A student takes a place the way matches.js does it: one batch that creates
 * matches/{their uid} and adds 1 to the mentor's studentCount. Each abuse check changes exactly one thing
 * from that while the mentor has room, so a refusal can only come from the rule being tested.
 * @param {string} studentUid
 */
async function checkTakingPlaces(studentUid) {
  console.log('\n-- Taking a place (capacity)');
  const myMatchRef = doc(db, 'matches', studentUid);

  /** A match as matches.js writes it, to this mentor, plus any extra fields. @param {string} mentorId @param {object} [extra] */
  const matchData = (mentorId, extra = {}) => ({
    status: 'matched', mentorId, mentorName: 'Rules test', reasons: ['rules test'],
    meetingFrequency: 'every two weeks', availability: 'rules test', createdAt: serverTimestamp(), ...extra
  });

  /**
   * Tries to take a place. With no options it's exactly what the app does; each option swaps in one change.
   * null leaves that write out of the batch.
   * @param {{ matchId?: string, match?: object | null, mentorChange?: object | null }} [options]
   */
  function takePlace({ matchId = studentUid, match = matchData(mentor.uid), mentorChange = { studentCount: increment(1) } } = {}) {
    const batch = writeBatch(db);
    if (match) batch.set(doc(db, 'matches', matchId), match);
    if (mentorChange) batch.update(publicRef, mentorChange);
    return batch.commit();
  }

  // Start as the mentor: a student can't read an unapproved mentor's profile.
  await asMentor();
  const start = (await getDoc(publicRef)).data();
  const count = start?.studentCount;
  const originalMax = start?.maxStudents;
  if (!Number.isInteger(count)) {
    report('The test mentor has a studentCount to test with', false, 'add studentCount (a number) in the console');
    return;
  }
  if (count > 3) {
    console.log(`      Skipped: these checks need studentCount 3 or less (it's ${count}), so there's room to test with.`);
    return;
  }
  // maxStudents 5 leaves room even for "adding 2", so that check can only fail because it adds 2.
  await expectAllowed('(setup) Mentor sets maxStudents to 5, so there is room', () => updateDoc(publicRef, { maxStudents: 5 }));

  await asStudent();
  const hadMatch = (await getDoc(myMatchRef)).exists();

  if (!expectApproved) {
    if (hadMatch) {
      console.log(`      Skipped "unapproved mentor": the test student already has a match. Delete matches/${studentUid} first.`);
    } else {
      await expectDenied('Student cannot take a place with an unapproved mentor', () => takePlace());
    }
  } else if (hadMatch) {
    console.log('      The test student already has a match, so only the "second place" check can run.');
    console.log(`      To run them all: delete matches/${studentUid} in the console and set studentCount back to 2.`);
  } else {
    await expectDenied('Student cannot add 2 to studentCount',
      () => takePlace({ mentorChange: { studentCount: increment(2) } }));
    await expectDenied('Student cannot add 1 without creating a match', () => takePlace({ match: null }));
    await expectDenied('Student cannot create a match without taking a place', () => takePlace({ mentorChange: null }));
    await expectDenied('Student cannot add 1 while creating a match to a different mentor',
      () => takePlace({ match: matchData('some-other-mentor') }));
    await expectDenied('Student cannot change anything else while taking a place (here, approved)',
      () => takePlace({ mentorChange: { studentCount: increment(1), approved: false } }));
    await expectDenied("Student cannot create a match for someone else's uid (here, the mentor's)",
      () => takePlace({ matchId: mentor.uid }));
    await expectDenied('A match cannot have extra fields (here, an email)',
      () => takePlace({ match: matchData(mentor.uid, { email: studentEmail }) }));

    if (count >= 1) {
      // Full: maxStudents equal to studentCount, so one more place would go past it.
      await asMentor();
      await expectAllowed(`(setup) Mentor sets maxStudents to ${count}, so they're full`,
        () => updateDoc(publicRef, { maxStudents: count }));
      await asStudent();
      await expectDenied('Student cannot take a place past maxStudents', () => takePlace());
      await asMentor();
      await expectAllowed('(setup) Mentor sets maxStudents back to 5', () => updateDoc(publicRef, { maxStudents: 5 }));
      await asStudent();
    } else {
      console.log('      Skipped "past maxStudents": needs studentCount 1 or more. Set it to 2 in the console.');
    }

    // The real thing, which the app can't undo.
    const before = (await getDoc(publicRef)).data();
    await expectAllowed('Student CAN take a place with an approved mentor who has room', () => takePlace());
    const after = (await getDoc(publicRef)).data();
    report('studentCount went up by exactly 1', after?.studentCount === before?.studentCount + 1,
      `${before?.studentCount} → ${after?.studentCount}`);
    report('The mentor is still approved', after?.approved === true);
    /** @param {any} data */
    const everythingButCount = (data) => JSON.stringify(canonical({ ...data, studentCount: null }));
    report('Nothing else on the mentor changed', everythingButCount(before) === everythingButCount(after));
    const myMatch = await expectAllowed('Student can read their own match', () => getDoc(myMatchRef));
    report('Their match names the test mentor', myMatch?.data()?.mentorId === mentor.uid);
  }

  if (expectApproved && (await getDoc(myMatchRef)).exists()) {
    await expectDenied('Student cannot take a second place (they already have a match)', () => takePlace());
  }

  // Back to the mentor: they can't see the match, and maxStudents goes back to what it was.
  await asMentor();
  await expectDenied("Mentor cannot read the student's match", () => getDoc(myMatchRef));
  const countNow = (await getDoc(publicRef)).data()?.studentCount ?? 0;
  const restoreTo = Math.max(originalMax, countNow);
  await expectAllowed(`(setup) Mentor puts maxStudents back to ${restoreTo}`,
    () => updateDoc(publicRef, { maxStudents: restoreTo }));
  if (restoreTo !== originalMax) console.log(`      (It was ${originalMax}, but that's now below studentCount.)`);
  await signOut(auth);
}

// ---------- As a student ----------
let studentUid = '';
if (studentEmail && studentPassword) {
  console.log('\n-- What a student can see');
  studentUid = (await signInWithEmailAndPassword(auth, studentEmail, studentPassword)).user.uid;
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

  await checkTakingPlaces(studentUid);
} else {
  console.log('\n-- Student and capacity checks skipped (add TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD to .env.test.local to run them)');
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
if (studentUid) await expectDenied("Cannot read a student's match", () => getDoc(doc(db, 'matches', studentUid)));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
