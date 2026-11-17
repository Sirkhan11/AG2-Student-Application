// A sign-up waiting for the email to be verified. firestore.rules only let a verified Northumbria
// account read or write anything, so a new student's record, or a new mentor's profile, can't be
// saved until they've clicked the link in the email. Until then it waits here, in this browser tab
// only (sessionStorage, gone when the tab closes), and finishSignUp (finish.js) saves it once the
// account is verified. No Firebase here, so the checks can test it in Node.

const KEY = 'ag2-signup-waiting';

/**
 * What waits: the account it belongs to, and the student's record or the mentor's two documents.
 * @typedef {{ uid: string, student?: Record<string, unknown>,
 *   mentor?: { profile: Record<string, unknown>, details: Record<string, unknown> } }} Waiting
 */

/** This tab's sessionStorage, if the browser lets the page use it (reading it can throw). */
function tabStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * The sign-up waiting in this tab. Storage can be missing or refuse (a private window, a full or
 * blocked store), so every call is wrapped: then nothing waits, and the account still works.
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined} [storage]
 */
export function waitingSignUp(storage = tabStorage()) {
  return {
    /** @param {Waiting} waiting */
    save(waiting) {
      try {
        storage?.setItem(KEY, JSON.stringify(waiting));
      } catch {
        // Nothing waits; the account is still made.
      }
    },
    /** @returns {Waiting | null} */
    load() {
      try {
        const raw = storage?.getItem(KEY);
        const waiting = raw ? JSON.parse(raw) : null;
        return waiting && typeof waiting.uid === 'string' ? waiting : null;
      } catch {
        return null;
      }
    },
    clear() {
      try {
        storage?.removeItem(KEY);
      } catch {
        // Already gone.
      }
    }
  };
}

/** @typedef {ReturnType<typeof waitingSignUp>} WaitingStore */
