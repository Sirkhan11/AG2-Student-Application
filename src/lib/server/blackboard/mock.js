import { createHash, randomBytes } from 'node:crypto';

// A pretend Blackboard Learn, for building and demonstrating the Blackboard section until Northumbria
// IT registers the app. mockFetch answers the same paths with the same response shapes as Learn
// 4001.4.0, so client.js and read.js run unchanged; approve() and deny() are what its pretend
// "Allow" page does. Everything here is made up: modules, staff, dates. It lives in the server's
// memory, so connections end when the server restarts. Server only.
//
// It includes what the real one might send that the app must handle or drop: a past term's module, a
// hidden module and an organisation (all left out), a module whose gradebook is hidden from students
// (its due dates come from the calendar), a gradebook total with no due date, calendar duplicates
// and personal entries, content in two pages, scores and announcement authors (never passed on).

/** Never resolved: requests to it go to mockFetch, inside the server. */
export const MOCK_HOST = 'https://blackboard.mock';
export const MOCK_APP_KEY = 'mock-app-key';
export const MOCK_APP_SECRET = 'mock-app-secret';
/** The pretend student's Learn user id (a UUID, as Learn's token response gives). */
export const MOCK_USER_ID = '5d8f0c2a9e4b4f1c8a7d6e5f4c3b2a10';

/** What the pretend Allow page offers, to try each case. */
export const MOCK_SCENARIOS = {
  normal: 'Four modules this term (the usual case)',
  'no-modules': 'No modules this term',
  expired: 'The access token has expired (the app should refresh it)',
  revoked: 'The connection was removed in Blackboard (the app should ask to reconnect)',
  down: 'Blackboard is down (it answers 503)',
  slow: 'Blackboard is too slow to answer'
};

const DAY = 86_400_000;
/** @type {Map<string, { redirectUri: string, challenge: string, scenario: string }>} */
const codes = new Map();
/** @type {Map<string, { scenario: string, fresh: boolean }>} */
const accessTokens = new Map();
/** @type {Map<string, { scenario: string }>} */
const refreshTokens = new Map();

const random = () => randomBytes(12).toString('hex');

/**
 * The pretend Allow page's "Allow": a one-time code for the app's callback.
 * @param {{ clientId: string | null, redirectUri: string, state: string | null, codeChallenge: string | null, method: string | null, scenario: string }} request
 * @returns {string} where to send the browser
 */
export function approve({ clientId, redirectUri, state, codeChallenge, method, scenario }) {
  if (clientId !== MOCK_APP_KEY) throw new Error('Unknown app');
  if (method !== 'S256' || !codeChallenge) throw new Error('PKCE (S256) is needed');
  const code = `mock-code-${random()}`;
  codes.set(code, { redirectUri, challenge: codeChallenge, scenario: Object.hasOwn(MOCK_SCENARIOS, scenario) ? scenario : 'normal' });
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  if (state) back.searchParams.set('state', state);
  return back.href;
}

/**
 * The pretend Allow page's "Deny", as Learn reports it.
 * @param {{ redirectUri: string, state: string | null }} request
 */
export function deny({ redirectUri, state }) {
  const back = new URL(redirectUri);
  back.searchParams.set('error', 'access_denied');
  if (state) back.searchParams.set('state', state);
  return back.href;
}

/** @param {number} status @param {unknown} [body] */
const answer = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Issues an access token (and refresh token) for a scenario. @param {string} scenario @param {boolean} fresh */
function issue(scenario, fresh) {
  const access = `mock-access-${random()}`;
  const refresh = `mock-refresh-${random()}`;
  accessTokens.set(access, { scenario, fresh });
  refreshTokens.set(refresh, { scenario });
  return answer(200, { access_token: access, token_type: 'bearer', expires_in: 3600, refresh_token: refresh, scope: 'read offline', user_id: MOCK_USER_ID });
}

/**
 * Answers a request the way Learn would, from inside the server.
 * @param {string | URL | Request} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function mockFetch(input, init = {}) {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const path = decodeURIComponent(url.pathname);
  const headers = new Headers(init.headers);

  if (path === '/learn/api/public/v1/oauth2/token' && init.method === 'POST') {
    if (headers.get('authorization') !== `Basic ${Buffer.from(`${MOCK_APP_KEY}:${MOCK_APP_SECRET}`).toString('base64')}`) return answer(401, { status: 401, message: 'Bad client credentials' });
    const grant = new URLSearchParams(String(init.body ?? '')).get('grant_type');
    if (grant === 'authorization_code') {
      const code = url.searchParams.get('code') ?? '';
      const found = codes.get(code);
      codes.delete(code);
      const verifier = url.searchParams.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
      if (!found || found.redirectUri !== url.searchParams.get('redirect_uri') || found.challenge !== challenge) {
        return answer(400, { error: 'invalid_grant', error_description: 'The code, redirect address or PKCE verifier is wrong' });
      }
      return issue(found.scenario, found.scenario !== 'expired');
    }
    if (grant === 'refresh_token') {
      const found = refreshTokens.get(url.searchParams.get('refresh_token') ?? '');
      if (!found || found.scenario === 'revoked') return answer(400, { error: 'invalid_grant', error_description: 'Refresh token not valid' });
      // A refreshed token works, even in the "expired" case.
      return issue(found.scenario === 'expired' ? 'normal' : found.scenario, true);
    }
    return answer(400, { error: 'unsupported_grant_type' });
  }

  const token = accessTokens.get(headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  if (!token || !token.fresh || token.scenario === 'revoked') return answer(401, { status: 401, message: 'Bearer token is invalid' });
  if (token.scenario === 'down') return answer(503, { status: 503, message: 'Service unavailable' });
  if (token.scenario === 'slow') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30_000);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      });
    });
  }

  const data = mockData(Date.now(), token.scenario);
  const page = (/** @type {any[]} */ results) => answer(200, { results });
  /** @type {RegExpMatchArray | null} */
  let match;
  if ((match = path.match(/^\/learn\/api\/public\/v1\/users\/([^/]+)\/courses$/))) {
    return match[1] === `uuid:${MOCK_USER_ID}` ? page(data.memberships) : answer(403, { status: 403 });
  }
  if ((match = path.match(/^\/learn\/api\/public\/v1\/terms\/([^/]+)$/))) {
    const term = data.terms.find((t) => t.id === match?.[1]);
    return term ? answer(200, term) : answer(404, { status: 404 });
  }
  if ((match = path.match(/^\/learn\/api\/public\/v1\/courses\/([^/]+)\/contents$/))) {
    const items = data.contents[match[1]] ?? [];
    // Two pages for the first module, as Learn pages long lists.
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (match[1] === '_3101_1' && items.length > 6) {
      const next = new URL(url);
      next.searchParams.set('offset', '6');
      return offset === 0
        ? answer(200, { results: items.slice(0, 6), paging: { nextPage: `${next.pathname}${next.search}` } })
        : page(items.slice(6));
    }
    return page(items);
  }
  if ((match = path.match(/^\/learn\/api\/public\/v2\/courses\/([^/]+)\/gradebook\/columns$/))) {
    // This module hides its gradebook from students, as some do.
    if (match[1] === '_3102_1') return answer(403, { status: 403, message: 'The My Grades tool is not available' });
    return page(data.columns[match[1]] ?? []);
  }
  if ((match = path.match(/^\/learn\/api\/public\/v1\/courses\/([^/]+)\/announcements$/))) return page(data.announcements[match[1]] ?? []);
  if (path === '/learn/api/public/v1/calendars/items') return page(data.calendar);
  return answer(404, { status: 404, message: 'No such endpoint in the mock' });
}

/**
 * The pretend student's Blackboard, in Learn's shapes, with dates around now.
 * @param {number} now
 * @param {string} scenario
 */
export function mockData(now, scenario = 'normal') {
  const at = (/** @type {number} */ days, hour = 9) => {
    const date = new Date(now + days * DAY);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const course = (/** @type {string} */ id, /** @type {string} */ code, /** @type {string} */ name, termId = '_50_1', extra = {}) => ({
    id,
    courseId: code,
    name,
    termId,
    organization: false,
    availability: { available: 'Term', duration: { type: 'Term' } },
    externalAccessUrl: `${MOCK_HOST}/ultra/courses/${id}/outline`,
    ...extra
  });
  const courses = [
    course('_3101_1', 'NU-PROG4001-2026', 'Programming Fundamentals'),
    course('_3102_1', 'NU-WRIT4002-2026', 'Academic Writing and Study Skills'),
    course('_3103_1', 'NU-DATA4003-2026', 'Data and Society'),
    course('_3104_1', 'NU-TEAM4004-2026', 'Team Project'),
    course('_3001_1', 'NU-PAST3001-2025', 'Last Year’s Module', '_49_1'),
    course('_3105_1', 'NU-HIDE4005-2026', 'A Module Not Yet Open', '_50_1', { availability: { available: 'No', duration: { type: 'Term' } } }),
    course('_3901_1', 'ORG-CHESS', 'Chess Club Organisation', '', { organization: true, termId: undefined })
  ];
  const memberships = scenario === 'no-modules' ? [] : courses.map((c) => ({ id: `_m${c.id}`, userId: '_7701_1', courseId: c.id, course: c, availability: { available: 'Yes' }, courseRoleId: 'Student' }));
  // (userId above is the pretend student's primary id, which the page never needs.)

  const terms = [
    { id: '_50_1', name: '2026/27 Semester 1', availability: { available: 'Yes', duration: { type: 'DateRange', start: at(-56), end: at(70) } } },
    { id: '_49_1', name: '2025/26 Semester 2', availability: { available: 'Yes', duration: { type: 'DateRange', start: at(-300), end: at(-150) } } }
  ];

  /** @type {Record<string, any[]>} */
  const contents = {};
  let next = 4001;
  for (const [courseId, topics] of /** @type {[string, string[]][]} */ ([
    ['_3101_1', ['Getting started with Python', 'Variables and types', 'Decisions and loops', 'Functions', 'Lists and dictionaries', 'Files', 'Testing your code', 'Objects']],
    ['_3102_1', ['What university writing looks like', 'Reading critically', 'Referencing', 'Planning an essay', 'Paragraphs and argument', 'Editing your work', 'Reflective writing', 'Exam skills']],
    ['_3103_1', ['What data is', 'Collecting data fairly', 'Privacy and consent', 'Bias in data', 'Visualising data', 'Data and the law', 'Case studies', 'Revision']],
    ['_3104_1', ['Forming your team', 'Working agreements', 'Planning the project', 'Roles and meetings', 'Progress reviews', 'Presenting your work', 'Peer feedback', 'Reflection']]
  ])) {
    contents[courseId] = [];
    topics.forEach((topic, i) => {
      const released = -54 + i * 7;
      if (released > 0) return;
      const folder = `_${next++}_1`;
      contents[courseId].push({ id: folder, title: `Week ${i + 1}: ${topic}`, created: at(released, 8), modified: at(released, 8), position: i, hasChildren: true, contentHandler: { id: 'resource/x-bb-folder' }, availability: { available: 'Yes' }, links: [{ href: `/ultra/courses/${courseId}/outline/edit/folder/${folder}`, rel: 'alternate', title: 'User Interface View', type: 'text/html' }] });
      for (const item of ['Lecture slides', 'Seminar worksheet']) {
        const id = `_${next++}_1`;
        contents[courseId].push({ id, parentId: folder, title: `${item}: ${topic}`, created: at(released, 9), modified: at(released, 9), contentHandler: { id: 'resource/x-bb-document' }, availability: { available: 'Yes' }, links: [{ href: `/ultra/courses/${courseId}/outline/edit/document/${id}`, rel: 'alternate', title: 'User Interface View', type: 'text/html' }] });
      }
    });
  }

  const column = (/** @type {string} */ id, /** @type {string} */ name, /** @type {string | null} */ due, possible = 100) => ({
    id, name, displayName: name, contentId: null, score: { possible }, grading: { type: 'Attempts', ...(due ? { due } : {}), attemptsAllowed: 1, scoringModel: 'Last' }, availability: { available: 'Yes' }
  });
  /** @type {Record<string, any[]>} */
  const columns = {
    _3101_1: [column('_701_1', 'Assignment 1: Portfolio', at(-2, 14)), column('_702_1', 'Quiz 3', at(2, 12), 10), column('_703_1', 'Assignment 2: Programming project', at(30, 14)), { ...column('_704_1', 'Total', null), grading: { type: 'Calculated' } }],
    _3103_1: [column('_711_1', 'Essay plan', at(9, 14)), column('_712_1', 'Essay', at(40, 14))],
    _3104_1: [column('_721_1', 'Group presentation', at(5, 10))]
  };

  const announcement = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ body, /** @type {number} */ days) => ({
    id, title, body, creator: '_88_1', creatorUserId: '_88_1', draft: false, availability: { duration: { type: 'Permanent' } }, created: at(days, 11), modified: at(days, 11)
  });
  /** @type {Record<string, any[]>} */
  const announcements = {
    _3101_1: [announcement('_801_1', 'This week’s lab has moved', '<p>This week&rsquo;s lab is in <strong>room CIS 204</strong>, not the usual room.</p><p>See you there!</p>', -1)],
    _3104_1: [announcement('_811_1', 'Teams are up', '<p>Your project teams are on the module page. Please meet your team before Friday.</p>', -10)]
  };

  const calendar = [
    { id: '_901_1', type: 'Course', calendarId: '_3101_1', calendarName: 'Programming Fundamentals', title: 'In-class test', start: at(5, 10), end: at(5, 11), createdByUserId: '_88_1' },
    { id: '_902_1', type: 'Course', calendarId: '_3104_1', calendarName: 'Team Project', title: 'Guest lecture: working in teams', start: at(12, 14), end: at(12, 15), createdByUserId: '_88_1' },
    { id: '_702_1', type: 'GradebookColumn', calendarId: '_3101_1', calendarName: 'Programming Fundamentals', title: 'Quiz 3', start: at(2, 12), end: at(2, 12) },
    { id: '_731_1', type: 'GradebookColumn', calendarId: '_3102_1', calendarName: 'Academic Writing and Study Skills', title: 'Reflective log', start: at(6, 14), end: at(6, 14) },
    { id: '_903_1', type: 'Personal', calendarId: 'PERSONAL', calendarName: 'Personal', title: 'Dentist', start: at(3, 15), end: at(3, 16) },
    { id: '_904_1', type: 'Institution', calendarId: 'INSTITUTION', calendarName: 'Institution', title: 'Reading week', start: at(20, 0), end: at(27, 0) }
  ];

  return { memberships, terms, contents, columns, announcements, calendar };
}
