// The offline part of collect-sport-clubs.mjs: reading Northumbria Sport's /sports page and club
// pages, and building the two files the app uses, with the same rules as the November 2026
// collection (process_sport.py):
// - src/lib/sport/sport-clubs.json, the public list: each club's slug, name, link and picture
// - the private pages file for Firestore (sportClubs/{slug}): about, memberships and training,
//   socials, contacts and the booking link. It holds personal data (club contacts' names and
//   emails), so it's only ever written outside the repo, and nothing from it is printed.
// Tested with made-up pages by check-collect-sport.mjs. Nothing here goes to the network.

import { DOMParser } from 'linkedom';
import { blockedReason, maskEmails, platformOf } from './nsu-collect.mjs';

export { blockedReason, maskEmails };
export { expandHome, isInside } from './paths.mjs';

export const ORIGIN = 'https://northumbriasport.com';
export const LIST_URL = `${ORIGIN}/sports`;
/** Says what's asking, so Northumbria Sport can tell it apart from people and other bots. */
export const USER_AGENT = 'AG2StudentApp-Sport-refresh/1.0 (Northumbria University student project)';
/** The fewest clubs /sports has listed (38 in November 2026). Fewer means the page has probably changed. */
export const MIN_CLUBS = 30;
/** What an email address in about or membership text becomes (as in process_sport.py). */
export const EMAIL_NOTE = '[email on their page]';
/** A "role" longer than this is really a sentence, so the line is kept as a note instead. */
const MAX_ROLE_LENGTH = 60;

const LIST_NOTE = "Northumbria Sport's student sports clubs. Pictures are links to Northumbria Sport's site, not copies.";
const PAGES_NOTE =
  "Copied from each club's page on northumbriasport.com, for Firestore (sportClubs/{slug}). " +
  'Personal data: contacts holds the names and emails of club captains, presidents and coaches ' +
  'as the club pages publish them, and some about text names people. Keep this file out of the repo.';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * @typedef {{ slug: string, name: string, url: string }} ListedClub a club as /sports lists it
 * @typedef {{ slug: string, name: string, url: string, image: string | null }} ListClub
 * @typedef {{ source: string, collectedAt: string, note: string, count: number, clubs: ListClub[] }} ListFile
 * @typedef {{ kind: 'text' | 'item', text: string }} MembershipLine
 * @typedef {{ platform: string, url: string }} Social
 * @typedef {{ text: string, people: { name: string | null, email: string }[] }} ContactLine a line with email links, as the page has it
 * @typedef {{ role: string | null, note: string | null, people: { name: string | null, email: string }[] }} Contact
 * @typedef {{ parsed: boolean, name: string | null, image: string | null, about: string[], membership: MembershipLine[],
 *   socials: Social[], socialsLeftOut: number, contactLines: ContactLine[], bookUrl: string | null }} ClubPage
 * @typedef {{ name: string, url: string, about: string[], membership: MembershipLine[], socials: Social[],
 *   contacts: Contact[], bookUrl: string | null }} PagesEntry
 * @typedef {{ source: string, collectedAt: string, note: string, count: number, clubs: Record<string, PagesEntry> }} PagesFile
 */

/** Text with runs of spaces and new lines made one space. @param {string | null | undefined} text */
const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

/** Email addresses replaced, as process_sport.py did for about and membership text. @param {string} text */
const scrub = (text) => text.replace(EMAIL, EMAIL_NOTE);

/**
 * The link made absolute against the page it's on, if it's https; otherwise null.
 * @param {string | null | undefined} href
 * @param {string} base
 */
function httpsUrl(href, base) {
  if (!href || !href.trim()) return null;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The clubs on Northumbria Sport's /sports page: every link to /sport/<slug> with a name, once each,
 * in the page's order. The page has no pictures, so those come from each club's page.
 * @param {string} html
 * @returns {ListedClub[]}
 */
export function parseClubList(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  /** @type {ListedClub[]} */
  const clubs = [];
  for (const link of doc.querySelectorAll('a[href]')) {
    let url;
    try {
      url = new URL(/** @type {string} */ (link.getAttribute('href')).trim(), LIST_URL);
    } catch {
      continue;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.origin !== ORIGIN || parts.length !== 2 || parts[0] !== 'sport' || !/^[a-z0-9-]+$/.test(parts[1])) continue;
    const name = clean(link.textContent);
    // A picture-only link has no name; the club's text link is used instead.
    if (!name || clubs.some((club) => club.slug === parts[1])) continue;
    clubs.push({ slug: parts[1], name, url: `${ORIGIN}/sport/${parts[1]}` });
  }
  return clubs;
}

/**
 * Reads one club's page:
 * - name: h1.article-title (the page counts as read if it has one)
 * - picture: the first banner picture, made absolute
 * - socials: the links in the header's social list (empty links, such as a Facebook icon with no
 *   page behind it, and links that aren't https are left out)
 * - contacts: every line of the article with email links, wherever it is
 * - about: the rest of the article before its first rule (<hr>), a list being one paragraph per item
 * - after the rule: lists are session times ("item"); every other line (tables included, as one
 *   line) is membership and training text
 * - the booking link: the "Book Online" button
 * @param {string} html
 * @param {string} url the page's own address, for making links absolute
 * @returns {ClubPage}
 */
export function parseClubPage(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // A line break counts as a space, so "Mondays<br>18:00" doesn't run together.
  for (const br of [...doc.querySelectorAll('br')]) br.replaceWith(doc.createTextNode(' '));
  const title = doc.querySelector('h1.article-title');

  const socials = [];
  let socialsLeftOut = 0;
  for (const link of doc.querySelectorAll('.article__header ul.social-media a')) {
    const href = (link.getAttribute('href') ?? '').trim();
    // An empty link is an icon with no page behind it (a club with no Facebook, say).
    if (!href || href === '#') continue;
    if (!httpsUrl(href, url) || !/^https:\/\//i.test(href)) {
      socialsLeftOut++;
      continue;
    }
    socials.push({ platform: platformOf(href), url: href });
  }

  const body = doc.querySelector('.article__body');
  const children = body ? [...body.children] : [];
  const firstRule = children.findIndex((element) => element.tagName === 'HR');

  /** @type {string[]} */
  const about = [];
  /** @type {MembershipLine[]} */
  const membership = [];
  /** @type {ContactLine[]} */
  const contactLines = [];
  for (const [i, element] of children.entries()) {
    if (element.tagName === 'HR') continue;
    const inAbout = firstRule === -1 || i < firstRule;
    // A line with email links is a contact, wherever it is on the page.
    const mailto = [...element.querySelectorAll('a[href]')].filter((link) => /^mailto:/i.test(link.getAttribute('href') ?? ''));
    if (mailto.length) {
      contactLines.push({
        text: clean(element.textContent),
        people: mailto.map((link) => {
          // Addresses in lower case, as in the November collection.
          const email = safeDecode((link.getAttribute('href') ?? '').replace(/^mailto:/i, '')).split('?')[0].trim().toLowerCase();
          const name = clean(link.textContent);
          // A link whose text is the address itself has no name beside it.
          return { name: name && !name.includes('@') ? name : null, email };
        })
      });
      continue;
    }
    // A list is one line per item: paragraphs in the about text, session times after the rule.
    if (element.tagName === 'UL' || element.tagName === 'OL') {
      for (const item of element.querySelectorAll('li')) {
        const text = clean(item.textContent);
        if (!text) continue;
        if (inAbout) about.push(text);
        else membership.push({ kind: 'item', text });
      }
      continue;
    }
    const text = clean(element.textContent);
    if (!text) continue;
    if (inAbout) about.push(text);
    else membership.push({ kind: 'text', text });
  }

  const book = doc.querySelector('a.btn-book[href]') ?? [...doc.querySelectorAll('a[href]')].find((link) => /book online/i.test(link.textContent ?? ''));
  return {
    parsed: Boolean(title),
    name: title ? clean(title.textContent) : null,
    image: httpsUrl(doc.querySelector('div.banner img.banner-image')?.getAttribute('src'), url),
    about,
    membership,
    socials,
    socialsLeftOut,
    contactLines,
    bookUrl: book ? httpsUrl(book.getAttribute('href'), url) : null
  };
}

/** @param {string} text */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Only what the list needs from a club page (whether it read, its name and its picture), for a
 * list-only run: the rest of the page, contacts included, is dropped as soon as it's read.
 * @param {ClubPage} page
 * @returns {ClubPage}
 */
export function pictureOnly(page) {
  return { parsed: page.parsed, name: page.name, image: page.image, about: [], membership: [], socials: [], socialsLeftOut: 0, contactLines: [], bookUrl: null };
}

/**
 * Turns a page's lines with email links into contacts, as process_sport.py did:
 * - "supported by" anywhere: role "Supported by" (Northumbria Sport staff)
 * - "Role: Name" or "Role - Name": the role is the part before
 * - anything else: a note (emails taken out), such as "For general enquiries please email..."
 * - a "role" over 60 characters is really a sentence, so it's a note instead
 * - people need an email with an "@"; a line left with nobody is dropped
 * @param {ContactLine[]} lines
 * @returns {Contact[]}
 */
export function contactsFrom(lines) {
  /** @type {Contact[]} */
  const contacts = [];
  for (const line of lines) {
    const people = line.people.filter((person) => person.email.includes('@'));
    /** @type {string | null} */
    let role = null;
    /** @type {string | null} */
    let note = null;
    if (/supported by/i.test(line.text)) role = 'Supported by';
    else if (line.text.includes(':')) role = line.text.split(':')[0].trim();
    else if (/\s[-–]\s/.test(line.text)) role = line.text.split(/\s[-–]\s/)[0].trim();
    else note = scrub(line.text);
    if (role !== null && (role === '' || role.length > MAX_ROLE_LENGTH)) {
      role = null;
      note = scrub(line.text);
    }
    if (people.length) contacts.push({ role, note, people });
  }
  return contacts;
}

/**
 * Builds the public list and, when pages is true, the private pages file. Clubs are sorted by name
 * (ignoring capitals), as before. Also returns notes for a person to check, by slug (never page text).
 * @param {ListedClub[]} listed
 * @param {Map<string, ClubPage>} pages every listed club's page, by slug
 * @param {string} collectedAt
 * @param {boolean} withPages
 */
export function buildFiles(listed, pages, collectedAt, withPages) {
  /** @type {string[]} */
  const review = [];
  const lower = (/** @type {string} */ name) => name.toLowerCase();
  const sorted = [...listed].sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0));

  /** @type {ListClub[]} */
  const clubs = sorted.map((club) => {
    const page = pages.get(club.slug);
    if (!page?.image) review.push(`${club.slug}: no picture on the club page`);
    if (page?.name && page.name !== club.name) review.push(`${club.slug}: the club page's heading differs from its name on /sports (the list keeps /sports's)`);
    return { slug: club.slug, name: club.name, url: club.url, image: page?.image ?? null };
  });
  /** @type {ListFile} */
  const list = { source: LIST_URL, collectedAt, note: LIST_NOTE, count: clubs.length, clubs };
  if (!withPages) return { list, pagesFile: null, review };

  /** @type {Record<string, PagesEntry>} */
  const entries = {};
  for (const club of sorted) {
    const page = /** @type {ClubPage} */ (pages.get(club.slug));
    const entry = {
      name: club.name,
      url: club.url,
      about: page.about.map(scrub),
      membership: page.membership.map((line) => ({ kind: line.kind, text: scrub(line.text) })),
      socials: page.socials,
      contacts: contactsFrom(page.contactLines),
      bookUrl: page.bookUrl
    };
    if (!entry.membership.length) review.push(`${club.slug}: no membership or training details on the club page`);
    if (!entry.contacts.length) review.push(`${club.slug}: no contact emails on the club page`);
    if (page.socialsLeftOut) review.push(`${club.slug}: a social link that isn't https was left out`);
    entries[club.slug] = entry;
  }
  /** @type {PagesFile} */
  const pagesFile = { source: LIST_URL, collectedAt, note: PAGES_NOTE, count: sorted.length, clubs: entries };
  return { list, pagesFile, review };
}

/**
 * True if the two lists are the same apart from when they were collected.
 * @param {ListFile | null} a
 * @param {ListFile} b
 */
export function sameList(a, b) {
  if (!a) return false;
  const strip = (/** @type {ListFile} */ list) => JSON.stringify({ ...list, collectedAt: null });
  return strip(a) === strip(b);
}

/**
 * What changed in the list since last time, by slug.
 * @param {ListFile | null} lastList
 * @param {ListFile} list
 */
export function listChanges(lastList, list) {
  const before = new Map((lastList?.clubs ?? []).map((club) => [club.slug, club]));
  const after = new Map(list.clubs.map((club) => [club.slug, club]));
  /** @param {(was: ListClub, now: ListClub) => boolean} differs */
  const changed = (differs) => list.clubs.filter((club) => before.has(club.slug) && differs(/** @type {ListClub} */ (before.get(club.slug)), club)).map((club) => club.slug);
  return {
    added: [...after.keys()].filter((slug) => !before.has(slug)),
    removed: [...before.keys()].filter((slug) => !after.has(slug)),
    renamed: changed((was, now) => was.name !== now.name),
    pictures: changed((was, now) => was.image !== now.image),
    links: changed((was, now) => was.url !== now.url),
    order: list.clubs.map((club) => club.slug).join() !== (lastList?.clubs ?? []).map((club) => club.slug).join()
  };
}

/** The parts of a pages file entry compared, in the order they're reported. */
const PAGE_PARTS = /** @type {const} */ (['name', 'url', 'about', 'membership', 'socials', 'contacts', 'bookUrl']);

/**
 * Which clubs' details differ between two pages files, and in which parts, by slug and part name
 * only (never the values). A contact's missing name compares equal whether it's null or empty.
 * @param {any} lastFile the pages file imported last time
 * @param {PagesFile} file
 */
export function pagesChanges(lastFile, file) {
  const before = lastFile?.clubs ?? {};
  /** @param {any} entry @param {typeof PAGE_PARTS[number]} part */
  const value = (entry, part) => {
    if (part !== 'contacts') return JSON.stringify(entry?.[part] ?? null);
    return JSON.stringify((entry?.contacts ?? []).map((/** @type {any} */ contact) => ({
      role: contact.role ?? null,
      note: contact.note ?? null,
      people: (contact.people ?? []).map((/** @type {any} */ person) => ({ name: person.name || null, email: person.email }))
    })));
  };
  /** @type {{ slug: string, parts: string[] }[]} */
  const changed = [];
  let same = 0;
  for (const [slug, entry] of Object.entries(file.clubs)) {
    if (!Object.hasOwn(before, slug)) continue;
    const parts = PAGE_PARTS.filter((part) => value(before[slug], part) !== value(entry, part));
    if (parts.length) changed.push({ slug, parts });
    else same++;
  }
  return {
    same,
    changed,
    added: Object.keys(file.clubs).filter((slug) => !Object.hasOwn(before, slug)),
    removed: Object.keys(before).filter((slug) => !Object.hasOwn(file.clubs, slug))
  };
}

/**
 * The change summary: counts and slugs only, never names, emails or page text. Also the body of
 * the workflow's pull request.
 * @param {ReturnType<typeof listChanges>} changes
 * @param {{ clubs: number, requests: number, pages: null | { withAbout: number, withMembership: number, contacts: number, people: number, socials: number, withBookUrl: number } }} counts
 */
export function summaryText(changes, counts) {
  const lines = [`Northumbria Sport lists ${counts.clubs} clubs (${counts.requests} requests to northumbriasport.com).`];
  if (counts.pages) {
    const { withAbout, withMembership, contacts, people, socials, withBookUrl } = counts.pages;
    lines.push(`Club pages: ${withAbout} with about text, ${withMembership} with memberships and training, ${contacts} contacts (${people} people), ${socials} social links, ${withBookUrl} booking links.`);
  }
  lines.push('');
  /** @param {string} heading @param {string[]} slugs */
  const section = (heading, slugs) => {
    if (slugs.length) lines.push(`${heading} (${slugs.length}): ${slugs.join(', ')}`, '');
  };
  section('New clubs', changes.added);
  section('No longer on /sports (not deleted from Firestore)', changes.removed);
  section('Names changed', changes.renamed);
  section('Pictures changed', changes.pictures);
  section('Links changed', changes.links);
  const nothing = !changes.added.length && !changes.removed.length && !changes.renamed.length && !changes.pictures.length && !changes.links.length;
  if (nothing) lines.push(changes.order ? 'Only the order of the list has changed.' : "The list hasn't changed.");
  return maskEmails(lines.join('\n').trim());
}

/**
 * Reasons not to write anything: too few clubs, club pages that didn't read as expected, or a
 * pages file the import would refuse. Empty if it's fine to write.
 * @param {{ clubs: number, unparsed: string[], pageErrors: string[] }} found
 */
export function checkBeforeWriting({ clubs, unparsed, pageErrors }) {
  const problems = [];
  if (clubs < MIN_CLUBS) problems.push(`only ${clubs} clubs on /sports (at least ${MIN_CLUBS} expected), so the page may have changed`);
  if (unparsed.length) problems.push(`${unparsed.length} club page(s) didn't read as expected (${unparsed.join(', ')}), so the layout may have changed`);
  if (pageErrors.length) problems.push(`the pages file doesn't pass the import's checks: ${pageErrors.slice(0, 5).join('; ')}`);
  return problems;
}
