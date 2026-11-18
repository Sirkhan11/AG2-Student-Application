import { httpsCallable } from 'firebase/functions';
import { startAppCheck } from '#lib/firebase/app-check.js';
import { getFirebaseFunctions } from '#lib/firebase/client.js';
import { calendarLinkProblem } from '#shared/calendar-link.js';
import { forgetDeadlines, keepDeadlines, keepLink, readKept } from '#lib/deadlines/store.js';

// A student's deadlines, from the private link to their Blackboard calendar: connecting (the link's
// shape is checked on the phone, then read once, so a wrong link is found out straight away),
// loading (what's kept on the phone, refreshed through the app's one function when it's more than
// four hours old, which is how often Blackboard itself says to re-read the calendar), and forgetting.
// The link goes to the function in the body of one request, with the sign-in and App Check tokens
// Firebase puts on it, and nowhere else: not in an address, not to Firestore, not to Gemini, and not
// in any message here (the console sees a code, never a link). Browser only; store.js holds what's
// kept, and functions/ is the other end.

/** @typedef {import('#shared/calendar-feed.js').Deadline} Deadline */
/**
 * What the pages show: not connected, or the deadlines (with when they were read, and what went
 * wrong if the last refresh failed and these are from the time before).
 * @typedef {{ state: 'not-connected' } | { state: 'ready', deadlines: Deadline[], readAt: string | null, problem: string | null }} DeadlinesView
 */

/** The function's name (functions/index.js). */
export const FUNCTION_NAME = 'readDeadlines';
/** Deadlines older than this are read again: Blackboard's own calendar says four hours (X-PUBLISHED-TTL:PT4H). */
export const REFRESH_AFTER_MS = 4 * 60 * 60 * 1000;

/** A problem in the student's words (what the page shows). */
export class DeadlinesError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DeadlinesError';
  }
}

const TRY_LATER = 'Blackboard isn’t answering just now. Try again in a minute.';
const SOMETHING_WRONG = 'We couldn’t read your deadlines just now. Try again in a minute.';
/** What each answer from the function means, in words. */
const WORDS = /** @type {Record<string, string>} */ ({
  'functions/unauthenticated': 'Log in again to see your deadlines.',
  'functions/permission-denied': 'Your account can’t use this yet: your email address has to be verified first.',
  'functions/invalid-argument': 'That isn’t a Blackboard calendar link.',
  'functions/not-found': 'Blackboard doesn’t know that link any more. Copy it again from Blackboard.',
  'functions/failed-precondition': 'Blackboard didn’t give a calendar for that link. Copy it again from Blackboard.',
  'functions/resource-exhausted': 'Your Blackboard calendar is too big for the app to read.',
  'functions/unavailable': TRY_LATER,
  'functions/deadline-exceeded': TRY_LATER
});

/** @param {unknown} err what httpsCallable threw */
function wordsFor(err) {
  const { code, details } = /** @type {{ code?: string, details?: { about?: string } }} */ (err ?? {});
  // A not-found about the link comes with that detail; without it, it's the function that isn't there
  // (not deployed yet).
  if (code === 'functions/not-found' && details?.about !== 'calendar') return 'The deadlines service isn’t switched on yet.';
  return (code && WORDS[code]) ?? SOMETHING_WRONG;
}

/**
 * What the function gave, checked for shape (titles and times, nothing else kept).
 * @param {unknown} data
 * @returns {{ deadlines: Deadline[], readAt: string }}
 */
function tidy(data) {
  const given = /** @type {{ deadlines?: unknown, readAt?: unknown }} */ (data ?? {});
  const deadlines = Array.isArray(given.deadlines)
    ? given.deadlines
      .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.at === 'string')
      .map((item) => ({ id: item.id, title: item.title, at: item.at, ...(item.allDay === true ? { allDay: /** @type {true} */ (true) } : {}) }))
    : [];
  return { deadlines, readAt: typeof given.readAt === 'string' ? given.readAt : new Date().toISOString() };
}

/**
 * Reads the deadlines at a link, once, through the function. Throws a DeadlinesError with words for
 * the student if it can't.
 * @param {string} link
 */
export async function fetchDeadlines(link) {
  startAppCheck();
  const call = httpsCallable(getFirebaseFunctions(), FUNCTION_NAME);
  try {
    const { data } = await call({ link });
    return tidy(data);
  } catch (err) {
    console.error('Reading deadlines failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
    throw new DeadlinesError(wordsFor(err));
  }
}

/**
 * Connects: checks the pasted link's shape here, reads it once (so a link Blackboard doesn't know is
 * found out now), then keeps both on the phone.
 * @param {string} uid the signed-in student
 * @param {string} pasted
 */
export async function connectDeadlines(uid, pasted) {
  const problem = calendarLinkProblem(pasted);
  if (problem) throw new DeadlinesError(problem);
  const link = pasted.trim();
  const read = await fetchDeadlines(link);
  if (!keepLink(uid, link)) {
    throw new DeadlinesError('Your browser isn’t letting the app keep anything on this phone (private windows do this), so the link can’t be saved.');
  }
  keepDeadlines(uid, read);
  return read;
}

/**
 * The student's deadlines for a page: what's kept, read again through the function when it's more
 * than four hours old or a refresh is asked for. If the read fails, what was kept is shown with the
 * problem, rather than nothing.
 * @param {string} uid
 * @param {{ refresh?: boolean, now?: number }} [options]
 * @returns {Promise<DeadlinesView>}
 */
export async function loadDeadlines(uid, { refresh = false, now = Date.now() } = {}) {
  const kept = readKept(uid);
  if (!kept) return { state: 'not-connected' };
  const stale = kept.readAt === null || now - Date.parse(kept.readAt) > REFRESH_AFTER_MS;
  if (!refresh && !stale) return { state: 'ready', deadlines: kept.deadlines, readAt: kept.readAt, problem: null };
  try {
    const read = await fetchDeadlines(kept.link);
    keepDeadlines(uid, read);
    return { state: 'ready', deadlines: read.deadlines, readAt: read.readAt, problem: null };
  } catch (err) {
    return { state: 'ready', deadlines: kept.deadlines, readAt: kept.readAt, problem: err instanceof DeadlinesError ? err.message : SOMETHING_WRONG };
  }
}

/** Forgets the link and the deadlines on this phone. @param {string} uid */
export const disconnectDeadlines = (uid) => forgetDeadlines(uid);
