import { goto } from '$app/navigation';
import { trail } from '#lib/back.js';
import { loginPathFor } from '#lib/next-path.js';

/**
 * Sends a logged-out visitor to the login page, which brings them back here after they log in.
 * Private pages call this when watchSignedIn reports nobody is signed in. replaceState swaps this
 * page out of the history, so pressing Back after logging in doesn't land on a page that sends
 * them straight back to login.
 */
export function sendToLogin() {
  trail.willReplace();
  goto(loginPathFor(location.pathname + location.search), { replaceState: true });
}
