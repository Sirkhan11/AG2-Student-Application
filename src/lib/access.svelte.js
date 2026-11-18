import { readUniOnly } from '#lib/access.js';
import { firestoreRest } from '#lib/firebase/client.js';

// The access switch's position for this page load (see access.js), for the root layout's gate and the
// forms' wording. It's read only where it's needed, at most once a page load (loadAccess gives everyone
// the same promise): the forms read it as they open, and again before deciding about an address; the
// layout reads it when a signed-in account isn't a Northumbria one. A Northumbria student browsing the
// app never reads it. Until it's read, uniOnly is null: the wording is Northumbria's, and the gate shows
// nothing yet, rather than the Northumbria-only screen for a moment, to an account from elsewhere.

/** @type {{ uniOnly: boolean | null }} true: Northumbria only; false: any address; null: not read yet */
export const access = $state({ uniOnly: null });

/** @type {Promise<boolean> | undefined} */
let reading;

/** Reads the switch, once a page load, and gives its position (true: Northumbria only). */
export function loadAccess() {
  reading ??= readUniOnly(firestoreRest).then((uniOnly) => (access.uniOnly = uniOnly));
  return reading;
}
