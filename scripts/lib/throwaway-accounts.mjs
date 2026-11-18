// The throwaway accounts the live checks make in the real project (check-live-site.mjs and
// check-live-chat.mjs), and how none is ever left behind. On 18 November seven were: runs that died
// before their clean-up while the Mac's disk was full, as each check made its accounts before the
// part that cleans up (agent1.md A9). So now:
// - each account is written down before it's made (its made-up address and one-off password, in
//   LEFT_FILE: outside the repo, readable only by you) and crossed off once it's deleted;
// - each check makes its accounts inside the part that cleans up, and cleans up when it's stopped
//   (Ctrl-C) too;
// - every run first deletes any account still written down from a run that didn't finish (a process
//   that's killed outright can't clean up after itself), the way the checks delete their own: signed
//   in as the account, what it may have saved, then the account. scripts/delete-check-accounts.mjs
//   does the same on its own.
// Nothing in the file is ever printed.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { deleteUser, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { deleteDoc, doc, getFirestore } from 'firebase/firestore/lite';

/** Where the accounts are written down until they're deleted. */
export const LEFT_FILE = join(homedir(), '.cache', 'ag2-student-app', 'live-check-accounts.json');

/** @typedef {{ email: string, password: string }} Throwaway */
/** @typedef {Throwaway & { project: string }} WrittenDown */

/** @param {string} file @returns {WrittenDown[]} */
function writtenDown(file) {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {string} file @param {WrittenDown[]} list */
function save(file, list) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/**
 * Writes an account down before it's made.
 * @param {Throwaway} account @param {string} project @param {string} [file]
 */
export function writeDown(account, project, file = LEFT_FILE) {
  save(file, [...writtenDown(file).filter((item) => item.email !== account.email), { email: account.email, password: account.password, project }]);
}

/** Crosses an account off once it's gone. @param {string} email @param {string} [file] */
export function crossOff(email, file = LEFT_FILE) {
  save(file, writtenDown(file).filter((item) => item.email !== email));
}

/**
 * Deletes a throwaway account the way the checks do: signed in as it, what it may have saved
 * (students/{uid} and chatNotes/{uid}, for a verified one), then the account itself; then crosses
 * it off. "not-there"
 * when it was never made (the run stopped first) or is already gone; "failed" when it couldn't be
 * deleted now, in which case it stays written down for the next run.
 * @param {import('firebase/app').FirebaseApp} app the project's app
 * @param {Throwaway} account
 * @param {string} [file]
 * @returns {Promise<'deleted' | 'not-there' | 'failed'>}
 */
export async function deleteThrowaway(app, account, file = LEFT_FILE) {
  const auth = getAuth(app);
  let user;
  try {
    ({ user } = await signInWithEmailAndPassword(auth, account.email, account.password));
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err)?.code;
    // With its own password, only an account that isn't there can't sign in (with email enumeration
    // protection on, Firebase says invalid-credential for an address it doesn't have).
    if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      crossOff(account.email, file);
      return 'not-there';
    }
    return 'failed';
  }
  try {
    // Only a verified account can have saved anything: the rules let an unverified one write nothing
    // (and asking would only fill the log with refusals).
    if (user.emailVerified) {
      const db = getFirestore(app);
      for (const path of [`students/${user.uid}`, `chatNotes/${user.uid}`]) await deleteDoc(doc(db, path)).catch(() => {});
    }
    await deleteUser(user);
  } catch {
    await signOut(auth).catch(() => {});
    return 'failed';
  }
  crossOff(account.email, file);
  return 'deleted';
}

/**
 * Deletes every account still written down for this project by a run that didn't finish; any that
 * can't be deleted now stay written down for next time. Returns how many were deleted.
 * @param {import('firebase/app').FirebaseApp} app @param {string} project @param {string} [file]
 */
export async function deleteLeftovers(app, project, file = LEFT_FILE) {
  let deleted = 0;
  for (const account of writtenDown(file).filter((item) => item.project === project)) {
    if ((await deleteThrowaway(app, account, file)) === 'deleted') deleted += 1;
  }
  return deleted;
}

/**
 * Cleans up first when the run is stopped (Ctrl-C, or asked to end), then ends it. A process killed
 * outright can't: its accounts stay written down, and the next run deletes them.
 * @param {() => Promise<void>} cleanUp
 */
export function cleanUpWhenStopped(cleanUp) {
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.once(signal, () => {
      console.log(`\nStopped (${signal}): cleaning up first.`);
      cleanUp().finally(() => process.exit(130));
    });
  }
}
