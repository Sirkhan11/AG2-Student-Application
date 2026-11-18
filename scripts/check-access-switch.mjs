// Checks the access switch (config/access, uniOnly: src/lib/access.js) in a real browser, with the app
// in its emulators mode against the Auth and Firestore emulators (nothing real is touched, project
// demo-ag2, and no email is sent: the Auth emulator keeps the verification links). The rules themselves
// are checked, in both positions, by scripts/check-uni-rules.mjs; this is what people see:
// - the switch on (no document, as a fresh project): the forms ask for a Northumbria email address,
//   with the placeholder and no testing line, and an address from elsewhere is refused on the log-in
//   page before anything is sent;
// - the switch off (uniOnly false): every form says "Email address", the sign-up page says "Testing:
//   open to any email address"; signing up with an example.com address makes the account and shows
//   "Check your inbox" (Junk, no "uni", never the Northumbria-only screen), nothing is saved until the
//   address is verified, then "I've clicked it" saves the record and opens Home; opened afresh after
//   clicking the link, the app saves it on its own (with a fresh token first); a verified account from
//   elsewhere logs in and uses the app;
// - flipped back on (uniOnly true, then the document deleted) while that account is signed in: the
//   Northumbria-only screen, with their address; Need help now still opens; their record is still
//   there; Log out works and the log-in page is back to Northumbria wording;
// - a Northumbria account logs in as ever; off again, the account from elsewhere is back in, with the
//   same record (Home greets them by name).
// Each part runs in a fresh Chrome (new profile): the Firestore emulator is HTTP/1.1, and after many
// page loads in one profile new Firestore streams stall on Chrome's six connections a host.
// Run from the project folder (the emulators need Java 21 or newer):
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-access-switch.mjs"
// Uses Google Chrome from its usual place on a Mac, or CHROME=<path to Chrome>.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { wordingFor } from '#lib/access.js';
import { UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';
import { CHECKLIST_DONE, emulators, openChrome, owner, startApp } from './lib/emulator-app.mjs';

const where = emulators();
if (!where) {
  console.log('Run it inside the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-access-switch.mjs"');
  process.exit(2);
}

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const report = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const SWITCH = 'config/access';
const ON = wordingFor(true);
const OFF = wordingFor(false);
const NORTHUMBRIA_ONLY = 'AG2 is for Northumbria students';
const db = owner(where);

/** Deletes a document as the emulator's owner (as the coordinator would in the console). @param {string} path */
async function ownerDelete(path) {
  const response = await fetch(`http://${where.firestore}/v1/projects/${where.project}/databases/(default)/documents/${path}`, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
  assert.ok(response.ok, `deleting ${path}: ${response.status}`);
}

/** The uid of the account with this address, from the Auth emulator. @param {string} email */
async function uidOf(email) {
  const response = await fetch(`http://${where.auth}/identitytoolkit.googleapis.com/v1/projects/${where.project}/accounts:lookup`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ email: [email] })
  });
  const { users } = /** @type {{ users?: { localId: string }[] }} */ (await response.json());
  return users?.[0]?.localId ?? null;
}

/** Marks an address verified, as clicking the link in the email would. @param {string} email */
async function markVerified(email) {
  const localId = await uidOf(email);
  assert.ok(localId, `no account for ${email}`);
  const response = await fetch(`http://${where.auth}/identitytoolkit.googleapis.com/v1/projects/${where.project}/accounts:update`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true })
  });
  assert.ok(response.ok, `verifying ${email}`);
}

/** The name saved in a student's record, or null. @param {string | null} uid */
const savedName = async (uid) => (uid ? ((await db.read(`students/${uid}`))?.fields?.name?.stringValue ?? null) : null);

// Two verified accounts, made as the emulator's owner: a tester from elsewhere, and a Northumbria student.
const password = randomBytes(18).toString('base64url');
const tess = 'tess.tester@example.com';
const tessUid = await db.verifiedAccount(tess, password);
await db.seed(`students/${tessUid}`, { name: 'Tess Tester', course: 'BSc Testing', email: tess, arrivalDate: '', role: 'student', ...CHECKLIST_DONE });
const sam = 'sam.student@northumbria.ac.uk';
const samUid = await db.verifiedAccount(sam, password);
await db.seed(`students/${samUid}`, { name: 'Sam Student', course: 'BSc Law', email: sam, arrivalDate: '', role: 'student', ...CHECKLIST_DONE });

const app = await startApp();
try {
  /** @typedef {Awaited<ReturnType<typeof openChrome>>} Page */
  /** A part of the check in its own Chrome, with a fresh profile. @param {(page: Page) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    /** What the app wrote to the console as errors, to explain a failure. @type {string[]} */
    const errors = [];
    page.listen((message) => {
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(message.params.args.map((/** @type {any} */ arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 160));
      }
    });
    try {
      await part(page);
    } finally {
      if (errors.length) console.log(`  (console errors in the app: ${errors.join(' | ')})`);
      await page.close();
    }
  };
  /** The email box's label on the page showing. @param {Page} page */
  const emailLabel = (page) => page.evaluate(`document.querySelector('label[for=email]')?.textContent.trim() ?? ''`);
  /** Where the page is and what it shows, for a failure's detail. @param {Page} page */
  const showing = async (page) => `at ${await page.evaluate('location.pathname')}: ${JSON.stringify(String(await page.evaluate('document.body.innerText')).slice(0, 120))}`;
  /** Fills in the log-in form and submits it. @param {Page} page @param {string} email */
  const tryLogIn = async (page, email) => {
    await page.go('/');
    await page.waitFor(page.has('Welcome back'));
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.evaluate(`(document.querySelector('form button[type=submit]').click(), true)`);
  };
  /** Signs up as a student through the two steps; true once the check-your-inbox screen shows. @param {Page} page @param {string} name @param {string} email */
  const signUp = async (page, name, email) => {
    await page.go('/signup');
    await page.waitFor(page.has('Create your account'));
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.fill('#confirm', password);
    await page.press('Continue');
    await page.waitFor(page.has('Step 2 of 2'));
    await page.fill('#name', name);
    await page.evaluate(`(document.querySelector('input[name=studentType][value=home]').click(), true)`);
    await page.fill('#course', 'BSc Testing');
    await page.press('Finish');
    return page.waitFor(`${page.has(OFF.inboxHeading)} && ${page.has(email)} && ${page.has('Junk')}`);
  };

  // 1. The switch on (no document yet): today's wording, and an address from elsewhere is refused.
  await inFreshChrome(async (page) => {
    await page.go('/');
    await page.waitFor(page.has('Welcome back'));
    report(`The switch on (no config/access): the log-in page asks for a "${ON.emailLabel}"`, (await emailLabel(page)) === ON.emailLabel, await emailLabel(page));
    await page.go('/signup');
    await page.waitFor(page.has('Create your account'));
    const placeholder = await page.evaluate(`document.querySelector('#email')?.placeholder ?? ''`);
    report('...the sign-up page too, with the placeholder and no testing line', (await emailLabel(page)) === ON.emailLabel && placeholder === ON.emailPlaceholder && !(await page.evaluate(page.has(OFF.testingNote))), `${await emailLabel(page)}; "${placeholder}"`);
    await tryLogIn(page, tess);
    report('...and a verified example.com account is refused on the log-in page before anything is sent', await page.waitFor(page.has(UNI_EMAIL_MESSAGE)));
  });

  // 2. The switch off: plain wording on every form.
  await db.seed(SWITCH, { uniOnly: false });
  await inFreshChrome(async (page) => {
    for (const [path, heading, form] of [['/', 'Welcome back', 'Log in'], ['/signup', 'Create your account', 'Sign up'], ['/mentor-signup', 'Become a mentor', 'Mentor sign-up'], ['/forgot-password', 'Reset your password', 'Forgot password']]) {
      await page.go(path);
      await page.waitFor(page.has(heading));
      const label = await page.waitFor(`document.querySelector('label[for=email]')?.textContent.trim() === ${JSON.stringify(OFF.emailLabel)}`);
      report(`The switch off: ${form} says "${OFF.emailLabel}", and nothing on the page says Northumbria email`, label && !(await page.evaluate(page.has('Northumbria email'))), await emailLabel(page));
    }
    await page.go('/signup');
    await page.waitFor(page.has('Create your account'));
    report('...the sign-up page has no placeholder and says "Testing: open to any email address"', (await page.evaluate(`document.querySelector('#email')?.placeholder ?? ''`)) === '' && (await page.waitFor(page.has(OFF.testingNote))));
  });

  // 3. Signing up from elsewhere, as a tester would, then "I've clicked it" in the same tab.
  const newbie = `new.tester.${Date.now()}@example.com`;
  await inFreshChrome(async (page) => {
    const inbox = await signUp(page, 'New Tester', newbie);
    report(`Signing up with an example.com address: the account is made and "${OFF.inboxHeading}" shows, with the address and Junk, no "uni", and never the Northumbria-only screen`,
      inbox && !(await page.evaluate(page.has(ON.inboxHeading))) && !(await page.evaluate(page.has(NORTHUMBRIA_ONLY))));
    report('...and its "Wrong address?" line doesn’t say Northumbria', await page.evaluate(page.has(OFF.wrongAddress)));
    const newbieUid = await uidOf(newbie);
    report('...nothing is saved until the address is verified', newbieUid !== null && (await savedName(newbieUid)) === null, `uid ${newbieUid ? 'made' : 'missing'}`);
    await page.go('/checklist');
    report('...and every page shows that screen meanwhile', await page.waitFor(`location.pathname === '/checklist' && ${page.has(OFF.inboxHeading)}`));

    // They click the link in the email (the emulator's owner marks the address verified) and come back
    // to the tab, which hasn't reloaded, and tap "I've clicked it".
    await page.go('/signup');
    await page.waitFor(page.has(OFF.inboxHeading));
    await markVerified(newbie);
    const pressed = await page.press('I’ve clicked it');
    const home = await page.waitFor(`location.pathname === '/home'`, 45000);
    report('Clicking the link, then "I’ve clicked it" in the same tab: the record (name, course, address) is saved and Home opens', pressed && home && (await savedName(newbieUid)) === 'New Tester', `${home ? 'Home' : await showing(page)}; saved ${JSON.stringify(await savedName(newbieUid))}`);
    report('...and Home greets them by name', await page.waitFor(page.has('Hi New')));
  });

  // 4. Another tester clicks the link, then opens the app afresh (the link opened in their mail app, say):
  //    the app notices on its own, saves the record and opens Home. Firebase knows the account is
  //    verified before the saved token does, so the save needs a fresh token first (verify.js).
  const later = `later.tester.${Date.now()}@example.com`;
  await inFreshChrome(async (page) => {
    report('A second tester signs up from elsewhere, to the same screen', await signUp(page, 'Later Tester', later));
    await markVerified(later);
    await page.go('/signup');
    const afresh = await page.waitFor(`location.pathname === '/home'`, 45000);
    const laterUid = await uidOf(later);
    report('Clicking the link, then opening the app afresh: it saves the record on its own (a fresh token first, so the save isn’t refused) and opens Home', afresh && (await savedName(laterUid)) === 'Later Tester', `${afresh ? 'Home' : await showing(page)}; saved ${JSON.stringify(await savedName(laterUid))}`);
  });

  // 5. A verified tester from elsewhere uses the app; then the switch is flipped back on under them.
  await inFreshChrome(async (page) => {
    report('A verified example.com account logs in and reaches Home', await page.logIn(tess, password));
    await page.go('/checklist');
    report('...and opens the checklist: never sent to log in, never the Northumbria-only screen', await page.waitFor(`location.pathname === '/checklist' && !${page.has(NORTHUMBRIA_ONLY)} && !${page.has('Welcome back')}`));

    await db.seed(SWITCH, { uniOnly: true });
    await page.go('/home');
    report('Flipped back on (uniOnly true): the signed-in example.com account sees the Northumbria-only screen, with its address', await page.waitFor(`${page.has(NORTHUMBRIA_ONLY)} && ${page.has(tess)}`));
    await page.go('/need-help');
    report('...Need help now still opens', await page.waitFor(`${page.has('Need help now?')} && !${page.has(NORTHUMBRIA_ONLY)}`));
    await ownerDelete(SWITCH);
    await page.go('/home');
    report('With the document deleted: still the Northumbria-only screen', await page.waitFor(`${page.has(NORTHUMBRIA_ONLY)} && ${page.has(tess)}`));
    report('...and their records are still there', (await savedName(tessUid)) === 'Tess Tester' && (await savedName(await uidOf(newbie))) === 'New Tester');
    await page.press('Log out');
    report(`Log out from the Northumbria-only screen goes to log in, which asks for a "${ON.emailLabel}" again`, (await page.waitFor(`location.pathname === '/' && ${page.has('Welcome back')}`)) && (await page.waitFor(`document.querySelector('label[for=email]')?.textContent.trim() === ${JSON.stringify(ON.emailLabel)}`)));
    await tryLogIn(page, tess);
    report('...and the example.com account is refused there before anything is sent', await page.waitFor(page.has(UNI_EMAIL_MESSAGE)));
  });

  // 6. A Northumbria account is never affected; off again, the tester is back in with the same record.
  await inFreshChrome(async (page) => {
    report('A Northumbria account logs in as ever', await page.logIn(sam, password));
    await page.logOut();
    await db.seed(SWITCH, { uniOnly: false });
    report('Off again: the example.com account is back in', await page.logIn(tess, password));
    report('...with the same record (Home greets them by name)', await page.waitFor(page.has('Hi Tess')));
  });
} finally {
  app.stop();
  await ownerDelete(SWITCH).catch(() => {});
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
