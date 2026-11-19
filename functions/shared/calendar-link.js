// The private link Blackboard gives each student to their own calendar (in Blackboard: Calendar, the
// cog, the three dots, Share calendar, Copy). Its shape, exactly as Northumbria's Blackboard makes it:
// https://elp.northumbria.ac.uk/webapps/calendar/calendarFeed/<32 lowercase hex characters>/learn.ics,
// with no query and no fragment. The link is a key: anyone holding it can read that calendar with no
// login. So the app keeps it on the phone and nowhere else (src/lib/deadlines/store.js), and the
// function fetches it once per refresh and forgets it (functions/lib/read-deadlines.js). Both refuse
// anything of another shape here, which is also what stops the function being pointed at any other
// address. Shared by the app and the function (functions/shared); no Firebase and no network, so the
// checks can test it in Node.

export const CALENDAR_LINK_HOST = 'elp.northumbria.ac.uk';
export const CALENDAR_LINK_PREFIX = `https://${CALENDAR_LINK_HOST}/webapps/calendar/calendarFeed/`;
export const CALENDAR_LINK_SUFFIX = '/learn.ics';

/** The whole link, anchored at both ends: nothing before, after or inside it that isn't in Blackboard's. */
const SHAPE = /^https:\/\/elp\.northumbria\.ac\.uk\/webapps\/calendar\/calendarFeed\/([0-9a-f]{32})\/learn\.ics$/;

/**
 * The link, trimmed, when it has exactly the right shape; otherwise null.
 * @param {unknown} text what was pasted (or sent)
 * @returns {string | null}
 */
export function calendarLinkFrom(text) {
  if (typeof text !== 'string') return null;
  const link = text.trim();
  if (!SHAPE.test(link)) return null;
  // A second opinion from the URL parser: it must read the same host and nothing else (no user name,
  // query or fragment). The shape above already says so, but this costs nothing.
  try {
    const url = new URL(link);
    if (url.href !== link || url.host !== CALENDAR_LINK_HOST || url.username || url.password || url.search || url.hash) return null;
  } catch {
    return null;
  }
  return link;
}

/** @param {unknown} text */
export const isCalendarLink = (text) => calendarLinkFrom(text) !== null;

/**
 * The 32-character id inside a link. Never shown or logged by the app: the checks use it to make sure
 * the link went nowhere it shouldn't.
 * @param {string} link
 */
export const calendarLinkId = (link) => SHAPE.exec(link.trim())?.[1] ?? null;

/**
 * What's wrong with what was pasted, in words for the student, or null when it's the link.
 * @param {unknown} text
 * @returns {string | null}
 */
export function calendarLinkProblem(text) {
  const typed = typeof text === 'string' ? text.trim() : '';
  if (!typed) return 'Paste the link first.';
  if (calendarLinkFrom(typed)) return null;
  if (!/^https?:\/\//i.test(typed)) return 'That doesn’t look like a link: it should start with https://elp.northumbria.ac.uk/';
  if (!typed.toLowerCase().includes('elp.northumbria.ac.uk/webapps/calendar/calendarfeed/')) {
    return 'That’s a link, but not your Blackboard calendar link. In Blackboard, open Calendar, then the cog, the three dots, Share calendar, and Copy.';
  }
  return 'That’s nearly it, but not quite what Blackboard copies: the link starts https://elp.northumbria.ac.uk/webapps/calendar/calendarFeed/, then 32 letters and numbers, then /learn.ics, with nothing after. Copy it again from Blackboard.';
}
