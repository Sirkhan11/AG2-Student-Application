import data from '#lib/societies/nsu-societies.json' with { type: 'json' };

// Northumbria Students' Union's societies, collected from their website (see nsu-societies.json for
// where and when): names, NSU categories, campuses, links and pictures. Each society's full NSU page
// (description, memberships, socials and so on) is in Firestore at societies/{nsuId}, imported by
// scripts/import-society-pages.mjs. The list goes out of date as societies come and go, so pages
// show when it was checked. No Firebase here, so the check scripts can use it.

/**
 * @typedef {{ nsuId: number, name: string, category: string | null, campus: string, url: string,
 *   image: string | null }} Society
 */

/** Where the list came from, and when. */
export const SOURCE_URL = data.source;
export const COLLECTED_AT = data.collectedAt;

/** @type {Society[]} */
export const SOCIETIES = data.societies.map((society) => ({
  nsuId: society.nsuId,
  name: society.name,
  category: society.category ?? null,
  campus: society.campus,
  url: society.url,
  image: society.image ?? null
}));

/** The campuses in the list, Newcastle first (most students are there). */
export const CAMPUSES = ['Newcastle', ...new Set(SOCIETIES.map((society) => society.campus).filter((campus) => campus !== 'Newcastle'))];

/** NSU's categories, alphabetical. */
export const CATEGORIES = /** @type {string[]} */ ([
  ...new Set(SOCIETIES.map((society) => society.category).filter((category) => category !== null))
]).sort();

/**
 * Who a society is for, if NOT everyone, by nsuId. Most societies are for everyone, so only the
 * exceptions are listed. The app keeps these out of the check-in chat's suggestions entirely, so
 * Gemini can never offer them to someone it knows nothing about (in testing, a label alone didn't
 * stop it offering a women's running society "if you are a woman"). They stay on the Societies page
 * for anyone to browse, with who they're for shown.
 *
 * PROVISIONAL until NSU confirms. Thomas read the descriptions on 17 November 2026: these two read
 * as women's groups. Ice Hockey (a mixed club with an extra women's programme) and Pilates (open to
 * everyone, with some girls-only classes) have no audience. If the app later asks students
 * (optionally) who they are, the chat could include these for students they apply to; nothing like
 * that is collected now.
 * @type {Record<number, 'women'>}
 */
export const AUDIENCE = {
  185: 'women', // Girls Who Run
  213: 'women' // Women in Business
};

/** How each AUDIENCE value is shown on the Societies pages. */
export const AUDIENCE_LABELS = { women: 'For women' };

/**
 * Societies for one community or group, by nsuId, with a note that's shown to Gemini next to the
 * name. If the society's own NSU description says everyone's welcome, the note says so and the chat
 * may suggest it to anyone interested; otherwise only to students who say they're part of that
 * group. Course societies aren't listed, as they're usually open to anyone. The team should check
 * this when the list is collected again.
 * @type {Record<number, { note: string, everyoneWelcome: boolean }>}
 */
export const GROUP_ONLY = {
  14: { note: 'for Christians', everyoneWelcome: false }, // Christian Union
  270: { note: 'for Christians', everyoneWelcome: false }, // Hope Fellowship
  182: { note: 'for Christians', everyoneWelcome: false }, // Believers Love World
  219: { note: 'for Christians', everyoneWelcome: false }, // Redeemed Christian Fellowship
  262: { note: 'for Coptic Christians', everyoneWelcome: false }, // Coptic
  50: { note: 'Muslim community, everyone welcome', everyoneWelcome: true }, // Islamic
  242: { note: 'for the Bangladeshi community', everyoneWelcome: false }, // Bangladesh Synergy Network
  287: { note: 'for the East African community', everyoneWelcome: false }, // East African
  32: { note: 'for the Filipino community', everyoneWelcome: false }, // Filipino
  111: { note: 'for the Indian community', everyoneWelcome: false }, // Indian
  169: { note: 'for the Indian community', everyoneWelcome: false }, // Indian Society
  247: { note: 'Iraqi community, everyone welcome', everyoneWelcome: true }, // Iraqi
  272: { note: 'Kurdish community, everyone welcome', everyoneWelcome: true }, // Kurdish
  57: { note: 'Malaysian community, everyone welcome', everyoneWelcome: true }, // Malaysian
  67: { note: 'for the Nigerian community', everyoneWelcome: false }, // Nigerian
  201: { note: 'for the Nigerian community', everyoneWelcome: false }, // Nigerian (London)
  152: { note: 'for the Pakistani community', everyoneWelcome: false }, // Pakistani
  92: { note: 'for the Saudi community', everyoneWelcome: false }, // Saudi
  120: { note: 'Sri Lankan community, everyone welcome', everyoneWelcome: true }, // Sri Lankan
  175: { note: 'Sudanese community, everyone welcome', everyoneWelcome: true }, // Sudanese
  214: { note: 'Ukrainian community, everyone welcome', everyoneWelcome: true }, // Ukrainian
  294: { note: 'for mature students', everyoneWelcome: false }, // Mature Students
  289: { note: 'for Master’s students', everyoneWelcome: false }, // Masters Society
  84: { note: 'for postgraduate researchers', everyoneWelcome: false }, // Postgraduate Research
  266: { note: 'for postgraduate researchers', everyoneWelcome: false }, // Postgraduate Education Research
  224: { note: 'for student carers', everyoneWelcome: false }, // Student Carers
  56: { note: 'LGBTQ+ community, everyone welcome', everyoneWelcome: true }, // LGBTQ+
  168: { note: 'neurodiverse community, everyone welcome', everyoneWelcome: true } // Neurodiverse & Inclusive
};

/**
 * True for societies the check-in chat may suggest: everything except those with a restricted
 * AUDIENCE. Chat replies are turned into links by src/lib/checkin/reply-links.js.
 */
export function suggestible(/** @type {Society} */ society) {
  return !Object.hasOwn(AUDIENCE, society.nsuId);
}

/** Lower case with single spaces, for comparing names. @param {string} text */
const simple = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The society with this NSU id, or null.
 * @param {number} nsuId
 */
export function societyById(nsuId) {
  return SOCIETIES.find((society) => society.nsuId === nsuId) ?? null;
}

/**
 * The societies on one campus whose name or category contains the search text, optionally in one
 * category, in alphabetical order.
 * @param {string} search
 * @param {string} campus
 * @param {string} [category] a category from CATEGORIES, or 'all'
 */
export function searchSocieties(search, campus, category = 'all') {
  const wanted = simple(search);
  return SOCIETIES.filter(
    (society) =>
      society.campus === campus &&
      (category === 'all' || society.category === category) &&
      (simple(society.name).includes(wanted) || simple(society.category ?? '').includes(wanted))
  ).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Finds a society on a campus by its exact name (ignoring capitals and spacing), or null.
 * @param {string} name
 * @param {string} campus
 */
export function findSociety(name, campus) {
  return SOCIETIES.find((society) => society.campus === campus && simple(society.name) === simple(name)) ?? null;
}

/**
 * Up to two capital letters from a society's name, shown when it has no picture: "Outdoor Climbing"
 * gives "OC", and "Music" gives "M". Small words like "and" and symbols like "&" are skipped.
 * @param {string} name
 */
export function initials(name) {
  const words = name
    .split(/[^\p{L}\p{N}+]+/u)
    .filter((word) => word && !['and', 'of', 'the', 'for', 'in'].includes(word.toLowerCase()));
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';
}
