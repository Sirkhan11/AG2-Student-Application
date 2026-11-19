import { calendarLinkFrom } from '#shared/calendar-link.js';

// What the app keeps on the phone for deadlines: the student's Blackboard calendar link and the last
// deadlines it gave (titles and times), in the browser's localStorage under one key per app user,
// ag2.deadlines.<uid>. That key is the only place the link lives (functions/shared/calendar-link.js
// says why it's a key): never the student's record, never an address, never Gemini. Forgetting the
// link deletes the key; logging out deletes every such key, whoever was logged in, so a shared
// computer keeps nothing. Storage is passed in so check-deadlines.mjs can test it in Node, and every
// read and write is guarded: where storage fails (a private window), the student is simply asked to
// paste the link again.

/** @typedef {import('#shared/calendar-feed.js').Deadline} Deadline */
/** What's kept: the link, when the deadlines were last read (null: not yet), and the deadlines. @typedef {{ link: string, readAt: string | null, deadlines: Deadline[] }} Kept */
/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>} SimpleStorage */

/** Every key the app uses for this starts so; the rest is the app user's uid. */
export const KEY_PREFIX = 'ag2.deadlines.';

/** @param {string} uid */
export const keyFor = (uid) => `${KEY_PREFIX}${uid}`;

/** The browser's localStorage, or undefined where there isn't one (or it's blocked). */
function deviceStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** @param {unknown} value @returns {value is Deadline} */
const isDeadline = (value) =>
  typeof value === 'object' && value !== null
  && typeof (/** @type {Deadline} */ (value)).id === 'string' && typeof (/** @type {Deadline} */ (value)).title === 'string'
  && typeof (/** @type {Deadline} */ (value)).at === 'string' && !Number.isNaN(Date.parse((/** @type {Deadline} */ (value)).at));

/**
 * What's kept for this student, or null when nothing is (or what's there isn't a link).
 * @param {string} uid
 * @param {SimpleStorage} [storage]
 * @returns {Kept | null}
 */
export function readKept(uid, storage = deviceStorage()) {
  try {
    const kept = JSON.parse(storage?.getItem(keyFor(uid)) ?? 'null');
    const link = calendarLinkFrom(kept?.link);
    if (!link) return null;
    return {
      link,
      readAt: typeof kept.readAt === 'string' && !Number.isNaN(Date.parse(kept.readAt)) ? kept.readAt : null,
      deadlines: Array.isArray(kept.deadlines) ? kept.deadlines.filter(isDeadline) : []
    };
  } catch {
    return null;
  }
}

/** @param {string} uid @param {Kept} kept @param {SimpleStorage | undefined} storage */
function write(uid, kept, storage) {
  try {
    storage?.setItem(keyFor(uid), JSON.stringify(kept));
    return storage !== undefined;
  } catch {
    return false;
  }
}

/**
 * Keeps the link (and forgets any deadlines from an earlier one). False when the browser won't keep
 * anything, so the page can say so.
 * @param {string} uid
 * @param {string} link a link calendarLinkFrom accepted
 * @param {SimpleStorage} [storage]
 */
export function keepLink(uid, link, storage = deviceStorage()) {
  return calendarLinkFrom(link) === link && write(uid, { link, readAt: null, deadlines: [] }, storage);
}

/**
 * Keeps what the function just gave, beside the link. Nothing is kept if there's no link (forgotten
 * while the read was on its way).
 * @param {string} uid
 * @param {{ deadlines: Deadline[], readAt: string }} read
 * @param {SimpleStorage} [storage]
 */
export function keepDeadlines(uid, { deadlines, readAt }, storage = deviceStorage()) {
  const kept = readKept(uid, storage);
  if (!kept) return false;
  return write(uid, { link: kept.link, readAt, deadlines: deadlines.filter(isDeadline) }, storage);
}

/** Forgets the link and the deadlines: nothing of the student's is left on the phone. @param {string} uid @param {SimpleStorage} [storage] */
export function forgetDeadlines(uid, storage = deviceStorage()) {
  try {
    storage?.removeItem(keyFor(uid));
  } catch {
    // Nothing to delete.
  }
}

/** On log out: forgets every student's, whoever was logged in on this browser. @param {SimpleStorage} [storage] */
export function forgetAllDeadlines(storage = deviceStorage()) {
  try {
    if (!storage) return;
    /** @type {string[]} */
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage is blocked: there's nothing in it to forget.
  }
}
