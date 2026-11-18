// A calendar file (.ics) for one item, made on the phone: a Blackboard deadline or event (the
// checklist's Blackboard section, blackboard/ics.js), or something a student asked the check-in chat
// to put in their calendar. Outlook, and any other calendar app, opens it; no Microsoft account
// permissions are needed. Each one reminds the student the day before. No network here, and nothing
// from Blackboard: the chat uses this too, so it lives apart from the Blackboard code.

/** "20261120T140000Z" @param {number | string} time */
const utc = (time) => new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Text with the characters the calendar format reserves escaped. @param {string} text */
const escape = (text) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A text's length in bytes (UTF-8), in the browser or Node. @param {string} text */
const byteLength = (text) => new TextEncoder().encode(text).length;

/**
 * Splits a line longer than 75 bytes, as the calendar format asks (a new line, then a space).
 * @param {string} line
 */
function fold(line) {
  if (byteLength(line) <= 75) return line;
  const parts = [];
  let current = '';
  for (const char of line) {
    if (byteLength(current + char) > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
    }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * @typedef {{ id: string, title: string, start: string | number, end: string | number, description?: string, url?: string | null }} CalendarEntry
 */

/**
 * The .ics file's text for one entry.
 * @param {CalendarEntry} entry
 * @param {number} [now]
 */
export function icsFor(entry, now = Date.now()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AG2 Student App//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${entry.id}@ag2-student-app`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(entry.start)}`,
    `DTEND:${utc(entry.end)}`,
    `SUMMARY:${escape(entry.title)}`,
    ...(entry.description ? [`DESCRIPTION:${escape(entry.description)}`] : []),
    ...(entry.url ? [`URL:${entry.url}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(entry.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/**
 * Saves the entry as a .ics file on the phone, which opens it in the calendar app. Browser only.
 * @param {CalendarEntry} entry
 */
export function downloadIcs(entry) {
  const file = new Blob([icsFor(entry)], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `${entry.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'ag2-date'}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
