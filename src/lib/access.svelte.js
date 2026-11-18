import { readUniOnly } from '#lib/access.js';
import { db } from '#lib/firebase/client.js';

// The access switch's position for this page load (see access.js), for the root layout's gate and the
// forms' wording. The layout reads it once as it loads; the forms wait for that read before deciding
// about an address (loadAccess gives everyone the same promise). Until it's read, uniOnly is null: the
// wording is Northumbria's, and the gate shows nothing yet, rather than the Northumbria-only screen for
// a moment, to an account from elsewhere.

/** @type {{ uniOnly: boolean | null }} true: Northumbria only; false: any address; null: not read yet */
export const access = $state({ uniOnly: null });

/** @type {Promise<boolean> | undefined} */
let reading;

/** Reads the switch, once a page load, and gives its position (true: Northumbria only). */
export function loadAccess() {
  reading ??= readUniOnly(db).then((uniOnly) => (access.uniOnly = uniOnly));
  return reading;
}
