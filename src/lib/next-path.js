// Where to go after logging in. Private pages send logged-out visitors to /?next=<the page they
// wanted>, and the login page goes back there afterwards. The link can be edited by anyone, so only
// a path on THIS site is accepted; otherwise someone could share a login link that sends people to
// another website after they log in. No SvelteKit or Firebase here, so
// scripts/check-redirects.mjs can test it in Node.

/** A made-up site to resolve paths against: if a path leaves it, it would have left ours too. */
const BASE = 'https://ag2.invalid';

/**
 * Returns `raw` if it's a path on this site, or null if it isn't (or is just the login page).
 * @param {unknown} raw usually the ?next= value
 * @returns {string | null}
 */
export function safeNextPath(raw) {
  if (typeof raw !== 'string') return null;
  // Exactly one leading slash: "/check-in". "//evil.com" means another website to a browser.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // No backslashes or control characters anywhere: browsers can read "/\evil.com" as "//evil.com",
  // and quietly remove tabs and line breaks, so "/<tab>/evil.com" would become "//evil.com" too.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  // Belt and braces: resolved against a made-up site, the path must stay on that site.
  let url;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const path = url.pathname + url.search + url.hash;
  // Going "back" to the login page itself would be pointless.
  return path === '/' || path.startsWith('/?') || path.startsWith('/#') ? null : path;
}

/**
 * The login link for someone who wanted `path`, for example "/?next=%2Fcheck-in".
 * @param {string} path a path on this site, with any ?query
 */
export function loginPathFor(path) {
  return `/?next=${encodeURIComponent(path)}`;
}
