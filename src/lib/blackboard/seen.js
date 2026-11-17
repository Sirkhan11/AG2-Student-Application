// What the student has already seen in each Blackboard module, kept on this device only (in
// localStorage, per app user): the ids of content and announcements, never titles or text. "New"
// means not seen before; the first time, anything from the last 7 days counts as new. Opening a
// module's full list marks it seen. Disconnecting or logging out deletes it all.
// The storage is passed in, so check-blackboard.mjs can test it in Node; every read and write is
// guarded, so a private window (where storage can fail) just shows nothing as new.

const DAY = 86_400_000;
/** The first time, things from this many days ago count as new. */
export const FIRST_VISIT_DAYS = 7;

/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} SimpleStorage */
/** @typedef {{ seen: Record<string, string[]>, guideDone?: boolean }} Kept */

/** @param {string} uid */
const keyFor = (uid) => `ag2.blackboard.${uid}`;

/** @param {string} uid @param {SimpleStorage | undefined} storage @returns {Kept} */
function read(uid, storage) {
  try {
    const kept = JSON.parse(storage?.getItem(keyFor(uid)) ?? 'null');
    return kept && typeof kept === 'object' && kept.seen && typeof kept.seen === 'object' ? kept : { seen: {} };
  } catch {
    return { seen: {} };
  }
}

/** @param {string} uid @param {Kept} kept @param {SimpleStorage | undefined} storage */
function write(uid, kept, storage) {
  try {
    storage?.setItem(keyFor(uid), JSON.stringify(kept));
  } catch {
    // Storage is full or blocked: nothing is remembered, which is fine.
  }
}

/** The browser's localStorage, or undefined where there isn't one (or it's blocked). */
function deviceStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** @param {import('./shapes.js').Module} module */
const itemsOf = (module) => [
  ...module.content.map((item) => /** @type {[string, string]} */ ([item.id, item.created])),
  ...module.announcements.map((item) => /** @type {[string, string]} */ ([item.id, item.posted]))
];

/**
 * The ids of the module's content and announcements the student hasn't seen.
 * @param {string} uid
 * @param {import('./shapes.js').Module} module
 * @param {number} [now]
 * @param {SimpleStorage} [storage]
 * @returns {Set<string>}
 */
export function newIds(uid, module, now = Date.now(), storage = deviceStorage()) {
  const seen = read(uid, storage).seen[module.id];
  const items = itemsOf(module);
  if (!seen) return new Set(items.filter(([, date]) => now - Date.parse(date) <= FIRST_VISIT_DAYS * DAY).map(([id]) => id));
  const known = new Set(seen);
  return new Set(items.filter(([id]) => !known.has(id)).map(([id]) => id));
}

/**
 * Remembers everything in the module now as seen.
 * @param {string} uid
 * @param {import('./shapes.js').Module} module
 * @param {SimpleStorage} [storage]
 */
export function markSeen(uid, module, storage = deviceStorage()) {
  const kept = read(uid, storage);
  kept.seen[module.id] = itemsOf(module).map(([id]) => id);
  write(uid, kept, storage);
}

/** True once the student has closed the Outlook guide. @param {string} uid @param {SimpleStorage} [storage] */
export const guideDone = (uid, storage = deviceStorage()) => read(uid, storage).guideDone === true;

/** @param {string} uid @param {SimpleStorage} [storage] */
export function closeGuide(uid, storage = deviceStorage()) {
  const kept = read(uid, storage);
  kept.guideDone = true;
  write(uid, kept, storage);
}

/** Deletes everything kept on this device for the student's Blackboard. @param {string} uid @param {SimpleStorage} [storage] */
export function forgetOnDevice(uid, storage = deviceStorage()) {
  try {
    storage?.removeItem(keyFor(uid));
  } catch {
    // Nothing to delete.
  }
}
