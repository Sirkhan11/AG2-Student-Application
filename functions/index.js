// AG2's one Cloud Function, readDeadlines: a signed-in student's app sends the private link to their
// Blackboard calendar, and this fetches it (a page on our site can't: Blackboard only lets its own
// pages read it) and answers with the titles and times in it. Nothing is kept: the link arrives in the
// body of the request, is used for one fetch and is gone; nothing here logs anything (the platform's
// own request log has the path and status, which never hold the link); no Firestore write; nothing to
// do with Gemini. Who can call it is the database's own gate (shared/access-gate.js): a verified
// Northumbria account (or any verified address while the access switch is off), from the AG2 app
// (App Check, enforced as it is for Gemini). What it fetches is as narrow as lib/read-deadlines.js
// makes it. In europe-west2 (London), with Firestore, and capped at two instances so that a mistake or
// misuse can't run up a bill. Deployed on its own: firebase deploy --only functions (see the README).

import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { accessProblem } from './shared/access-gate.js';
import { ReadError, readDeadlinesFor } from './lib/read-deadlines.js';

setGlobalOptions({
  region: 'europe-west2',
  maxInstances: 2,
  // Enough for a fetch and a small file; one CPU so an instance can serve several students at once
  // (the work is waiting on Blackboard, not computing).
  memory: '256MiB',
  cpu: 1,
  concurrency: 10,
  timeoutSeconds: 20
});

// The function's own identity (no key anywhere): enough to read the access switch.
initializeApp();

/** True inside the Firebase emulator, which sets this; never on Google Cloud. */
const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
/** The pretend Blackboard for the checks (functions/.env.demo-ag2), honoured in the emulator only. */
const PRETEND_ORIGIN = EMULATOR ? (process.env.PRETEND_BLACKBOARD_ORIGIN ?? '') : '';

/** The access switch, read as firestore.rules read it: Northumbria only unless uniOnly is exactly false. */
async function uniOnly() {
  const access = await getFirestore().doc('config/access').get();
  return access.get('uniOnly') !== false;
}

export const readDeadlines = onCall({ enforceAppCheck: true }, async (request) => {
  const caller = request.auth
    ? { uid: request.auth.uid, email: request.auth.token.email, emailVerified: request.auth.token.email_verified === true }
    : null;
  const problem = await accessProblem(caller, uniOnly);
  if (problem === 'unauthenticated') throw new HttpsError('unauthenticated', 'Log in first.');
  if (problem === 'unverified') throw new HttpsError('permission-denied', 'Verify your email address first.');
  if (problem) throw new HttpsError('permission-denied', 'AG2 is for Northumbria students.');

  try {
    return await readDeadlinesFor(request.data, { emulator: EMULATOR, pretendOrigin: PRETEND_ORIGIN });
  } catch (err) {
    // The app tells the link's problems apart from a function that isn't there (both come back as
    // not-found to it) by this detail.
    if (err instanceof ReadError) throw new HttpsError(err.code, err.message, { about: 'calendar' });
    throw new HttpsError('internal', 'Something went wrong reading your deadlines.');
  }
});
