// Things a student chooses for the check-in chat to remember, for later chats: up to MAX_NOTES, each
// one short line (about-you.js). Gemini offers one as its reply's remember action (chat-prompt.js).
// The app shows a card with Remember and Not now, and only their tap saves it (chat-notes.js). Whatever Gemini writes, some things are never offered (screenNote):
// anything about their health, money, worries or safety, other people, or contact details. They can
// see and delete what's saved on the "What the chat knows about you" page. No Firebase here, so the
// checks can test it in Node.

import { MAX_NOTE_LENGTH, MAX_NOTES } from '#lib/checkin/about-you.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isCrisis } from '#lib/checkin/safety.js';

export { MAX_NOTE_LENGTH, MAX_NOTES };

/**
 * Topics the chat never offers to remember, whatever Gemini writes: a backstop to its instructions.
 * Erring on the side of not offering: a note it can't offer is just a card that doesn't appear.
 */
const NEVER = /** @type {const} */ ([
  ['health', /\b(health|ill\b|illness|sick|doctors?\b|gp\b|nurse|hospital|medic|medication|medicine|prescri|diagnos|therap|counsell|mental|depress|anxiety|adhd|autis|dyslex|disab|pregnan|allerg|injur|pain\b|asthma|diabet|epilep|eating disorder|condition\b)/i],
  ['money', /\b(money|debts?\b|loans?\b|overdraft|rent\b|bills?\b|afford|broke\b|budget|financ|bank|cost of living|benefits?\b|bursar|salary|wages?\b|income|savings?\b|hardship)/i],
  ['worries', /\b(worr|stress|anxious|lonely|homesick|sad\b|upset|scared|afraid|fear|panic|crying|struggl|overwhelm|nervous|miserable|unhappy|griev|grief)/i],
  ['safety', /\b(unsafe|safety|danger|abus|harass|assault|stalk|threat|violen|police|attack|bull(y|ied|ying)|self[- ]?harm|suicid)/i],
  ['other people', /\b(my|his|her|their)\s+(mum|mom|mother|dad|father|parents?|brother|sister|siblings?|friends?|flatmates?|housemates?|roommates?|boyfriend|girlfriend|partner|husband|wife|son|daughter|child|children|kids?|family|cousins?|aunt|uncle|gran|grandma|grandad|grandparents?|tutor|lecturer|landlord|colleagues?|boss)\b/i],
  ['contact details', /@\w|https?:\/\/|www\.|\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b|\b\d{1,4}\s+\w+\s+(street|st|road|rd|avenue|ave|lane|close|terrace|drive|way)\b/i]
]);

/** @typedef {'empty' | 'too long' | 'contact details' | 'health' | 'money' | 'worries' | 'safety' | 'other people'} ScreenReason */

/**
 * Why a note is never offered, or null if it can be: nothing in it, too long, contact details, or a
 * topic the chat never remembers.
 * @param {string} text
 * @returns {ScreenReason | null}
 */
export function screenNote(text) {
  const note = text.trim();
  if (!note) return 'empty';
  if (note.length > MAX_NOTE_LENGTH) return 'too long';
  if (blankContactDetails(note) !== note) return 'contact details';
  if (isCrisis(note)) return 'safety';
  for (const [reason, pattern] of NEVER) if (pattern.test(note)) return reason;
  return null;
}

/** A note as Gemini wrote it, tidied: one line, no [[ ]] or quotes around it, no full stop. @param {string} raw */
export const tidyNote = (raw) =>
  raw
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’.!?]+$/g, '')
    .trim();

/** Lower case, letters and numbers only, for spotting the same note twice. @param {string} note */
const simple = (note) => note.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A saved note: its words, and when it was saved (a Firestore Timestamp in the app).
 * @typedef {{ text: string, savedAt: any }} SavedNote
 */

/**
 * The list with this note added at the end, or why it isn't: it's already there ('exists'), there's
 * no room ('full'), or it's never remembered (screenNote's reason). chat-notes.js saves the list.
 * @param {SavedNote[]} notes
 * @param {string} text
 * @param {any} savedAt
 * @returns {{ notes: SavedNote[] } | { refused: 'exists' | 'full' | ScreenReason }}
 */
export function withNote(notes, text, savedAt) {
  const note = tidyNote(text);
  const reason = screenNote(note);
  if (reason) return { refused: reason };
  if (notes.some((saved) => simple(saved.text) === simple(note))) return { refused: 'exists' };
  if (notes.length >= MAX_NOTES) return { refused: 'full' };
  return { notes: [...notes, { text: note, savedAt }] };
}

/**
 * The list without one note (matched by its words and when it was saved, so two tabs can't delete
 * the wrong one).
 * @param {SavedNote[]} notes
 * @param {SavedNote} note
 * @param {(a: any, b: any) => boolean} [sameTime] how to compare savedAt (Timestamps have isEqual)
 */
export function withoutNote(notes, note, sameTime = (a, b) => (a?.isEqual ? a.isEqual(b) : a === b)) {
  return notes.filter((saved) => !(saved.text === note.text && sameTime(saved.savedAt, note.savedAt)));
}
