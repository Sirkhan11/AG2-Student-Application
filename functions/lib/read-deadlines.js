// What the function does once a caller is let in: takes the calendar link from the request, fetches
// that one address and nothing else, and hands back the deadlines in it. The link comes in the body of
// the request (never in an address, so it's in no request log), is used for the one fetch, and is in
// nothing this returns or throws: every message below is the same whatever the link was.
// The fetch is as narrow as it can be: only a link of exactly Blackboard's shape (calendar-link.js),
// so only https://elp.northumbria.ac.uk; no redirects followed; a time limit; a size limit; and only a
// calendar file is read. In the emulator, and only there, the same path is fetched from a pretend
// Blackboard on this machine instead (functions/.env.demo-ag2), so the checks can run with no network.
// No Firebase here: index.js wires this to the callable, and check-deadlines.mjs tests it in Node with
// a stand-in fetch.

import { calendarLinkFrom } from '../shared/calendar-link.js';
import { deadlinesFrom, FeedError, looksLikeCalendar, MAX_FEED_BYTES } from '../shared/calendar-feed.js';

/** How long to wait for Blackboard. */
export const FETCH_TIMEOUT_MS = 8000;

/**
 * Why a read failed, with the code the callable answers with (the app turns each into words) and a
 * message that says nothing about the link.
 * @typedef {'invalid-argument' | 'not-found' | 'unavailable' | 'failed-precondition' | 'resource-exhausted'} ReadCode
 */
export class ReadError extends Error {
  /** @param {ReadCode} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ReadError';
    this.code = code;
  }
}

/**
 * Where to fetch: the link itself, or, in the emulator with a pretend Blackboard set, the pretend
 * Blackboard with the link's path. Outside the emulator the pretend origin is ignored, whatever is in
 * the environment, so nothing can point the live function anywhere but Blackboard.
 * @param {string} link a link calendarLinkFrom accepted
 * @param {{ emulator?: boolean, pretendOrigin?: string }} [where]
 */
export function fetchAddress(link, { emulator = false, pretendOrigin = '' } = {}) {
  if (emulator && pretendOrigin) return `${pretendOrigin.replace(/\/$/, '')}${new URL(link).pathname}`;
  return link;
}

/**
 * Reads the body up to a limit, as text. Over the limit, the read stops and a ReadError is thrown
 * (a calendar is never that big).
 * @param {Response} response
 * @param {number} limit bytes
 */
async function textUpTo(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit) throw tooBig();
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > limit) throw tooBig();
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const tooBig = () => new ReadError('resource-exhausted', 'That calendar is too big for the app to read.');

/**
 * The deadlines at a student's calendar link.
 * @param {unknown} data what the app sent: { link }
 * @param {{ fetch?: typeof fetch, emulator?: boolean, pretendOrigin?: string, now?: number, timeoutMs?: number }} [options]
 *   fetch and now can be stood in for by the checks; emulator and pretendOrigin as fetchAddress takes them
 * @returns {Promise<{ deadlines: import('../shared/calendar-feed.js').Deadline[], readAt: string }>}
 */
export async function readDeadlinesFor(data, { fetch: doFetch = fetch, emulator = false, pretendOrigin = '', now = Date.now(), timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const link = calendarLinkFrom(/** @type {{ link?: unknown } | null | undefined} */ (data)?.link);
  if (!link) throw new ReadError('invalid-argument', 'That isn’t a Blackboard calendar link.');

  let response;
  try {
    response = await doFetch(fetchAddress(link, { emulator, pretendOrigin }), {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'text/calendar' }
    });
  } catch {
    // Blackboard not answering in time, or answering with a redirect (which isn't followed).
    throw new ReadError('unavailable', 'Blackboard isn’t answering just now.');
  }
  if (response.status === 404 || response.status === 403 || response.status === 401 || response.status === 410) {
    throw new ReadError('not-found', 'Blackboard doesn’t know that link.');
  }
  if (!response.ok) throw new ReadError('unavailable', 'Blackboard isn’t answering just now.');
  if (!/^text\/calendar\b/i.test(response.headers.get('content-type') ?? '')) {
    throw new ReadError('failed-precondition', 'What came back from Blackboard isn’t a calendar.');
  }
  const text = await textUpTo(response, MAX_FEED_BYTES);
  if (!looksLikeCalendar(text)) throw new ReadError('failed-precondition', 'What came back from Blackboard isn’t a calendar.');
  try {
    return { deadlines: deadlinesFrom(text, now), readAt: new Date(now).toISOString() };
  } catch (err) {
    if (err instanceof FeedError) throw new ReadError('failed-precondition', 'What came back from Blackboard isn’t a calendar.');
    throw err;
  }
}
