// Collects Northumbria Students' Union's societies, asking NSU's site as little as possible:
// - NSU's A to Z page once, for the site id and category map its own script uses
// - the list of societies from the same API NSU's A to Z page uses: one request gives every
//   society's id, name, picture, category and campus. That's all the public list needs.
// - on a laptop run (--pages), each society's page (description, social links, Email Society
//   address, header picture), one every 2 to 3 seconds, and NSU's products list, 100 at a time,
//   for the memberships. About 165 requests in all, against about 310 when every page was read
//   for the list as well.
// It writes:
// - src/lib/societies/nsu-societies.json, the public list the app reads (only if the list changed)
// - with --pages, the private pages file for Firestore, to a path you give OUTSIDE the repo (a path
//   inside it is refused). It holds personal data, so it never goes in the repo. Import it into
//   Firestore by hand with import-society-pages.mjs and a short-lived key.
// Nothing is written unless every check passes (see checkBeforeWriting in lib/nsu-collect.mjs), and
// it stops at once, writing nothing, if NSU's site refuses or challenges it. It never tries to get
// round that. It prints counts and what changed since the last list, never descriptions or emails.
//
// NSU agreed to the app showing their society information, but their robots.txt asks bots not to
// crawl mynsu.co.uk. So a person runs this, about once a term, until NSU agree in writing to
// anything automatic. See "Refreshing the NSU data" in the README.
//
// Run from the project folder (about 8 minutes with --pages):
//   node scripts/collect-nsu-societies.mjs --pages ~/Downloads/nsu-refresh/nsu-society-pages.json
// Options:
//   --pages <file>    also read every society's page and the memberships, and write the private
//                     pages file there (outside the repo)
//   --no-pages        only the list (the workflow): 2 or 3 requests
//   --summary <file>  also write the change summary there, as Markdown for a pull request
//   --verbose         list every review note, not just how many of each

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSocietyPages } from './lib/society-pages.mjs';
import {
  blockedReason, buildFiles, checkBeforeWriting, expandHome, groupsFrom, groupsUrl, isInside, LIST_URL, listChanges,
  maskEmails, membershipsByGroup, ORIGIN, parseSiteSettings, parseSocietyPage, productsUrl, sameList, summaryText, USER_AGENT
} from './lib/nsu-collect.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST_FILE = resolve(REPO, 'src/lib/societies/nsu-societies.json');
/** More pages than this of either API list means something's wrong, so the run stops. */
const MAX_LIST_PAGES = 5;
const MAX_PRODUCT_PAGES = 50;

const args = process.argv.slice(2);
/** @param {string} name */
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? null : null);
const pagesPath = option('--pages');
const noPages = args.includes('--no-pages');
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
const pagesTarget = pagesPath ? expandHome(pagesPath) : null;
if (pagesTarget && isInside(pagesTarget, REPO)) {
  stop(`${pagesPath} is inside the repo. The pages file holds personal data, so it has to go outside it.`);
}
const summaryTarget = summaryPath ? expandHome(summaryPath) : null;

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
/** 2 to 3 seconds between requests, as when the data was collected in Chrome. */
const pause = () => sleep(2000 + Math.floor(Math.random() * 1000));

let requests = 0;
/**
 * Fetches a page or API answer as text. Stops the whole run if the site refuses or challenges the
 * request, and for any other failure once it has tried twice more, 10 seconds apart, after a
 * server error or no answer.
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<string>}
 */
async function get(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    requests++;
    let response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    } catch (err) {
      const why = /** @type {{ cause?: { code?: string }, message: string }} */ (err);
      if (attempt === 3) stop(`${new URL(url).host} didn't answer (${why.cause?.code ?? why.message})`);
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

/**
 * One page of an API list, as JSON.
 * @param {string} url
 * @param {string} siteId
 */
async function getJson(url, siteId) {
  const text = await get(url, { 'X-Site-Id': siteId, Accept: 'application/json' });
  try {
    return JSON.parse(text);
  } catch {
    return stop(`${new URL(url).host} didn't answer with JSON for ${new URL(url).pathname}`);
  }
}

say(`Collecting NSU's societies as "${USER_AGENT}", 2 to 3 seconds apart.`);
const settings = parseSiteSettings(await get(LIST_URL));
if (!settings) stop("couldn't find the site id and category map on NSU's A to Z page, so the page may have changed");

/** @type {import('./lib/nsu-collect.mjs').Group[]} */
const groups = [];
for (let page = 1; ; page++) {
  if (page > MAX_LIST_PAGES) stop(`NSU's society list ran to more than ${MAX_LIST_PAGES} pages`);
  await pause();
  const json = await getJson(groupsUrl(settings.requestIds, page), settings.siteId);
  const { groups: found, unknownCategoryIds } = groupsFrom(json, settings.categories);
  if (unknownCategoryIds.length) stop(`NSU's category map doesn't cover category ${unknownCategoryIds.join(', ')}`);
  for (const group of found) if (!groups.some((known) => known.nsuId === group.nsuId)) groups.push(group);
  if (!json.next_page_url) break;
}
say(`NSU's list: ${groups.length} societies.`);

/** @type {Map<number, import('./lib/nsu-collect.mjs').SocietyPage> | null} */
let pages = null;
/** @type {Map<number, { name: string, price: number }[]> | null} */
let memberships = null;
/** @type {string[]} */
let sharedNames = [];
if (!noPages) {
  pages = new Map();
  for (const [i, group] of groups.entries()) {
    await pause();
    pages.set(group.nsuId, parseSocietyPage(await get(`${ORIGIN}/activities/view/${group.nsuId}`), group.nsuId));
    if ((i + 1) % 25 === 0 || i + 1 === groups.length) say(`  ${i + 1}/${groups.length} society pages read`);
  }
  const products = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PRODUCT_PAGES) stop(`NSU's products list ran to more than ${MAX_PRODUCT_PAGES} pages`);
    await pause();
    const json = await getJson(productsUrl(page), settings.siteId);
    const found = Array.isArray(json.data) ? json.data : [];
    products.push(...found);
    // A full page may have more after it, whether or not the API says so.
    if (!json.next_page_url && found.length < 100) break;
  }
  ({ memberships, sharedNames } = membershipsByGroup(products, groups));
  say(`  ${products.length} products read for the memberships`);
}

const collectedAt = new Date().toISOString();
/** @type {import('./lib/nsu-collect.mjs').ListFile | null} */
const lastList = existsSync(LIST_FILE) ? JSON.parse(readFileSync(LIST_FILE, 'utf8')) : null;
const { list, pagesFile, review, possibleRenames } = buildFiles(groups, pages, memberships, lastList, collectedAt);
for (const name of sharedNames) review.push(`0 ${name}: two societies share this name in NSU's list, so their memberships couldn't be matched`);
const parsed = pages ? [...pages.values()].filter((page) => page.parsed).length : null;
const checked = pagesFile ? checkSocietyPages(pagesFile, new Set(list.societies.map((society) => society.nsuId))) : null;
const problems = checkBeforeWriting({ societies: groups.length, parsed, pageErrors: checked?.errors ?? [] });
if (problems.length) stop(problems.join('; '));

const summary = summaryText(listChanges(lastList, list, possibleRenames), {
  societies: groups.length,
  requests,
  pages: checked && parsed !== null
    ? { parsed, withDescription: checked.counts.withDescription, withEmail: checked.counts.withEmail, socials: checked.counts.socials, memberships: checked.counts.memberships }
    : null
});
say(`\n${summary}`);

// Review notes for a person, by kind ("12 no picture on the NSU page"); every one with --verbose.
/** @type {Map<string, number>} */
const kinds = new Map();
for (const note of review) {
  const kind = note.split(': ').slice(1).join(': ').replace(/ \(.*\)$/, '');
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
}
if (review.length) {
  say('\nTo check by hand:');
  for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) say(`  ${String(count).padStart(3)}  ${kind}`);
  if (verbose) for (const note of review) say(`       ${note}`);
}

if (pagesTarget && pagesFile) {
  mkdirSync(dirname(pagesTarget), { recursive: true });
  // Only you can read it: it holds personal data.
  writeFileSync(pagesTarget, `${JSON.stringify(pagesFile, null, 2)}\n`, { mode: 0o600 });
  say(`\nWrote the pages file (${checked?.counts.societies} societies) to ${pagesPath}. Import it with import-society-pages.mjs, then delete the key.`);
}
if (sameList(lastList, list)) {
  say('nsu-societies.json: unchanged, so left as it is.');
} else {
  writeFileSync(LIST_FILE, `${JSON.stringify(list, null, 2)}\n`);
  say('nsu-societies.json: updated. Check the change with git diff before committing it.');
}
if (summaryTarget) writeFileSync(summaryTarget, `${summary}\n`);
