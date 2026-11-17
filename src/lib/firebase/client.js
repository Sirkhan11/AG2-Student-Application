import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

/**
 * True only in `vite dev --mode emulators`, for the browser checks (scripts/check-signed-in.mjs): the
 * app then talks to the local Auth and Firestore emulators (project demo-ag2) instead of the real
 * project, so the checks can sign in as verified test students without any real email. Every build
 * has another mode, so a build drops this.
 */
const EMULATORS = import.meta.env.MODE === 'emulators';

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
