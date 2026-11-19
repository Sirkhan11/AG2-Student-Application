// How deadlines are shown: which are still to come, when each is due in words, how long ago they were
// read, and each as a calendar entry for "Add to calendar" (made on the phone by calendar/ics.js and
// outlook.js: nothing goes anywhere). No browser or network here, so check-deadlines.mjs can test it
// in Node.

/** @typedef {import('#shared/calendar-feed.js').Deadline} Deadline */
/** @typedef {import('#lib/calendar/ics.js').CalendarEntry} CalendarEntry */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HALF_HOUR = 30 * MINUTE;

/** Midnight at the start of the day, in the student's time. @param {number} time */
const dayStart = (time) => new Date(new Date(time).toDateString()).getTime();

/**
 * The deadlines still to come (soonest first) and the ones that have passed (most recent first).
 * @param {Deadline[]} deadlines
 * @param {number} [now]
 */
export function splitDeadlines(deadlines, now = Date.now()) {
  const sorted = [...deadlines].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    coming: sorted.filter((deadline) => Date.parse(deadline.at) >= now),
    passed: sorted.filter((deadline) => Date.parse(deadline.at) < now).reverse()
  };
}

/** The ones still to come, soonest first. @param {Deadline[]} deadlines @param {number} [now] */
export const comingDeadlines = (deadlines, now = Date.now()) => splitDeadlines(deadlines, now).coming;

/**
 * When it's due, in words: "due today at 14:00", "due tomorrow at 09:00", "due Friday 20 Nov",
 * "was due yesterday", "was due 3 days ago". A deadline given as a date only has no time.
 * @param {Deadline} deadline
 * @param {number} [now]
 */
export function dueWords(deadline, now = Date.now()) {
  const time = Date.parse(deadline.at);
  const days = Math.round((dayStart(time) - dayStart(now)) / DAY);
  const clock = deadline.allDay ? '' : ` at ${new Date(time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  if (time < now && !(deadline.allDay && days === 0)) {
    return days === 0 ? `was due today${clock}` : days === -1 ? 'was due yesterday' : `was due ${-days} days ago`;
  }
  if (days === 0) return `due today${clock}`;
  if (days === 1) return `due tomorrow${clock}`;
  return `due ${new Date(time).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`;
}

/**
 * How long ago the deadlines were read: "just now", "20 minutes ago", "3 hours ago", "yesterday".
 * @param {string} iso
 * @param {number} [now]
 */
export function readAgo(iso, now = Date.now()) {
  const ago = now - Date.parse(iso);
  if (ago < 2 * MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.round(ago / MINUTE)} minutes ago`;
  if (ago < DAY) {
    const hours = Math.round(ago / HOUR);
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  const days = Math.round((dayStart(now) - dayStart(Date.parse(iso))) / DAY);
  return days <= 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * A deadline as a calendar entry: the half hour before it's due (a date-only one: that day from 9).
 * @param {Deadline} deadline
 * @returns {CalendarEntry}
 */
export function calendarEntryFor(deadline) {
  const due = Date.parse(deadline.at);
  const end = deadline.allDay ? due + 9 * HOUR + HALF_HOUR : due;
  return {
    id: `deadline-${deadline.id}`,
    title: `Due: ${deadline.title}`,
    start: end - HALF_HOUR,
    end,
    description: 'From your Blackboard calendar, through AG2. Check Blackboard for the details.'
  };
}
