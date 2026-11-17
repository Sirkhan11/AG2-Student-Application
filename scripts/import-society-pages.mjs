// Copies each society's NSU page (from a society pages JSON file) into Firestore at
// societies/{nsuId}, for the /societies/[nsuId] page. The file holds personal data (contact emails,
// and some descriptions name committee members), so keep it OUT of the repo, and this script only
// ever prints counts and where problems are, never values. otherEmails is never copied.
//
// It uses the Admin SDK, which ignores the Firestore rules (the rules block all writes from the app).
// Credentials come from a service account key file, kept outside the repo, named by
// GOOGLE_APPLICATION_CREDENTIALS. Delete the key once the import is done.
//
// Run from the project folder. A dry run (the default) only checks the file and prints counts:
//   node --env-file=.env scripts/import-society-pages.mjs ~/Downloads/nsu-society-pages.json
// Then, to write:
//   GOOGLE_APPLICATION_CREDENTIALS=~/keys/ag2-import.json \
//     node --env-file=.env scripts/import-society-pages.mjs ~/Downloads/nsu-society-pages.json --write
// Running it again overwrites each society's document, so it's safe to repeat after a refresh.

import { readFileSync } from 'node:fs';
import { checkSocietyPages } from './lib/society-pages.mjs';

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--'));
const write = args.includes('--write');
if (!path) {
  console.log('Give the society pages JSON file: node --env-file=.env scripts/import-society-pages.mjs <file> [--write]');
  process.exit(2);
}

const list = JSON.parse(readFileSync('src/lib/societies/nsu-societies.json', 'utf8'));
const knownIds = new Set(list.societies.map((/** @type {{ nsuId: number }} */ society) => society.nsuId));
const { errors, docs, counts } = checkSocietyPages(JSON.parse(readFileSync(path, 'utf8')), knownIds);

console.log(`Checked: ${counts.societies} societies ready (${knownIds.size} in nsu-societies.json)`);
console.log(`  with a description: ${counts.withDescription}, with a contact email: ${counts.withEmail}`);
console.log(`  social links: ${counts.socials}, memberships: ${counts.memberships}, with committee entries: ${counts.withCommittee}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s), so nothing will be written:`);
  for (const error of errors.slice(0, 40)) console.log(`  ${error}`);
  if (errors.length > 40) console.log(`  ...and ${errors.length - 40} more`);
  process.exit(1);
}

const expectedProject = process.env.VITE_FIREBASE_PROJECT_ID;
if (!write) {
  console.log(`\nDry run: nothing written. Add --write to write ${docs.size} documents to societies/ in ${expectedProject ?? '(project from your key)'}.`);
  process.exit(0);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.log('\nSet GOOGLE_APPLICATION_CREDENTIALS to your service account key file (kept outside the repo).');
  process.exit(2);
}
const keyProject = JSON.parse(readFileSync(keyPath, 'utf8')).project_id;
if (expectedProject && keyProject !== expectedProject) {
  console.log(`\nThe key is for project ${keyProject}, but .env says ${expectedProject}. Nothing written.`);
  process.exit(1);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: keyProject });
const db = getFirestore();

console.log(`\nWriting ${docs.size} documents to societies/ in ${keyProject}...`);
const entries = [...docs.entries()];
for (let start = 0; start < entries.length; start += 400) {
  const batch = db.batch();
  for (const [nsuId, doc] of entries.slice(start, start + 400)) batch.set(db.collection('societies').doc(String(nsuId)), doc);
  await batch.commit();
}
console.log(`Done: ${docs.size} written. Remember to delete the service account key now (see the commit notes).`);
