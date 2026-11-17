// Checks the shape of a society pages file (the copy of each society's NSU page) and turns it into
// the documents written to Firestore at societies/{nsuId}. Used by import-society-pages.mjs, and
// tested with made-up data by check-society-import.mjs.
//
// The real file holds personal data (contact emails, and some descriptions name committee members),
// so error messages only ever give WHERE something is wrong (such as "64.socials[2].url"), never the
// value itself. otherEmails is never copied: nothing in the app uses it.

/** Social platforms look like "instagram", "tiktok" or "x": lower case letters, digits and dashes. */
const PLATFORM = /^[a-z0-9-]{1,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
const isHttps = (/** @type {unknown} */ value) => httpsLink(value) !== null;
const isText = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';

/**
 * @typedef {{ name: string, description: string[], headerImage: string | null,
 *   socials: { platform: string, url: string }[], memberships: { name: string, price: number }[],
 *   eventsUrl: string, email: string | null, committee: unknown[], source: string, collectedAt: string }} SocietyPageDoc
 */

/**
 * Checks the file and builds one document per society.
 * @param {any} file the parsed JSON
 * @param {Set<number>} knownIds the nsuIds in src/lib/societies/nsu-societies.json
 * @returns {{ errors: string[], docs: Map<number, SocietyPageDoc>,
 *   counts: { societies: number, withDescription: number, withEmail: number, socials: number, memberships: number, withCommittee: number } }}
 */
export function checkSocietyPages(file, knownIds) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<number, SocietyPageDoc>} */
  const docs = new Map();
  const counts = { societies: 0, withDescription: 0, withEmail: 0, socials: 0, memberships: 0, withCommittee: 0 };

  if (!file || typeof file !== 'object' || !file.societies || typeof file.societies !== 'object') {
    return { errors: ['the file needs a "societies" object keyed by NSU id'], docs, counts };
  }
  if (!isHttps(file.source)) errors.push('source: should be an https link');
  if (typeof file.collectedAt !== 'string' || Number.isNaN(new Date(file.collectedAt).getTime())) {
    errors.push('collectedAt: should be a date');
  }

  for (const [key, page] of Object.entries(file.societies)) {
    const id = Number(key);
    /** @param {string} where @param {string} problem */
    const bad = (where, problem) => errors.push(`${key}${where}: ${problem}`);
    if (!Number.isInteger(id) || !knownIds.has(id)) {
      bad('', 'not an NSU id from nsu-societies.json');
      continue;
    }
    if (!page || typeof page !== 'object') {
      bad('', 'should be an object');
      continue;
    }
    const before = errors.length;
    if (!isText(page.name)) bad('.name', 'should be text');
    if (!Array.isArray(page.description) || !page.description.every((paragraph) => typeof paragraph === 'string')) {
      bad('.description', 'should be a list of paragraphs');
    }
    if (page.headerImage !== null && !isHttps(page.headerImage)) bad('.headerImage', 'should be an https link or null');
    if (!Array.isArray(page.socials)) bad('.socials', 'should be a list');
    else page.socials.forEach((/** @type {any} */ social, /** @type {number} */ i) => {
      if (!social || !PLATFORM.test(social.platform ?? '')) bad(`.socials[${i}].platform`, 'should be a platform name such as "instagram"');
      if (!isHttps(social?.url)) bad(`.socials[${i}].url`, 'should be an https link');
    });
    if (!Array.isArray(page.memberships)) bad('.memberships', 'should be a list');
    else page.memberships.forEach((/** @type {any} */ membership, /** @type {number} */ i) => {
      if (!isText(membership?.name)) bad(`.memberships[${i}].name`, 'should be text');
      if (typeof membership?.price !== 'number' || !Number.isFinite(membership.price) || membership.price < 0) {
        bad(`.memberships[${i}].price`, 'should be a number of pounds, 0 or more');
      }
    });
    if (!httpsLink(page.eventsUrl)?.startsWith('https://mynsu.co.uk/')) bad('.eventsUrl', 'should be an https link on mynsu.co.uk');
    // No email can be written as null or "".
    if (page.email !== null && (typeof page.email !== 'string' || (page.email !== '' && !EMAIL.test(page.email)))) {
      bad('.email', 'should be an email address, empty or null');
    }
    if (!Array.isArray(page.committee)) bad('.committee', 'should be a list');
    if (errors.length > before) continue;

    docs.set(id, {
      name: page.name,
      description: page.description.filter((/** @type {string} */ paragraph) => paragraph.trim() !== ''),
      headerImage: page.headerImage === null ? null : httpsLink(page.headerImage),
      socials: page.socials.map((/** @type {any} */ social) => ({ platform: social.platform, url: /** @type {string} */ (httpsLink(social.url)) })),
      memberships: page.memberships.map((/** @type {any} */ membership) => ({ name: membership.name, price: membership.price })),
      eventsUrl: /** @type {string} */ (httpsLink(page.eventsUrl)),
      email: page.email || null,
      committee: page.committee,
      source: file.source,
      collectedAt: file.collectedAt
    });
    counts.societies++;
    if (page.description.length > 0) counts.withDescription++;
    if (page.email) counts.withEmail++;
    counts.socials += page.socials.length;
    counts.memberships += page.memberships.length;
    if (page.committee.length > 0) counts.withCommittee++;
  }

  for (const id of knownIds) {
    if (!Object.hasOwn(file.societies, String(id))) errors.push(`${id}: in nsu-societies.json but missing from this file`);
  }
  return { errors, docs, counts };
}
