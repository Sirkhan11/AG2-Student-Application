import { BlackboardError } from './client.js';

// Reads what the Blackboard section shows, as the student, and keeps only that: this term's modules,
// each with its deadlines, calendar events, released content and announcements. It never asks for
// grades or attempts, class lists or anything about other students, asks Learn for only the fields it
// uses, and drops anything else (scores, who wrote an announcement) before it reaches the browser.
// Server only.

const DAY = 86_400_000;
/** Calendar items from this many days ago, so overdue deadlines still show. */
const DAYS_BACK = 7;
/** And this many weeks ahead: Learn allows at most 16 weeks between since and until. */
const WEEKS_AHEAD = 15;
/** How many modules are read at once, to go easy on Blackboard. */
const AT_ONCE = 2;
/** Announcements are cut to this many characters; the full text is on Blackboard. */
const ANNOUNCEMENT_LENGTH = 280;

/** @typedef {import('#lib/blackboard/shapes.js').Module} Module */

/**
 * True if a Learn availability duration includes now: a date range that's running, or no dates.
 * @param {{ type?: string, start?: string, end?: string } | undefined} duration
 * @param {number} now
 */
function running(duration, now) {
  if (!duration || duration.type !== 'DateRange') return true;
  if (duration.start && Date.parse(duration.start) > now) return false;
  if (duration.end && Date.parse(duration.end) < now) return false;
  return true;
}

/** Plain text from an announcement's HTML. @param {string} html */
export function plainText(html) {
  const text = String(html ?? '')
    // Line and block breaks become spaces; inline tags (such as <strong>) just go.
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > ANNOUNCEMENT_LENGTH ? `${text.slice(0, ANNOUNCEMENT_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Runs the work for each item, a few at a time.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
async function fewAtOnce(items, work) {
  /** @type {R[]} */
  const results = [];
  for (let i = 0; i < items.length; i += AT_ONCE) results.push(...(await Promise.all(items.slice(i, i + AT_ONCE).map(work))));
  return results;
}

/**
 * This term's modules, with what the section shows. Throws BlackboardError "expired" if the token
 * needs refreshing, and "unavailable" if Blackboard isn't answering; a part a module won't show the
 * student (such as a hidden gradebook) is left out and named in partial.
 * @param {import('./client.js').BlackboardClient} client
 * @param {string} accessToken
 * @param {string} userId the user_id Learn gave with the token
 * @param {{ now?: number, linkHost: string, apiHost: string }} options linkHost is where links send the
 *   student (apiHost in links Learn sends is swapped for it; they're the same apart from the mock)
 * @returns {Promise<Module[]>}
 */
export async function readModules(client, accessToken, userId, { now = Date.now(), linkHost, apiHost }) {
  const user = /^[0-9a-f]{32}$/i.test(userId) ? `uuid:${userId}` : userId;
  /** A link the student can open, or null. @param {string | undefined} href */
  const link = (href) => {
    if (!href) return null;
    const absolute = href.startsWith('/') ? `${linkHost}${href}` : href.replace(apiHost, linkHost);
    return absolute.startsWith(linkHost) ? absolute : null;
  };

  const memberships = await client.list(`/v1/users/${encodeURIComponent(user)}/courses`, accessToken, {
    expand: 'course',
    fields: 'courseId,availability.available,course.id,course.courseId,course.name,course.termId,course.organization,course.availability,course.externalAccessUrl'
  });

  /** @type {Map<string, any>} */
  const terms = new Map();
  /** @param {string} termId */
  async function term(termId) {
    if (!terms.has(termId)) {
      terms.set(termId, await client.one(`/v1/terms/${encodeURIComponent(termId)}`, accessToken, { fields: 'id,name,availability' }).catch((err) => {
        if (err instanceof BlackboardError && (err.kind === 'forbidden' || err.kind === 'not-found')) return null;
        throw err;
      }));
    }
    return terms.get(termId);
  }

  const courses = [];
  for (const membership of memberships) {
    const course = membership.course;
    if (!course || course.organization || membership.availability?.available !== 'Yes') continue;
    const available = course.availability?.available;
    if (available !== 'Yes' && available !== 'Term') continue;
    if (course.termId) {
      const found = await term(course.termId);
      if (found && (found.availability?.available === 'No' || !running(found.availability?.duration, now))) continue;
    } else if (!running(course.availability?.duration, now)) continue;
    courses.push(course);
  }

  // The calendar, once for all modules: course events and gradebook due dates only (not the student's
  // personal entries or university-wide ones).
  const calendar = (await client.list('/v1/calendars/items', accessToken, {
    since: new Date(now - DAYS_BACK * DAY).toISOString(),
    until: new Date(now + WEEKS_AHEAD * 7 * DAY).toISOString(),
    fields: 'id,type,calendarId,title,start,end'
  })).filter((item) => item.type === 'Course' || item.type === 'GradebookColumn');

  return fewAtOnce(courses, async (course) => {
    /** @type {Module['partial']} */
    const partial = [];
    /** @template T @param {Promise<T[]>} request @param {Module['partial'][number]} part */
    const orNone = (request, part) =>
      request.catch((err) => {
        if (err instanceof BlackboardError && (err.kind === 'forbidden' || err.kind === 'not-found')) {
          partial.push(part);
          return /** @type {T[]} */ ([]);
        }
        throw err;
      });
    const [contents, columns, announcements] = await Promise.all([
      orNone(client.list(`/v1/courses/${course.id}/contents`, accessToken, { recursive: 'true', fields: 'id,title,created,contentHandler.id,links' }), 'content'),
      orNone(client.list(`/v2/courses/${course.id}/gradebook/columns`, accessToken, { fields: 'id,name,displayName,contentId,grading.due,availability.available' }), 'tasks'),
      orNone(client.list(`/v1/courses/${course.id}/announcements`, accessToken, { fields: 'id,title,body,created,modified,availability' }), 'announcements')
    ]);

    const contentById = new Map(contents.map((item) => [item.id, item]));
    /** @type {Module['tasks']} */
    const tasks = columns
      .filter((column) => column.grading?.due && column.availability?.available !== 'No')
      .map((column) => {
        const item = column.contentId ? contentById.get(column.contentId) : null;
        return { id: column.id, title: column.displayName || column.name, due: column.grading.due, url: link(item?.links?.find((/** @type {any} */ l) => l.rel === 'alternate')?.href) };
      });
    // Calendar due dates for columns the gradebook didn't list (for example when it's hidden).
    for (const item of calendar) {
      if (item.calendarId !== course.id || item.type !== 'GradebookColumn' || tasks.some((task) => task.id === item.id)) continue;
      tasks.push({ id: item.id, title: item.title, due: item.end ?? item.start, url: null });
    }
    tasks.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));

    return {
      id: course.id,
      code: course.courseId,
      name: course.name,
      url: link(course.externalAccessUrl),
      tasks,
      events: calendar
        .filter((item) => item.calendarId === course.id && item.type === 'Course')
        .map((item) => ({ id: item.id, title: item.title, start: item.start, end: item.end ?? null }))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
      content: contents
        .filter((item) => item.title && item.created)
        .map((item) => ({
          id: item.id,
          title: item.title,
          created: item.created,
          kind: /** @type {'folder' | 'item'} */ (item.contentHandler?.id === 'resource/x-bb-folder' ? 'folder' : 'item'),
          url: link(item.links?.find((/** @type {any} */ l) => l.rel === 'alternate')?.href)
        }))
        .sort((a, b) => Date.parse(b.created) - Date.parse(a.created)),
      announcements: announcements
        .filter((item) => item.title && item.availability?.available !== 'No')
        .map((item) => ({ id: item.id, title: item.title, text: plainText(item.body), posted: item.modified ?? item.created }))
        .sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted)),
      partial
    };
  });
}
