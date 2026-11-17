<script>
  import { goto } from '$app/navigation';
  import { getFirebaseAuth } from '#lib/firebase/client.js';
  import { backTarget, trail } from '#lib/back.js';

  /**
   * "← Back": to the page they came from within the app, or Home if they opened this page directly
   * (from a link elsewhere or a typed address), or log in when they're logged out (see back.js).
   * Opened in a new tab, or without the page's code running, it's a plain link Home.
   * @param {MouseEvent} event
   */
  function back(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const target = backTarget(trail.previous(), getFirebaseAuth().currentUser !== null);
    if (target.kind === 'history') history.back();
    else goto(target.href);
  }
</script>

<a href="/home" onclick={back}>← Back</a>
