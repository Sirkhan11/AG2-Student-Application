import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

/**
 * True only in `vite dev --mode emulators`, for the browser checks (scripts/check-signed-in.mjs): the
 * app then talks to the local Auth, Firestore and Functions emulators (project demo-ag2) instead of
 * the real project, so the checks can sign in as verified test students without any real email, and
 * App Check uses a pretend token (app-check.js). Every build has another mode, so a build drops this.
 */
export const EMULATORS = import.meta.env.MODE === 'emulators';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: EMULATORS ? 'demo-ag2' : import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};


export const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

let authConnected = false;

export function getFirebaseAuth() {
  if (typeof window === 'undefined') {
    throw new Error('Firebase Auth must run in the browser');
  }

  const auth = getAuth(app);
  if (EMULATORS && !authConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    authConnected = true;
  }
  return auth;
}

export const db = getFirestore(app);
if (EMULATORS) connectFirestoreEmulator(db, '127.0.0.1', 8080);

/**
 * Where Firestore's REST API has this project's documents, for the one thing the app reads with a
 * plain request rather than the SDK: the access switch (src/lib/access.js), read before anyone has
 * logged in. The emulator's in emulators mode (no key), Google's otherwise, with the web API key.
 * @type {{ documentsUrl: string, apiKey?: string }}
 */
export const firestoreRest = EMULATORS
  ? { documentsUrl: 'http://127.0.0.1:8080/v1/projects/demo-ag2/databases/(default)/documents' }
  : { documentsUrl: `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`, apiKey: firebaseConfig.apiKey };

/** Where the app's one function runs (functions/index.js): London, with Firestore. */
export const FUNCTIONS_REGION = 'europe-west2';

let functionsConnected = false;

/**
 * Cloud Functions for this app, for calling readDeadlines (deadlines/read.js): the Functions
 * emulator in emulators mode, Google's otherwise. Browser only.
 */
export function getFirebaseFunctions() {
  if (typeof window === 'undefined') {
    throw new Error('Firebase Functions must be called from the browser');
  }
  const functions = getFunctions(app, FUNCTIONS_REGION);
  if (EMULATORS && !functionsConnected) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    functionsConnected = true;
  }
  return functions;
}
