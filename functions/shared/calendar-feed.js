// Reads the calendar file (.ics) Blackboard serves at a student's calendar link, and keeps only what
// the app shows: each item's title and when it's due. Blackboard's file (seen on 18 November 2026):
// standard VEVENT blocks with SUMMARY, DTSTART (every one with TZID=Europe/London), DTEND equal to the
// start, DTSTAMP and UID; a year back and a year ahead; no module, link, place or category. Nothing
// else in the file is kept, and nothing here is logged. Lines are unfolded, escaped commas and
// semicolons restored, and London times turned into instants on both sides of a clock change. Only
// the function reads calendars (the browser never sees the file), but there's no Node-only code here
// either, so check-deadlines.mjs can test it on made-up files.

/** How much of a calendar file the function will read: Thomas's 40 items were 16 KB, so this is ample. */
export const MAX_FEED_BYTES = 512 * 1024;
/** Deadlines from this many days back are kept, so one just missed still shows (as "was due"). */
export const PAST_DAYS = 7;
/** At most this many, soonest first. */
export const MAX_DEADLINES = 60;
/** Blackboard's calendars are in London time; a file with no time zone is read the same way. */
export const DEFAULT_TIME_ZONE = 'Europe/London';
const DAY = 86_400_000;

/**
 * One deadline as the app shows it: a short id (for lists and calendar entries, derived from
 * Blackboard's UID and not reversible), the title, when it's due (UTC) and whether it was given as a
 * date with no time.
 * @typedef {{ id: string, title: string, at: string, allDay?: true }} Deadline
 */

/** Thrown for a file that isn't a calendar; the function turns it into an answer for the app. */
export class FeedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'FeedError';
  }
}

/** True when the text begins as a calendar file does (a byte-order mark and blank lines allowed). @param {string} text */
export const looksLikeCalendar = (text) => /^﻿?\s*BEGIN:VCALENDAR(\r?\n|$)/.test(text);

/**
 * The file's content lines, unfolded: a line that starts with a space or tab continues the one before
 * (RFC 5545 folds lines at 75 bytes).
 * @param {string} text
 */
const linesOf = (text) => text.replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);

/** A value's escapes undone: \n, \, \; and \\. @param {string} value */
const unescapeValue = (value) => value.replace(/\\n/gi, '\n').replace(/\\([\\;,])/g, '$1');

/**
 * A content line taken apart: "DTSTART;TZID=Europe/London:20261120T140000" is the name DTSTART, the
 * parameter TZID and the value. A quoted parameter may hold a colon.
 * @param {string} line
 * @returns {{ name: string, params: Record<string, string>, value: string } | null}
 */
function parseLine(line) {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  /** @type {Record<string, string>} */
  const params = {};
  for (const param of rawParams) {
    const equals = param.indexOf('=');
    if (equals > 0) params[param.slice(0, equals).toUpperCase()] = param.slice(equals + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/**
 * The time zone's offset from UTC at an instant, in milliseconds (an hour in British Summer Time,
 * none in winter), from how Intl writes that instant in the zone.
 * @param {number} utcMillis
 * @param {string} timeZone
 */
function offsetAt(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMillis));
  const get = (/** @type {string} */ type) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) - utcMillis;
}

/**
 * A wall-clock time in a zone as an instant (milliseconds since the epoch). Right on both sides of a
 * clock change: the offset is read at a first guess, then again at the answer, which settles it. (For
 * the one hour a year that doesn't exist, or exists twice, either reading is fair.)
 * @param {{ year: number, month: number, day: number, hour: number, minute: number, second: number }} wall
 * @param {string} timeZone
 */
export function zonedToUtc({ year, month, day, hour, minute, second }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** Whether Intl knows this zone (Blackboard says Europe/London; anything odd is read as that). @param {string} timeZone */
function knownZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A DTSTART (or DTEND) as an instant: "20261120T140000Z" (UTC), "20261120T140000" with TZID or
 * floating (London), or "20261120" (a date only, read as the start of that day in London).
 * @param {{ params: Record<string, string>, value: string }} line
 * @returns {{ at: number, allDay: boolean } | null}
 */
export function instantFrom({ params, value }) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const wall = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h ?? 0), minute: Number(mi ?? 0), second: Number(s ?? 0) };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 || wall.hour > 23 || wall.minute > 59 || wall.second > 60) return null;
  const allDay = h === undefined || params.VALUE === 'DATE';
  if (z) return { at: Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second), allDay };
  const zone = params.TZID && knownZone(params.TZID) ? params.TZID : DEFAULT_TIME_ZONE;
  return { at: zonedToUtc(wall, zone), allDay };
}

/**
 * A short, stable id for a deadline from Blackboard's UID (FNV-1a, in hex): enough to key a list and
 * name a calendar entry, and not Blackboard's own identifier.
 * @param {string} text
 */
export function shortId(text) {
  let hash = 0x811c9dc5;
  for (const char of new TextEncoder().encode(text)) {
    hash ^= char;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `d-${hash.toString(16).padStart(8, '0')}`;
}

/** A title as the app shows it: escapes undone, whitespace tidied, and not endless. @param {string} raw */
const tidyTitle = (raw) => unescapeValue(raw).replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * The deadlines in a calendar file: from a week ago onwards, soonest first, at most MAX_DEADLINES.
 * Items with no title or no usable start are left out. Throws a FeedError for text that isn't a
 * calendar file.
 * @param {string} text the file
 * @param {number} [now]
 * @returns {Deadline[]}
 */
export function deadlinesFrom(text, now = Date.now()) {
  if (!looksLikeCalendar(text)) throw new FeedError('not a calendar file');
  const from = now - PAST_DAYS * DAY;
  /** @type {Map<string, Deadline & { millis: number }>} */
  const found = new Map();
  /** @type {{ summary?: string, start?: { at: number, allDay: boolean }, uid?: string } | null} */
  let event = null;
  for (const line of linesOf(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, value } = parsed;
    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') {
      event = {};
    } else if (name === 'END' && value.trim().toUpperCase() === 'VEVENT') {
      if (event?.summary && event.start && event.start.at >= from) {
        const key = event.uid?.trim() || `${event.summary}@${event.start.at}`;
        const id = shortId(key);
        if (!found.has(id)) found.set(id, { id, title: event.summary, at: new Date(event.start.at).toISOString(), ...(event.start.allDay ? { allDay: true } : {}), millis: event.start.at });
      }
      event = null;
    } else if (event) {
      if (name === 'SUMMARY') event.summary = tidyTitle(value) || undefined;
      else if (name === 'DTSTART') event.start = instantFrom(parsed) ?? undefined;
      else if (name === 'UID') event.uid = value;
    }
  }
  return [...found.values()]
    .sort((a, b) => a.millis - b.millis || a.title.localeCompare(b.title))
    .slice(0, MAX_DEADLINES)
    .map(({ millis, ...deadline }) => deadline);
}
