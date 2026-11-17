// Checks the shape of a sport club pages file (a copy of each club's page on northumbriasport.com)
// and turns it into the documents written to Firestore at sportClubs/{slug}. Used by
// import-sport-club-pages.mjs, and tested with made-up data by check-sport-club-import.mjs.
//
// The real file holds personal data (club contacts' names and emails, some of them personal
// addresses), so it stays out of the repo. Error messages only ever say WHERE something is wrong
// (such as "swimming.contacts[2].people[0].email"), never the value, and nothing here goes to Gemini.

/** Social platforms look like "instagram" or "x": lower case letters, digits and dashes. */
const PLATFORM = /^[a-z0-9-]{1,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A contact's note longer than this is left out. In the November 2026 collection, two notes were
 * whole chunks of the club's page (repeating its text and naming other people), not notes. The
 * contact's people are still imported.
 */
export const MAX_NOTE_LENGTH = 300;

/**
 * The link tidied up (spaces encoded, for example) if it's a valid https link, otherwise null.
 * @param {unknown} value
 */
function httpsLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
const isText = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';
/** Text, or nothing at all (missing, null or empty). @param {unknown} value */
const isOptionalText = (value) => value === undefined || value === null || typeof value === 'string';

/**
 * A contact's people always have an email; a name can be missing (some clubs list a role with an
 * extra address but no name beside it), and is then null.
 * @typedef {{ role: string | null, note: string | null, people: { name: string | null, email: string }[] }} ClubContact
 * @typedef {{ name: string, about: string[], membership: { kind: 'text' | 'item', text: string }[],
 *   socials: { platform: string, url: string }[], contacts: ClubContact[], url: string,
 *   bookUrl: string | null, source: string, collectedAt: string }} SportClubDoc
 */

/**
 * Checks the file and builds one document per club. Problems that stop the import are in errors;
 * things a person should know (a long note left out) are in review. Neither ever holds a name or
 * an email.
 * @param {any} file the parsed JSON
 * @param {Set<string>} knownSlugs the slugs in src/lib/sport/sport-clubs.json
 */
export function checkSportClubPages(file, knownSlugs) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const review = [];
  /** @type {Map<string, SportClubDoc>} */
  const docs = new Map();
  const counts = { clubs: 0, withAbout: 0, withMembership: 0, membershipLines: 0, sessionItems: 0, contacts: 0, people: 0, socials: 0, withBookUrl: 0, notesLeftOut: 0 };

  if (!file || typeof file !== 'object' || !file.clubs || typeof file.clubs !== 'object') {
    return { errors: ['the file needs a "clubs" object keyed by slug'], review, docs, counts };
  }
  if (!httpsLink(file.source)) errors.push('source: should be an https link');
  if (typeof file.collectedAt !== 'string' || Number.isNaN(new Date(file.collectedAt).getTime())) {
    errors.push('collectedAt: should be a date');
  }

  for (const [slug, page] of Object.entries(file.clubs)) {
    /** @param {string} where @param {string} problem */
    const bad = (where, problem) => errors.push(`${slug}${where}: ${problem}`);
    if (!knownSlugs.has(slug)) {
      bad('', 'not a slug from sport-clubs.json');
      continue;
    }
    if (!page || typeof page !== 'object') {
      bad('', 'should be an object');
      continue;
    }
    const before = errors.length;
    if (!isText(page.name)) bad('.name', 'should be text');
    if (!httpsLink(page.url)) bad('.url', 'should be an https link');
    if (page.bookUrl !== undefined && page.bookUrl !== null && !httpsLink(page.bookUrl)) bad('.bookUrl', 'should be an https link or null');
    if (!Array.isArray(page.about) || !page.about.every((/** @type {unknown} */ paragraph) => typeof paragraph === 'string')) {
      bad('.about', 'should be a list of paragraphs');
    }
    const membership = page.membership ?? [];
    if (!Array.isArray(membership)) bad('.membership', 'should be a list');
    else membership.forEach((/** @type {any} */ line, /** @type {number} */ i) => {
      if (!line || (line.kind !== 'text' && line.kind !== 'item') || typeof line.text !== 'string') {
        bad(`.membership[${i}]`, 'should be { kind: "text" or "item", text }');
      }
    });
    const socials = page.socials ?? [];
    if (!Array.isArray(socials)) bad('.socials', 'should be a list');
    else socials.forEach((/** @type {any} */ social, /** @type {number} */ i) => {
      if (!social || !PLATFORM.test(social.platform ?? '')) bad(`.socials[${i}].platform`, 'should be a platform name such as "instagram"');
      if (!httpsLink(social?.url)) bad(`.socials[${i}].url`, 'should be an https link');
    });
    const contacts = page.contacts ?? [];
    if (!Array.isArray(contacts)) bad('.contacts', 'should be a list');
    else contacts.forEach((/** @type {any} */ contact, /** @type {number} */ i) => {
      if (!contact || typeof contact !== 'object') return bad(`.contacts[${i}]`, 'should be an object');
      if (!isOptionalText(contact.role) || !isOptionalText(contact.note)) bad(`.contacts[${i}]`, 'role and note should be text or null');
      else if (!isText(contact.role) && !isText(contact.note)) bad(`.contacts[${i}]`, 'needs a role or a note');
      if (!Array.isArray(contact.people)) return bad(`.contacts[${i}].people`, 'should be a list');
      contact.people.forEach((/** @type {any} */ person, /** @type {number} */ j) => {
        if (!isOptionalText(person?.name)) bad(`.contacts[${i}].people[${j}].name`, 'should be text, or empty');
        if (typeof person?.email !== 'string' || !EMAIL.test(person.email.trim())) bad(`.contacts[${i}].people[${j}].email`, 'should be an email address');
      });
    });
    if (errors.length > before) continue;

    const about = page.about.map((/** @type {string} */ paragraph) => paragraph.trim()).filter(Boolean);
    const lines = membership
      .map((/** @type {any} */ line) => ({ kind: /** @type {'text' | 'item'} */ (line.kind), text: line.text.trim() }))
      .filter((/** @type {{ text: string }} */ line) => line.text !== '');
    /** @type {ClubContact[]} */
    const keptContacts = contacts.map((/** @type {any} */ contact, /** @type {number} */ i) => {
      let note = isText(contact.note) ? contact.note.trim() : null;
      if (note && note.length > MAX_NOTE_LENGTH) {
        review.push(`${slug}: contact ${i + 1}'s note was ${note.length} characters, so it was left out (its people are kept)`);
        counts.notesLeftOut++;
        note = null;
      }
      return {
        role: isText(contact.role) ? contact.role.trim() : null,
        note,
        people: contact.people.map((/** @type {any} */ person) => ({ name: isText(person.name) ? person.name.trim() : null, email: person.email.trim() }))
      };
    });

    docs.set(slug, {
      name: page.name.trim(),
      about,
      membership: lines,
      socials: socials.map((/** @type {any} */ social) => ({ platform: social.platform, url: /** @type {string} */ (httpsLink(social.url)) })),
      contacts: keptContacts,
      url: /** @type {string} */ (httpsLink(page.url)),
      bookUrl: httpsLink(page.bookUrl),
      source: file.source,
      collectedAt: file.collectedAt
    });
    counts.clubs++;
    if (about.length) counts.withAbout++;
    if (lines.length) counts.withMembership++;
    counts.membershipLines += lines.length;
    counts.sessionItems += lines.filter((/** @type {{ kind: string }} */ line) => line.kind === 'item').length;
    counts.contacts += keptContacts.length;
    counts.people += keptContacts.reduce((sum, contact) => sum + contact.people.length, 0);
    counts.socials += socials.length;
    if (page.bookUrl) counts.withBookUrl++;
  }

  for (const slug of knownSlugs) {
    if (!Object.hasOwn(file.clubs, slug)) errors.push(`${slug}: in sport-clubs.json but missing from this file`);
  }
  return { errors, review, docs, counts };
}
