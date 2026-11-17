// Collects Northumbria Sport's clubs from northumbriasport.com, one request every 2 to 3 seconds:
// - /sports once, for the list of clubs (slug, name, link). It has no pictures, so
// - each club's page, for its picture (the first banner picture) and, on a laptop run (--pages),
//   everything else the page shows: about, memberships and training, socials, contacts and the
//   booking link. 39 requests in all for 38 clubs, about 2 minutes.
// It writes:
// - src/lib/sport/sport-clubs.json, the public list the app reads (only if the list changed)
// - with --pages, the private pages file for Firestore, to a path you give OUTSIDE the repo (a path
//   inside it is refused). It holds personal data, so it never goes in the repo. Import it into
//   Firestore by hand with import-sport-club-pages.mjs and a short-lived key.
// Without --pages, each club page is read only for its picture: nothing else from it is kept,
// printed or written. Nothing is written unless every check passes (see checkBeforeWriting in
// lib/sport-collect.mjs), and it stops at once, writing nothing, if the site refuses or challenges
// it. It never tries to get round that. It prints counts and which clubs (by slug) changed, never
// names, emails or page text.
//
// Northumbria Sport's robots.txt lets crawlers read the site (it only asks them to keep off PDFs),
// so the GitHub workflow runs the list part every Monday. See "Refreshing the Northumbria Sport
// data" in the README.
//
// Run from the project folder:
//   node scripts/collect-sport-clubs.mjs --pages ~/Downloads/sport-refresh/sport-club-pages.json \
//     --compare ~/Downloads/sport-club-pages.json
// Options:
//   --pages <file>    also build the private pages file there (outside the repo)
//   --no-pages        only the list (the workflow)
//   --compare <file>  with --pages: the pages file imported last time. Prints how many clubs' details
//                     are the same, and for the rest which parts differ (by slug, never the values)
//   --summary <file>  also write the change summary there, as Markdown for a pull request
//   --verbose         list every review note, not just how many of each

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSportClubPages } from './lib/sport-club-pages.mjs';
import {
  blockedReason, buildFiles, checkBeforeWriting, expandHome, isInside, LIST_URL, listChanges, maskEmails, MIN_CLUBS,
  pagesChanges, parseClubList, parseClubPage, pictureOnly, sameList, summaryText, USER_AGENT
} from './lib/sport-collect.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST_FILE = resolve(REPO, 'src/lib/sport/sport-clubs.json');

const args = process.argv.slice(2);
/** @param {string} name */
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null);
const pagesPath = option('--pages');
const noPages = args.includes('--no-pages');
const comparePath = option('--compare');
const summaryPath = option('--summary');
const verbose = args.includes('--verbose');

/** Prints a line, masking anything shaped like an email address as a last guard. */
const say = (text = '') => console.log(maskEmails(text));

/**
 * Stops the run without writing anything.
 * @param {string} reason
 * @returns {never}
 */
function stop(reason) {
  say(`\nStopped, and nothing was written: ${reason}`);
  process.exit(1);
}

if (Boolean(pagesPath) === noPages) {
  say('Give either --pages <file> (a path outside the repo) or --no-pages.');
  process.exit(2);
}
if (comparePath && !pagesPath) {
  say('--compare needs --pages: it compares the pages file this run builds with the one you give.');
  process.exit(2);
}
const pagesTarget = pagesPath ? expandHome(pagesPath) : null;
if (pagesTarget && isInside(pagesTarget, REPO)) {
  stop(`${pagesPath} is inside the repo. The pages file holds personal data, so it has to go outside it.`);
}
const compareSource = comparePath ? expandHome(comparePath) : null;
if (compareSource && !existsSync(compareSource)) stop(`there's no file at ${comparePath} to compare with`);
const summaryTarget = summaryPath ? expandHome(summaryPath) : null;

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
/** 2 to 3 seconds between requests. */
const pause = () => sleep(2000 + Math.floor(Math.random() * 1000));

let requests = 0;
/**
 * Fetches a page as text. Stops the whole run if the site refuses or challenges the request, and
 * for any other failure once it has tried twice more, 10 seconds apart, after a server error or no
 * answer within 30 seconds.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    requests++;
    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      const why = /** @type {{ cause?: { code?: string }, name: string, message: string }} */ (err);
      if (attempt === 3) stop(`${new URL(url).host} didn't answer (${why.cause?.code ?? (why.name === 'TimeoutError' ? 'no answer in 30 seconds' : why.message)})`);
      await sleep(10_000);
      continue;
    }
    const body = await response.text();
    const blocked = blockedReason(response.status, response.headers, body);
    if (blocked) stop(`${new URL(url).host} ${blocked} for ${new URL(url).pathname}. The script doesn't try to get round that.`);
    if (response.ok) return body;
    if (response.status < 500 || attempt === 3) stop(`${new URL(url).host} answered ${response.status} for ${new URL(url).pathname}`);
    await sleep(10_000);
  }
}

say(`Collecting Northumbria Sport's clubs as "${USER_AGENT}", 2 to 3 seconds apart.`);
const listed = parseClubList(await get(LIST_URL));
// Too few clubs means the page has probably changed: stop before reading every club's page.
if (listed.length < MIN_CLUBS) stop(`only ${listed.length} clubs on /sports (at least ${MIN_CLUBS} expected), so the page may have changed`);
say(`Northumbria Sport's list: ${listed.length} clubs.`);

/** @type {Map<string, import('./lib/sport-collect.mjs').ClubPage>} */
const pages = new Map();
for (const [i, club] of listed.entries()) {
  await pause();
  const page = parseClubPage(await get(club.url), club.url);
  // A list-only run keeps just the picture: the rest of the page (contacts included) goes at once.
  pages.set(club.slug, noPages ? pictureOnly(page) : page);
  if ((i + 1) % 10 === 0 || i + 1 === listed.length) say(`  ${i + 1}/${listed.length} club pages read`);
}

const collectedAt = new Date().toISOString();
/** @type {import('./lib/sport-collect.mjs').ListFile | null} */
const lastList = existsSync(LIST_FILE) ? JSON.parse(readFileSync(LIST_FILE, 'utf8')) : null;
const { list, pagesFile, review } = buildFiles(listed, pages, collectedAt, !noPages);
const unparsed = listed.filter((club) => !pages.get(club.slug)?.parsed).map((club) => club.slug);
const checked = pagesFile ? checkSportClubPages(pagesFile, new Set(list.clubs.map((club) => club.slug))) : null;
const problems = checkBeforeWriting({ clubs: listed.length, unparsed, pageErrors: checked?.errors ?? [] });
if (problems.length) stop(problems.join('; '));

const summary = summaryText(listChanges(lastList, list), { clubs: listed.length, requests, pages: checked ? checked.counts : null });
say(`\n${summary}`);

if (compareSource && pagesFile) {
  const { same, changed, added, removed } = pagesChanges(JSON.parse(readFileSync(compareSource, 'utf8')), pagesFile);
  say(`\nCompared with ${comparePath}: ${same} clubs' details the same, ${changed.length} different.`);
  for (const { slug, parts } of changed) say(`  ${slug}: ${parts.join(', ')}`);
  if (added.length) say(`  Not in that file: ${added.join(', ')}`);
  if (removed.length) say(`  Only in that file: ${removed.join(', ')}`);
}

// Review notes for a person, by kind ("3 no picture on the club page"); every one with --verbose.
/** @type {Map<string, number>} */
const kinds = new Map();
for (const note of review) {
  const kind = note.split(': ').slice(1).join(': ');
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
}
if (review.length) {
  say('\nTo check by hand:');
  for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) say(`  ${String(count).padStart(3)}  ${kind}`);
  if (verbose) for (const note of review) say(`       ${note}`);
}
if (checked?.review.length) say(`  ${String(checked.review.length).padStart(3)}  contact notes too long to import (the import leaves them out and keeps their people)`);

if (pagesTarget && pagesFile) {
  mkdirSync(dirname(pagesTarget), { recursive: true });
  // Only you can read it: it holds personal data.
  writeFileSync(pagesTarget, `${JSON.stringify(pagesFile, null, 2)}\n`, { mode: 0o600 });
  say(`\nWrote the pages file (${checked?.counts.clubs} clubs) to ${pagesPath}. Import it with import-sport-club-pages.mjs, then delete the key.`);
}
if (sameList(lastList, list)) {
  say('sport-clubs.json: unchanged, so left as it is.');
} else {
  writeFileSync(LIST_FILE, `${JSON.stringify(list, null, 2)}\n`);
  say('sport-clubs.json: updated. Check the change with git diff before committing it.');
}
if (summaryTarget) writeFileSync(summaryTarget, `${summary}\n`);
