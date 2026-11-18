// Animations between pages, with the browser's View Transitions (Chrome, Edge and Safari 18 and later
// have them; other browsers just change page). The root layout starts one for each navigation, and
// the animations themselves are in app.css (data-page-transition):
// - opening the chat: it grows out of where they tapped, in a circle (the Chat button, or Home's
//   “Ask me anything”), as the heart of the app should;
// - between the bottom bar's pages: a quick crossfade, while the bar's highlight glides to the new tab;
// - going deeper (a society, a guide from More): the new page slides in from the right; back slides
//   the other way.
// With Reduce Motion on, every one is a short fade instead: nothing slides or grows.

/** The bottom bar's pages: moving between them is a crossfade, not a slide. */
export const TABS = Object.freeze(['/home', '/checklist', '/check-in', '/mentor', '/more']);

/** How deep a page is: the bar's pages are the top, and each part of a path goes one deeper. @param {string} path */
const depth = (path) => (TABS.includes(path) ? 0 : path.split('/').filter(Boolean).length);

/**
 * Which animation a navigation gets, or null for none (the first page, a reload, or the same page).
 * @param {string | undefined} from the path navigated from
 * @param {string | undefined} to the path navigated to
 * @param {string} [type] SvelteKit's navigation type ('link', 'goto', 'popstate' and so on)
 * @param {number | null} [delta] for 'popstate', how many steps through history (negative is back)
 * @returns {'chat' | 'tab' | 'forward' | 'back' | null}
 */
export function transitionFor(from, to, type = 'link', delta = null) {
  if (!from || !to || from === to) return null;
  if (to === '/check-in') return 'chat';
  if (TABS.includes(from) && TABS.includes(to)) return 'tab';
  if (type === 'popstate') return (delta ?? -1) < 0 ? 'back' : 'forward';
  return depth(to) >= depth(from) ? 'forward' : 'back';
}

/** True when a navigation opens the chat from Home (its “Ask me anything” card or the bottom bar's Chat). */
export const opensChatFromHome = (/** @type {string | undefined} */ from, /** @type {string | undefined} */ to) => from === '/home' && to === '/check-in';

/** The longest the chat's reveal waits for the chat's messages before it starts anyway. */
export const WAIT_FOR_CHAT_MS = 200;

/**
 * Waits until the chat's messages are on the page (data-chat-ready), or WAIT_FOR_CHAT_MS has
 * passed, so the reveal shows the whole chat rather than "Loading…". Browser only.
 *
 * This runs inside the transition's update, while the browser holds the old screen and draws no
 * frames, so it watches the page for changes and sets a timer. A once-a-frame check
 * (requestAnimationFrame) never runs there: it froze the screen until Chrome gave up on the
 * transition after 4 seconds.
 * @returns {Promise<void>}
 */
export function chatShown() {
  const ready = () => document.querySelector('[data-chat-ready]') !== null;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (ready()) done();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(done, WAIT_FOR_CHAT_MS);
  });
}

/** Where they last touched or clicked, for the chat to grow out of. Browser only. */
let lastTouch = /** @type {{ x: number, y: number } | null} */ (null);

/** Starts remembering where they touch (once, for the whole app). Browser only. */
export function watchTouches() {
  window.addEventListener('pointerdown', (event) => (lastTouch = { x: event.clientX, y: event.clientY }), { capture: true, passive: true });
}

/**
 * Where the chat's circle grows from: where they last touched, or the middle of the bottom bar (the
 * Chat button) if they used a keyboard.
 */
export function revealOrigin() {
  return lastTouch ?? { x: window.innerWidth / 2, y: window.innerHeight - 40 };
}
