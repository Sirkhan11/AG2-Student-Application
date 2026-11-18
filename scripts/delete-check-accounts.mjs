// Deletes any throwaway account the live checks (check-live-site.mjs, check-live-chat.mjs) wrote down
// and couldn't delete, such as after a run that was killed before it could clean up. It deletes them
// the way the checks delete their own: signed in as each account, what it may have saved, then the
// account. Every live check run does this first anyway; this is for doing it now. It touches no other
// account: only the ones written down in scripts/lib/throwaway-accounts.mjs's file, which only the
// checks write to. Nothing secret is printed.
//
// From the project folder:
//   node --env-file=.env scripts/delete-check-accounts.mjs

import { initializeApp } from 'firebase/app';
import { deleteLeftovers } from './lib/throwaway-accounts.mjs';

const env = process.env;
if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID) {
  console.log('Missing the Firebase settings. Run it with --env-file=.env, as above.');
  process.exit(2);
}
const app = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
const deleted = await deleteLeftovers(app, env.VITE_FIREBASE_PROJECT_ID);
console.log(deleted ? `Deleted ${deleted} throwaway account${deleted === 1 ? '' : 's'} a live check left behind.` : 'No throwaway accounts left behind.');
process.exit(0);
