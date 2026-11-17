// Checks the Firestore rules for societies/{nsuId} (firestore.rules): a signed-in student can read a
// society's page but can't write one, and a logged-out visitor can't read one. Run it after
// publishing the rules (and, for the "it's there" check, after import-society-pages.mjs --write).
// It never prints the page's contents, as they include contact emails.
//
// Uses your test student from .env.test.local (git ignores it):
//   TEST_STUDENT_EMAIL=...   TEST_STUDENT_PASSWORD=...
// Run from the project folder:
//   node --env-file=.env --env-file=.env.test.local scripts/check-society-rules.mjs

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc, deleteDoc } from 'firebase/firestore/lite';

const env = process.env;
if (!env.TEST_STUDENT_EMAIL || !env.TEST_STUDENT_PASSWORD || !env.VITE_FIREBASE_PROJECT_ID) {
  console.log('Put TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD in .env.test.local and run with');
  console.log('--env-file=.env --env-file=.env.test.local from the project folder.');
  process.exit(2);
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID
});
const auth = getAuth(app);
const db = getFirestore(app);
const music = doc(db, 'societies', '64');

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
function report(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
/** @param {string} name @param {() => Promise<unknown>} action */
async function denied(name, action) {
  try {
    await action();
    report(name, false, 'it was allowed, but the rules should block it');
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err).code;
    report(name, code === 'permission-denied', code ?? String(err));
  }
}

console.log(`Project: ${env.VITE_FIREBASE_PROJECT_ID}\n`);
await signInWithEmailAndPassword(auth, env.TEST_STUDENT_EMAIL, env.TEST_STUDENT_PASSWORD);
try {
  const snapshot = await getDoc(music);
  report('A signed-in student can read a society\'s page (Music, 64)', true);
  report('...and it has been imported', snapshot.exists(), snapshot.exists() ? '' : 'not yet: run import-society-pages.mjs --write');
} catch (err) {
  report('A signed-in student can read a society\'s page (Music, 64)', false, /** @type {{ code?: string }} */ (err).code ?? String(err));
}
await denied('A signed-in student cannot change a society\'s page', () => setDoc(music, { name: 'Rules test' }, { merge: true }));
await denied('A signed-in student cannot add a society', () => setDoc(doc(db, 'societies', 'rules-test'), { name: 'Rules test' }));
await denied('A signed-in student cannot delete a society', () => deleteDoc(music));
await signOut(auth);
await denied('A logged-out visitor cannot read a society\'s page', () => getDoc(music));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
