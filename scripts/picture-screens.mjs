// Phone-size pictures of the app's main screens, for a report: Home (a student with no mentor), the
// checklist, the GP finder, Need help now, Societies, More, and the chat's start. Made-up people in the
// Auth and Firestore emulators, with the app in its emulators mode (vite dev --mode emulators); nothing
// real is touched (project demo-ag2). Each picture is 390 by 844 CSS pixels at 2x, like a phone.
// Run from the project folder (the emulators need Java 21 or newer, and Google Chrome or CHROME=<path>):
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/picture-screens.mjs <folder> [prefix]"
// The pictures go in <folder> as <prefix>home.png, <prefix>checklist.png and so on.

import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';

const [folder, prefix = ''] = process.argv.slice(2);
const where = emulators();
if (!where || !folder) {
  console.log('Run it inside the emulators, with the folder for the pictures: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/picture-screens.mjs <folder> [prefix]"');
  process.exit(2);
}
mkdirSync(folder, { recursive: true });

const db = owner(where);
const password = randomBytes(18).toString('base64url');
const email = 'pic.student@northumbria.ac.uk';
const uid = await db.verifiedAccount(email, password);
// Two tasks done, so the checklist and Home show progress; interests, so Home can suggest societies.
await db.seed(`students/${uid}`, {
  name: 'Sam Student', course: 'BSc Computer Science', email, arrivalDate: '', role: 'student', studentType: 'home', wantsMentor: false,
  interests: ['Climbing', 'Gaming'],
  checklist: [
    { id: 'enrol', title: 'Enrol', done: true },
    { id: 'gp', title: 'Register with a GP', done: false },
    { id: 'student-id', title: 'Collect student ID', done: true },
    { id: 'society', title: 'Join a society', done: false },
    { id: 'dentist', title: 'Find a dentist', done: false },
    { id: 'contacts', title: 'Save key contacts', done: false }
  ],
  checklistOffered: ['enrol']
});

const app = await startApp();
const page = await openChrome(app.base);
try {
  await page.logIn(email, password);
  for (const [path, name, ready] of [
    ['/home', 'home', 'Hi Sam'],
    ['/checklist', 'checklist', 'Register with a GP'],
    ['/gp-finder', 'gp-finder', 'Use my location'],
    ['/need-help', 'need-help', 'Need help now'],
    ['/societies', 'societies', 'Societies'],
    ['/more', 'more', 'More']
  ]) {
    await page.go(path);
    await page.waitFor(page.has(ready));
    await sleep(1200);
    const file = join(folder, `${prefix}${name}.png`);
    await page.picture(file);
    console.log(`wrote ${file}`);
  }
} finally {
  await page.close();
  app.stop();
}
process.exit(0);
