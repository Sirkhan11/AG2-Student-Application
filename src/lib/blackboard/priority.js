// What each Blackboard module card shows first: its single most important thing, in this order:
// a deadline that's passed, a deadline within a week, a new announcement, new content, the next
// deadline, or nothing new. Also how dates are written. No browser or network here, so the checks
// can test it in Node.

const DAY = 86_400_000;
/** Deadlines this close count as "soon". */
export const SOON_DAYS = 7;

/**
 * @typedef {{ kind: 'past-due' | 'due-soon' | 'announcement' | 'content' | 'next' | 'nothing', title: string,
 *   date: string | null, task?: import('./shapes.js').Task }} TopThing
 */

/**
 * @param {import('./shapes.js').Module} module
 * @param {Set<string>} fresh the ids the student hasn't seen (seen.js)
 * @param {number} [now]
 * @returns {TopThing}
 */
export function topThing(module, fresh, now = Date.now()) {
  const due = (/** @type {import('./shapes.js').Task} */ task) => Date.parse(task.due);
  const passed = module.tasks.filter((task) => due(task) < now);
  if (passed.length) {
    const task = passed[passed.length - 1];
    return { kind: 'past-due', title: task.title, date: task.due, task };
  }
  const soon = module.tasks.find((task) => due(task) - now <= SOON_DAYS * DAY);
  if (soon) return { kind: 'due-soon', title: soon.title, date: soon.due, task: soon };
  const announcement = module.announcements.find((item) => fresh.has(item.id));
  if (announcement) return { kind: 'announcement', title: announcement.title, date: announcement.posted };
  const content = module.content.find((item) => fresh.has(item.id));
  if (content) return { kind: 'content', title: content.title, date: content.created };
  const next = module.tasks[0];
  if (next) return { kind: 'next', title: next.title, date: next.due, task: next };
  return { kind: 'nothing', title: 'Nothing new', date: null };
}

/** Midnight at the start of the day, in the student's time. @param {number} time */
const dayStart = (time) => new Date(new Date(time).toDateString()).getTime();

/**
 * When something is due, in words: "due today at 14:00", "due tomorrow at 09:00", "due Friday 20 Nov",
 * "was due yesterday", "was due 3 days ago".
 * @param {string} iso
 * @param {number} [now]
 */
export function dueText(iso, now = Date.now()) {
  const time = Date.parse(iso);
  const days = Math.round((dayStart(time) - dayStart(now)) / DAY);
  const clock = new Date(time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (time < now) return days === 0 ? `was due today at ${clock}` : days === -1 ? 'was due yesterday' : `was due ${-days} days ago`;
  if (days === 0) return `due today at ${clock}`;
  if (days === 1) return `due tomorrow at ${clock}`;
  return `due ${new Date(time).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`;
}

/** A date in words: "Friday 20 Nov, 14:00". @param {string} iso */
export const whenText = (iso) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A short "how long ago": "today", "yesterday", "3 days ago". @param {string} iso @param {number} [now] */
export function agoText(iso, now = Date.now()) {
  const days = Math.round((dayStart(now) - dayStart(Date.parse(iso))) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
