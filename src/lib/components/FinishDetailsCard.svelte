<script>
  import { onMount } from 'svelte';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { db } from '#lib/firebase/client.js';
  import { loadDetailsNeeded } from '#lib/students/signup.js';

  /**
   * On Home, for a signed-in student whose sign-up details were lost (they closed the tab before
   * verifying their email, so nothing was saved): asks for them again. The sign-up page then saves them
   * to this account, the way the mentor page does for a lost mentor profile. "Not now" hides it until
   * the tab closes. Never shown to a mentor (see needsDetails in signup.js).
   */
  const LATER = 'ag2-details-later';

  let show = $state(false);

  /** Whether they chose "Not now" in this tab (storage may be blocked: then it just shows). */
  function later() {
    try {
      return sessionStorage.getItem(LATER) === '1';
    } catch {
      return false;
    }
  }

  function notNow() {
    show = false;
    try {
      sessionStorage.setItem(LATER, '1');
    } catch {
      // Hidden for this visit only.
    }
  }

  onMount(() =>
    watchAccount(async (account) => {
      if (!account?.verified || later()) {
        show = false;
        return;
      }
      try {
        show = await loadDetailsNeeded(db, account.uid);
      } catch (err) {
        console.error('Checking for missing details failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
        show = false;
      }
    })
  );
</script>

{#if show}
  <section class="card details" aria-labelledby="details-title">
    <h2 id="details-title">Finish your details</h2>
    <p>Add your name, course and interests, so the chat can suggest things that fit you. It takes a minute.</p>
    <div class="actions">
      <a class="primary-button" href="/signup">Add my details</a>
      <button class="secondary-button" type="button" onclick={notNow}>Not now</button>
    </div>
  </section>
{/if}

<style>
  .details h2 {
    margin-top: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
