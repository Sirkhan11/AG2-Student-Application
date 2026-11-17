// Copies each Northumbria Sport club's page (from a sport club pages JSON file) into Firestore at
// sportClubs/{slug}, for the /sport/[slug] page and the chat's club cards. The file holds personal
// data (club contacts' names and emails), so keep it OUT of the repo: a path inside it is refused.
// This script only ever prints counts and where problems are, never names or emails, and nothing
// from the file goes to Gemini.
//
// It uses the Admin SDK, which ignores the Firestore rules (the rules block all writes from the app).
// Credentials come from a service account key file, kept outside the repo, named by
// GOOGLE_APPLICATION_CREDENTIALS. Delete the key once the import is done.
//
// Run from the project folder. A dry run (the default) only checks the file and prints counts:
//   node --env-file=.env scripts/import-sport-club-pages.mjs ~/Downloads/sport-club-pages.json
// Then, to write:
//   GOOGLE_APPLICATION_CREDENTIALS=~/keys/ag2-import.json \
//     node --env-file=.env scripts/import-sport-club-pages.mjs ~/Downloads/sport-club-pages.json --write
// With a key set (dry run or not), it also lists any club in Firestore that isn't in the file. It
// never deletes one: a person decides. Running it again overwrites each club's document, so it's
// safe to repeat after a refresh.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandHome, isInside } from './lib/paths.mjs';
import { checkSportClubPages } from './lib/sport-club-pages.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const given = args.find((arg) => !arg.startsWith('--'));
const write = args.includes('--write');
if (!given) {
  console.log('Give the sport club pages JSON file: node --env-file=.env scripts/import-sport-club-pages.mjs <file> [--write]');
  process.exit(2);
}
const path = expandHome(given);
if (isInside(path, REPO)) {
  console.log(`${given} is inside the repo. It holds personal data, so keep it outside and run this again.`);
  process.exit(2);
}

const list = JSON.parse(readFileSync(resolve(REPO, 'src/lib/sport/sport-clubs.json'), 'utf8'));
const knownSlugs = new Set(list.clubs.map((/** @type {{ slug: string }} */ club) => club.slug));
const { errors, review, docs, counts } = checkSportClubPages(JSON.parse(readFileSync(path, 'utf8')), knownSlugs);

console.log(`Checked: ${counts.clubs} clubs ready (${knownSlugs.size} in sport-clubs.json)`);
console.log(`  with an about: ${counts.withAbout}, with memberships and training: ${counts.withMembership} (${counts.membershipLines} lines, ${counts.sessionItems} session times)`);
console.log(`  contacts: ${counts.contacts} (${counts.people} people), social links: ${counts.socials}, with a booking link: ${counts.withBookUrl}`);
if (review.length) {
  console.log(`\nTo check by hand (${review.length}):`);
  for (const line of review) console.log(`  ${line}`);
}
if (errors.length) {
  console.log(`\n${errors.length} problem(s), so nothing will be written:`);
  for (const error of errors.slice(0, 40)) console.log(`  ${error}`);
  if (errors.length > 40) console.log(`  ...and ${errors.length - 40} more`);
  process.exit(1);
}

const expectedProject = process.env.VITE_FIREBASE_PROJECT_ID;
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  if (write) {
    console.log('\nSet GOOGLE_APPLICATION_CREDENTIALS to your service account key file (kept outside the repo).');
    process.exit(2);
  }
  console.log(`\nDry run: nothing written. Add --write (with a key) to write ${docs.size} documents to sportClubs/ in ${expectedProject ?? '(project from your key)'}.`);
  console.log('(With a key set, a dry run also lists clubs in Firestore that are no longer in the file.)');
  process.exit(0);
}
const keyProject = JSON.parse(readFileSync(expandHome(keyPath), 'utf8')).project_id;
if (expectedProject && keyProject !== expectedProject) {
  console.log(`\nThe key is for project ${keyProject}, but .env says ${expectedProject}. Nothing written.`);
  process.exit(1);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: keyProject });
const db = getFirestore();

// Clubs already in Firestore that aren't in the file: listed for a person to delete, never deleted here.
const existing = (await db.collection('sportClubs').listDocuments()).map((ref) => ref.id);
const gone = existing.filter((slug) => !docs.has(slug)).sort();
console.log(gone.length
  ? `\nIn Firestore but not in the file (not deleted; delete them in the console if they've really gone): ${gone.join(', ')}`
  : '\nEvery club in Firestore is in the file.');

if (!write) {
  console.log(`\nDry run: nothing written. Add --write to write ${docs.size} documents to sportClubs/ in ${keyProject}.`);
  process.exit(0);
}
console.log(`\nWriting ${docs.size} documents to sportClubs/ in ${keyProject}...`);
const batch = db.batch();
for (const [slug, doc] of docs) batch.set(db.collection('sportClubs').doc(slug), doc);
await batch.commit();
console.log(`Done: ${docs.size} written. Remember to delete the service account key now.`);
