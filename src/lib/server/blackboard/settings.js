import { BLACKBOARD_APP_KEY, BLACKBOARD_APP_SECRET, BLACKBOARD_COOKIE_KEY, BLACKBOARD_HOST } from '$app/env/private';
import { blackboardSettings } from './config.js';

/** The Blackboard settings from .env.local, read on the server only (see config.js). */
export const settings = blackboardSettings({
  host: BLACKBOARD_HOST,
  appKey: BLACKBOARD_APP_KEY,
  appSecret: BLACKBOARD_APP_SECRET,
  cookieKey: BLACKBOARD_COOKIE_KEY
});

/** The Firebase project students sign in to, whose ID tokens the Blackboard routes accept. */
export const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
