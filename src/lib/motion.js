// Small motion helpers shared by the pages (the motion itself is CSS, in app.css and each component).
// Browser only.

/** How far apart things that arrive together start, one after another. */
const STAGGER_MS = 70;
/** At most this long a wait, however many arrive together. */
const MAX_DELAY_MS = 420;

let batch = 0;
let resetting = false;

/** The delay for the next thing to arrive: things that arrive in the same frame follow one another. */
function nextDelay() {
  if (!resetting) {
    resetting = true;
    requestAnimationFrame(() => {
      batch = 0;
      resetting = false;
    });
  }
  return Math.min(batch++ * STAGGER_MS, MAX_DELAY_MS);
}

/**
 * A Svelte action: when a new element arrives (after the page first appeared), it gets the
 * "arrive" class, so its CSS can spring it in, staggered behind others arriving with it
 * (--arrive-delay). What was already there when the page opened (a chat they've come back to) stays
 * still, so nothing replays.
 * @param {HTMLElement} node
 * @param {{ ready: () => boolean }} options ready: whether the page has finished its first appearance
 */
export function arrive(node, { ready }) {
  if (!ready()) return;
  node.style.setProperty('--arrive-delay', `${nextDelay()}ms`);
  node.classList.add('arrive');
}

/**
 * A Svelte action for a one-off celebration: calls done once it has had time to play, so whatever
 * shows it can be cleared and it never replays when they come back.
 * @param {HTMLElement} node
 * @param {() => void} done
 */
export function playedOnce(node, done) {
  const timer = setTimeout(done, 2600);
  return { destroy: () => clearTimeout(timer) };
}

/**
 * A light buzz for a moment worth feeling (a task ticked), on phones that can (Android; iPhones
 * don't let web pages buzz). Never with Reduce Motion on.
 * @param {number | number[]} [pattern]
 */
export function buzz(pattern = 12) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Not allowed here: no buzz.
  }
}
