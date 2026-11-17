// Where "← Back" goes: the page the student came from within the app; or, if they opened this page
// directly (from a link elsewhere or a typed address), Home, or log in when they're logged out. The
// root layout records every navigation in this tab's trail, which keeps in step with the browser's
// history; BackLink.svelte asks it where to go. No Firebase here, so the checks can test it in Node.

/** Logging in and signing up: never somewhere to go back to once they're signed in (Home instead). */
const SIGN_IN_PAGES = Object.freeze(['/', '/signup', '/forgot-password', '/mentor-signup']);

/**
 * One navigation, as SvelteKit's afterNavigate reports it: its type ('enter' is the first page the
 * tab opened; 'popstate' is the browser's back or forward, by delta pages) and where it went.
 * @typedef {{ type: string, delta?: number | null, to: string }} Step
 */

/** The app's pages in this tab, in the browser's order, and which one is open. */
export function createTrail() {
  /** @type {string[]} */
  let pages = [];
  let at = -1;
  let replacing = false;
  return {
    /** The next navigation replaces this page in the browser's history (as sending someone to log in does). */
    willReplace() {
      replacing = true;
    },
    /** @param {Step} step */
    record({ type, delta, to }) {
      const replace = replacing;
      replacing = false;
      if (type === 'enter' || at < 0) {
        pages = [to];
        at = 0;
      } else if (type === 'popstate') {
        const next = at + (delta ?? 0);
        // Before or after anything the app has seen in this tab (a page from before a reload): start again.
        if (next < 0 || next >= pages.length) {
          pages = [to];
          at = 0;
        } else {
          at = next;
          pages[at] = to;
        }
      } else if (replace) {
        pages[at] = to;
      } else {
        pages = [...pages.slice(0, at + 1), to];
        at += 1;
      }
    },
    /** The app's page before this one, or null if this is the first one they opened. */
    previous() {
      return at > 0 ? pages[at - 1] : null;
    }
  };
}

/** This tab's trail. */
export const trail = createTrail();

/**
 * Where Back goes: the browser's own back ('history', to the page they came from), or a page to open
 * when there's no earlier page in the app, or the earlier one is a log-in or sign-up page and they're
 * now signed in.
 * @param {string | null} previous what trail.previous() says
 * @param {boolean} signedIn
 * @returns {{ kind: 'history' } | { kind: 'open', href: string }}
 */
export function backTarget(previous, signedIn) {
  const path = previous === null ? null : previous.split(/[?#]/)[0];
  if (path !== null && !(signedIn && SIGN_IN_PAGES.includes(path))) return { kind: 'history' };
  return { kind: 'open', href: signedIn ? '/home' : '/' };
}
