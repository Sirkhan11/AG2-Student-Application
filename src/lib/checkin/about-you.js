// What the check-in chat is always told about a student, besides their mentor and checklist (those
// are in describeForGemini, opener.js): the "about you" record.
// - From sign-up: their first name (never the rest of their name), course, interests and arrival date.
// - From finding a mentor: a summary of their answers (what they're into, what they'd rather avoid,
//   and how they like to do things), kept in their record as matchingSummary.
// - Up to MAX_NOTES things they chose for the chat to remember (remember-notes.js).
// Everything is tidied for Gemini: one line each, kept short, with email addresses and phone numbers
// blanked. The "What the chat knows about you" page (/about-you) shows the same record. No Firebase
// here, so the checks can test it in Node.

import { blankContactDetails } from '#lib/checkin/private-details.js';
import { firstName } from '#lib/students/greeting.js';

const MAX_INTERESTS = 10;
const MAX_INTEREST_LENGTH = 40;
const MAX_COURSE_LENGTH = 80;
/** At most this many of the summary's likes, and of its avoids, and this long each. */
export const MAX_SUMMARY_LIKES = 12;
export const MAX_SUMMARY_AVOIDS = 8;
const MAX_PHRASE_LENGTH = 60;
/**
 * The chat remembers at most MAX_NOTES things for a student, each one line of at most
 * MAX_NOTE_LENGTH characters. firestore.rules checks both (chatNotes).
 */
export const MAX_NOTES = 10;
export const MAX_NOTE_LENGTH = 100;

/**
 * Text from the student's own records, tidied for Gemini: one line, contact details blanked, kept short.
 * @param {unknown} value
 * @param {number} max
 */
export function tidyText(value, max) {
  return typeof value === 'string' ? blankContactDetails(value).replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
}

/**
 * Tidied phrases: one line each, blanks and repeats (in any capitals) dropped, at most max of them.
 * @param {unknown} list
 * @param {number} max
 * @param {number} length
 */
function tidyList(list, max, length) {
  /** @type {string[]} */
  const kept = [];
  for (const item of Array.isArray(list) ? list : []) {
    const phrase = tidyText(item, length);
    if (phrase && !kept.some((known) => known.toLowerCase() === phrase.toLowerCase())) kept.push(phrase);
  }
  return kept.slice(0, max);
}

/**
 * The course and interests from a student's sign-up, tidied for Gemini. The sign-up form saves the
 * interests as typed, split on commas, so they're trimmed, with blanks and repeats dropped, kept
 * short, and any email address or phone number blanked.
 * @param {{ course?: unknown, interests?: unknown } | null | undefined} profile
 * @returns {{ course: string | null, interests: string[] }}
 */
export function tidyProfile(profile) {
  const given = profile?.interests;
  const raw = Array.isArray(given) ? given : typeof given === 'string' ? given.split(',') : [];
  return { course: tidyText(profile?.course, MAX_COURSE_LENGTH) || null, interests: tidyList(raw, MAX_INTERESTS, MAX_INTEREST_LENGTH) };
}

/**
 * How someone describes themselves, from their answers (see Styles in summary-prompt.js); null where
 * they didn't say.
 * @typedef {{ social: string | null, planning: string | null, working: string | null }} SummaryStyles
 */

/**
 * The summary of a student's answers from finding a mentor, as their record keeps it for the chat
 * (students/{uid}.matchingSummary): their likes and avoids as single lists, and their styles.
 * @typedef {{ likes: string[], avoids: string[], styles: SummaryStyles }} MatchingSummary
 */

const STYLE_KEYS = /** @type {const} */ (['social', 'planning', 'working']);

/**
 * Gemini's summary of their answers (one list of phrases per answer) as the chat keeps it: one list
 * of likes and one of avoids, without repeats, kept short, and the styles.
 * @param {{ likes?: unknown, avoids?: unknown, styles?: unknown } | null | undefined} summary
 * @returns {MatchingSummary | null}
 */
export function summaryForChat(summary) {
  if (!summary || typeof summary !== 'object') return null;
  /** @param {unknown} lists */
  const flat = (lists) => (Array.isArray(lists) ? lists.flatMap((list) => (Array.isArray(list) ? list : [list])) : []);
  const given = /** @type {Record<string, unknown>} */ (summary.styles && typeof summary.styles === 'object' ? summary.styles : {});
  /** @type {SummaryStyles} */
  const styles = { social: null, planning: null, working: null };
  for (const key of STYLE_KEYS) styles[key] = tidyText(given[key], 20) || null;
  return {
    likes: tidyList(flat(summary.likes), MAX_SUMMARY_LIKES, MAX_PHRASE_LENGTH),
    avoids: tidyList(flat(summary.avoids), MAX_SUMMARY_AVOIDS, MAX_PHRASE_LENGTH),
    styles
  };
}

/**
 * Their styles in words, leaving out what they didn't say: "going out", "planning ahead", "working
 * with others", or "both going out and staying in" and so on.
 * @param {SummaryStyles | null | undefined} styles
 * @param {'their' | 'your'} [whose] "their" for Gemini, "your" on the About you page
 * @returns {string[]}
 */
export function stylesInWords(styles, whose = 'their') {
  /** @type {Record<string, string>} */
  const both = { social: 'both going out and staying in', planning: 'both planning ahead and last minute', working: `both on ${whose} own and with others` };
  /** @type {Record<string, string>} */
  const named = { 'on my own': `working on ${whose} own`, 'with others': 'working with others' };
  return STYLE_KEYS.map((key) => styles?.[key]).map((value, i) => (!value ? '' : value === 'both' ? both[STYLE_KEYS[i]] : (named[value] ?? value))).filter(Boolean);
}

/** @param {number} n */
const twoDigits = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A date as the sign-up form saves it (2027-01-20) in words ("20 January 2027"), or null if it isn't one.
 * @param {unknown} value
 */
export function dateInWords(value) {
  const parts = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null;
  if (!parts) return null;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Today's date as the sign-up form writes dates (for dateInWords). @param {Date} now */
export const isoDate = (now) => `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;

/**
 * The record, tidied for Gemini.
 * @typedef {{ firstName: string | null, course: string | null, interests: string[], arrivalDate: string | null,
 *   summary: MatchingSummary | null, notes: string[] }} AboutYou
 */

/**
 * The about-you record from what the app has: the student's own record (students/{uid}) and the
 * notes they chose (chatNotes/{uid}). Only their first name is taken from their name.
 * @param {{ name?: unknown, course?: unknown, interests?: unknown, arrivalDate?: unknown,
 *   matchingSummary?: unknown, notes?: unknown } | null | undefined} record
 * @returns {AboutYou}
 */
export function aboutYou(record) {
  const name = firstName(record?.name);
  const first = name ? tidyText(name, 40) : '';
  return {
    ...tidyProfile(record),
    firstName: first && first === name ? first : null,
    arrivalDate: dateInWords(record?.arrivalDate) ? String(record?.arrivalDate).trim() : null,
    summary: record?.matchingSummary ? summaryForChat(/** @type {any} */ (record.matchingSummary)) : null,
    notes: tidyList(record?.notes, MAX_NOTES, MAX_NOTE_LENGTH)
  };
}

/**
 * The record's lines for Gemini's instructions ("What the app knows about them"). today, as the
 * sign-up form writes dates (2026-11-17), lets Gemini tell whether they've arrived yet.
 * @param {AboutYou} about
 * @param {string | null} [today]
 * @returns {string[]}
 */
export function aboutYouForGemini(about, today = null) {
  const lines = [];
  lines.push(
    about.firstName
      ? `Their first name: ${about.firstName}. It's the only name you're told. Use it sparingly, as a friend would: perhaps in your first reply, then only once in a while. Most replies shouldn't include it, and never add it just to thank them or say goodbye.`
      : "Their first name: not known, so don't use a name or ask for one."
  );
  if (about.course) lines.push(`Their course (from when they signed up): ${about.course}.`);
  if (about.interests.length) lines.push(`Interests they gave when they signed up: ${about.interests.join(', ')}.`);
  const arrival = dateInWords(about.arrivalDate);
  if (arrival) lines.push(`Their arrival date (from when they signed up): ${arrival}.${dateInWords(today) ? ` Today is ${dateInWords(today)}.` : ''}`);
  if (about.summary) {
    const styles = stylesInWords(about.summary.styles);
    const parts = [
      about.summary.likes.length ? `they're into ${about.summary.likes.join(', ')}` : '',
      about.summary.avoids.length ? `they'd rather avoid ${about.summary.avoids.join(', ')}` : '',
      styles.length ? `they describe themselves as ${styles.join(', ')}` : ''
    ].filter(Boolean);
    if (parts.length) lines.push(`From their answers when finding a mentor (a summary): ${parts.join('; ')}.`);
  }
  lines.push(
    about.notes.length
      ? `Things they asked you to remember (they chose these, and can see and delete them on [[What the chat knows]]):\n${about.notes.map((note) => `- ${note}`).join('\n')}`
      : 'Things they asked you to remember: nothing yet.'
  );
  return lines;
}
