// Checks that the check-your-inbox screen (VerifyEmail.svelte) says a link was sent only when one
// was. On 18 November Thomas logged in with an account made before verification existed, was told
// "We've sent a link to …", and searched his inbox and Spam for an email that had never been sent:
// only signing up sends one (agent1.md A9).
// 1. Offline: the screen's two states, and verify.js noting a send in the tab.
// 2. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators), with an unverified
//    account made without the app's sign-up (as that old one was), logging in fresh:
//    - the screen says plainly that the address isn't verified yet, with Send the link, and never that
//      a link was sent; nothing is sent (the Auth emulator lists every email it would have sent);
//    - "I've clicked it" says it isn't verified yet, and to send the link;
//    - Send the link sends exactly one; the screen then says it was sent, with Resend waiting its 60
//      seconds, and the focus stays on the first button, which is now "I've clicked it";
//    - a reload in the same tab still says it was sent, and the wait carries on where it was;
//    - a new visit (a fresh Chrome) offers the link again, since the app can't know about the last one;
//      clicking the link (the emulator's owner marks the address verified), then "I've clicked it",
//      opens the app;
//    - signing up through the app says the link was sent straight away (one email).
// Made-up people only; nothing real is touched (project demo-ag2) and no email is sent. Run from the
// project folder (the emulators need Java 21 or newer, and Google Chrome or CHROME=<path to Chrome>):
//   node scripts/check-verify-email.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-verify-email.mjs"

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SENT_EVENT, sentThisVisit } from '#lib/firebase/verify.js';
import { emulators, openChrome, startApp } from './lib/emulator-app.mjs';

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const report = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** The two states' words, as the screen shows them. */
const NOT_SENT = 'Verify your email address';
const SENT = 'We’ve sent a link to';

// ---------- 1. Offline ----------
/** @type {[string, () => void][]} */
const offline = [
  ['The screen has both states: "We’ve sent a link" only once this tab has sent one; otherwise, plainly, that the address isn’t verified yet, with Send the link', () => {
    const screen = readFileSync('src/lib/components/VerifyEmail.svelte', 'utf8');
    const markup = screen.slice(screen.indexOf('<main'));
    assert.match(screen, /let sentAt = \$state\(sentThisVisit\(getFirebaseAuth\(\)\.currentUser\?\.uid\)\);/);
    assert.match(markup, /\{#if sent\}\s*<h1>\{words\.inboxHeading\}<\/h1>\s*<p>\s*We’ve sent a link to/);
    assert.match(markup, /\{:else\}\s*<h1>Verify your email address<\/h1>\s*<p>\s*Your address, <strong>\{email\}<\/strong>, isn’t verified yet\./);
    for (const words of ['Send the link', 'I’ve clicked it', 'Resend the email', '{words.wrongAddress}', 'href="/need-help"']) assert.ok(markup.includes(words), words);
    assert.match(screen, /window\.addEventListener\(SENT_EVENT, heard\)/, 'it hears a link sent while it shows (sign-up)');
    assert.match(screen, /const RESEND_WAIT = 60;/);
  }],
  ['verify.js notes each link it sends, in this tab only (sessionStorage), and tells the page; with no storage, nothing was sent', () => {
    const verify = readFileSync('src/lib/firebase/verify.js', 'utf8');
    assert.match(verify, /await sendEmailVerification\(user\);\s*const sent = \{ uid: user\.uid, at: Date\.now\(\) \};\s*try \{\s*sessionStorage\.setItem/, 'only after Firebase has sent it');
    assert.equal(SENT_EVENT, 'ag2:verification-sent');
    assert.equal(sentThisVisit('anyone'), null);
    assert.equal(sentThisVisit(undefined), null);
    for (const file of ['src/lib/students/signup.js', 'src/lib/matching/mentors.js']) assert.match(readFileSync(file, 'utf8'), /await sendVerification\(user\)/, `${file}: sign-up sends it through verify.js`);
  }]
];
for (const [name, check] of offline) {
  try {
    check();
    report(name, true);
  } catch (err) {
    report(name, false, /** @type {Error} */ (err).message.split('\n')[0]);
  }
}

// ---------- 2. In the emulators ----------
const where = emulators();
if (!where) {
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-verify-email.mjs")');
  process.exit(results.every(Boolean) ? 0 : 1);
}

const password = randomBytes(18).toString('base64url');
const AUTH = `http://${where.auth}/identitytoolkit.googleapis.com/v1`;

/** An account made without the app's sign-up, never verified and never sent a link (as one from before verification). @param {string} email */
async function oldAccount(email) {
  const response = await fetch(`${AUTH}/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  assert.ok(response.ok, `making ${email}`);
}

/** How many verification emails the Auth emulator has sent this address (it lists every one). @param {string} email */
async function linksSent(email) {
  const response = await fetch(`http://${where.auth}/emulator/v1/projects/${where.project}/oobCodes`);
  const { oobCodes } = /** @type {{ oobCodes?: { email: string, requestType: string }[] }} */ (await response.json());
  return (oobCodes ?? []).filter((code) => code.email === email && code.requestType === 'VERIFY_EMAIL').length;
}

/** Marks an address verified, as clicking the link in the email would. @param {string} email */
async function markVerified(email) {
  const found = await fetch(`${AUTH}/projects/${where.project}/accounts:lookup`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ email: [email] }) });
  const localId = (/** @type {{ users?: { localId: string }[] }} */ (await found.json())).users?.[0]?.localId;
  assert.ok(localId, `no account for ${email}`);
  const response = await fetch(`${AUTH}/projects/${where.project}/accounts:update`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId, emailVerified: true }) });
  assert.ok(response.ok, `verifying ${email}`);
}

const app = await startApp();
try {
  /** @typedef {Awaited<ReturnType<typeof openChrome>>} Page */
  /** A part of the check in its own Chrome: a new visit, with a fresh profile. @param {(page: Page) => Promise<void>} part */
  const inFreshChrome = async (part) => {
    const page = await openChrome(app.base);
    try {
      await part(page);
    } finally {
      await page.close();
    }
  };
  /** The two buttons' words, in order. @param {Page} page @returns {Promise<string[]>} */
  const buttons = (page) => page.evaluate(`[...document.querySelectorAll('.actions button')].map((b) => b.textContent.trim() + (b.disabled ? ' (off)' : ''))`);

  const old = `old.account.${randomBytes(3).toString('hex')}@northumbria.ac.uk`;
  await oldAccount(old);

  // An old unverified account logs in: no link has been sent, and the screen says so plainly.
  await inFreshChrome(async (page) => {
    await page.logIn(old, password);
    const plain = await page.waitFor(`${page.has(NOT_SENT)} && ${page.has(old)} && ${page.has('isn’t verified yet')} && !${page.has(SENT)}`);
    report(`An unverified account logging in fresh: "${NOT_SENT}", its address isn’t verified yet, and never that a link was sent`, plain, JSON.stringify(await buttons(page)));
    report('...Send the link comes first, with I’ve clicked it for a link they already have; nothing has been sent', JSON.stringify(await buttons(page)) === JSON.stringify(['Send the link', 'I’ve clicked it']) && (await linksSent(old)) === 0, `${await linksSent(old)} sent`);
    await page.press('I’ve clicked it');
    report('"I’ve clicked it" says it isn’t verified yet, and to send the link', await page.waitFor(page.has('It isn’t verified yet. Tap “Send the link” to get one.')));

    // A keyboard user: the focus is on Send the link when it's pressed.
    await page.evaluate(`(document.querySelector('.actions .primary-button').focus(), true)`);
    await page.press('Send the link');
    const sentShown = await page.waitFor(`${page.has(SENT)} && ${page.has(old)} && ${page.has('Sent. It can take a few minutes')}`);
    report('Send the link sends exactly one, and the screen now says it was sent', sentShown && (await linksSent(old)) === 1, `${await linksSent(old)} sent`);
    const now = await buttons(page);
    report('...with "I’ve clicked it" first, where the focus still is, and Resend waiting its 60 seconds', now[0] === 'I’ve clicked it' && /^Resend \((5\d|60)s\) \(off\)$/.test(now[1]) && (await page.evaluate(`document.activeElement === document.querySelector('.actions .primary-button')`)), JSON.stringify(now));

    // A reload in the same tab: it still knows, and the wait carries on.
    await page.go('/home');
    await page.waitFor(page.has(SENT));
    const after = await buttons(page);
    report('A reload in the same tab still says the link was sent, and Resend’s wait carries on', (await page.evaluate(page.has(old))) && /^Resend \(\d+s\) \(off\)$/.test(after[1]) && Number(after[1].match(/\d+/)?.[0]) < 60, JSON.stringify(after));
  });

  // A new visit: the app can't know about the link it sent before, so it offers one again.
  await inFreshChrome(async (page) => {
    await page.logIn(old, password);
    report('A new visit offers the link again rather than claiming one was sent', await page.waitFor(`${page.has(NOT_SENT)} && !${page.has(SENT)}`) && (await linksSent(old)) === 1);
    await markVerified(old);
    await page.press('I’ve clicked it');
    report('Clicking the link they already had, then "I’ve clicked it", opens the app', await page.waitFor(`location.pathname === '/home' && !${page.has(NOT_SENT)} && document.querySelector('nav.bottom-nav') !== null`, 30000));
  });

  // Signing up through the app sends the link, and the screen says so straight away.
  const newbie = `new.student.${randomBytes(3).toString('hex')}@northumbria.ac.uk`;
  await inFreshChrome(async (page) => {
    await page.go('/signup');
    await page.waitFor(page.has('Create your account'));
    await page.fill('#email', newbie);
    await page.fill('#password', password);
    await page.fill('#confirm', password);
    await page.press('Continue');
    await page.waitFor(page.has('Step 2 of 2'));
    await page.fill('#name', 'New Student');
    await page.evaluate(`(document.querySelector('input[name=studentType][value=home]').click(), true)`);
    await page.fill('#course', 'BSc Testing');
    await page.press('Finish');
    const shown = await page.waitFor(`${page.has('Check your uni inbox')} && ${page.has(SENT)} && ${page.has(newbie)}`, 30000);
    report('Signing up through the app: "We’ve sent a link" straight away, and one email was sent', shown && (await linksSent(newbie)) === 1, `${await linksSent(newbie)} sent`);
  });
} finally {
  app.stop();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
