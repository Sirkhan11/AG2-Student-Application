<script>
  import { onMount } from 'svelte';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { db } from '#lib/firebase/client.js';
  import { loadStudentDetails } from '#lib/students/signup.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { hasMentorProfile } from '#lib/matching/mentor-account.js';

  /**
   * On Home, for a student who ticked "Match me with a second- or third-year mentor" when they signed
   * up and hasn't found one yet: offers the Find a mentor page, the flow that exists (the six
   * questions; nobody is matched without them). Gone once they have a match or a request with the
   * coordinator, never shown to a mentor, and "Not now" hides it until the tab closes, like
   * FinishDetailsCard.
   */
  const LATER = 'ag2-mentor-later';

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
        const [details, match, isMentor] = await Promise.all([loadStudentDetails(db, account.uid), loadMyMatch(), hasMentorProfile()]);
        show = details.wantsMentor && match === null && !isMentor;
      } catch (err) {
        console.error('Checking whether to offer a mentor failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
        show = false;
      }
    })
  );
</script>

{#if show}
  <section class="card mentor" aria-labelledby="find-mentor-title">
    <h2 id="find-mentor-title">Find your mentor</h2>
    <p>You asked to be matched with a second- or third-year mentor. Six short questions, and we’ll find you one.</p>
    <div class="actions">
      <a class="primary-button" href="/find-mentor">Find my mentor</a>
      <button class="secondary-button" type="button" onclick={notNow}>Not now</button>
    </div>
  </section>
{/if}

<style>
  .mentor h2 {
    margin-top: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
