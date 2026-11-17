// Animations between pages. Opening the chat from Home: Home fades to a plain white screen and the
// chat page is pulled down over it from the top, using the browser's View Transitions (Chrome, Edge and Safari 18 and
// later have them); in other browsers, or with reduced motion turned on, the chat just opens. The
// root layout starts it; the animation itself is in app.css (data-page-transition="chat-open").

/**
 * True when a navigation opens the chat from Home (its "Ask anything" box, Chat button or the
 * bottom bar's Chat).
 * @param {string | undefined} from the path navigated from
 * @param {string | undefined} to the path navigated to
 */
export const opensChatFromHome = (from, to) => from === '/home' && to === '/check-in';

/** The longest the slide waits for the chat's messages before it starts anyway. */
export const WAIT_FOR_CHAT_MS = 200;

/**
 * Waits until the chat's messages are on the page (data-chat-ready), or WAIT_FOR_CHAT_MS has
 * passed, so the slide shows the whole chat rather than "Loading…". Browser only.
 * @returns {Promise<void>}
 */
export function chatShown() {
  return new Promise((resolve) => {
    const started = performance.now();
    const look = () => {
      if (document.querySelector('[data-chat-ready]') || performance.now() - started > WAIT_FOR_CHAT_MS) resolve();
      else requestAnimationFrame(look);
    };
    look();
  });
}
