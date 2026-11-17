<script>
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { sendToLogin } from '#lib/login-redirect.js';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { loadMyMatch } from '#lib/matching/matches.js';

  /**
   * Which part of the page is showing:
   * - 'checking': loading; 'error': loading failed (logged-out visitors are sent to login instead)
   * - 'none': no match record yet; 'waiting': the coordinator is finding a mentor; 'matched'
   * @typedef {'checking' | 'error' | 'none' | 'waiting' | 'matched'} View
   */
  let view = $state(/** @type {View} */ ('checking'));
  let match = $state(/** @type {import('#lib/matching/matches.js').Match | null} */ (null));

  // $effect only runs in the browser, where Firebase Auth runs. watchSignedIn's stop function is
  // returned, so Svelte stops listening when the student leaves the page.
  $effect(() =>
    watchSignedIn((signedIn) => {
      if (signedIn) load();
      else sendToLogin();
    })
  );

  async function load() {
    view = 'checking';
    try {
      match = await loadMyMatch();
      view = match === null ? 'none' : match.status === 'matched' ? 'matched' : 'waiting';
    } catch (err) {
      console.error(err);
      view = 'error';
    }
  }
</script>

<main class="page">
  <h1>Your mentor</h1>

  {#if view === 'checking'}
    <p class="muted" role="status">Loading…</p>

  {:else if view === 'error'}
    <p class="error" role="alert">We couldn't load your mentor. Please check your connection.</p>
    <button class="primary-button" onclick={load}>Try again</button>

  {:else if view === 'none'}
    <p>You haven’t got a mentor yet. Answer a few short questions and we’ll match you with a student mentor.</p>
    <a class="primary-button" href="/find-mentor">Find a mentor</a>

  {:else if view === 'waiting'}
    <p>We’re finding you a mentor, and we’ll let you know soon.</p>

  {:else if match && match.status === 'matched'}
    <!-- A match the coordinator made in the console may have no name, reasons or meeting frequency,
         so each part only shows when it's there. -->
    <div class="card">
      <h2>{match.mentorName ? `You’ve been matched with ${match.mentorName}` : 'You’ve been matched with a mentor'}</h2>
      {#if match.reasons.length}
        <p>Why we matched you:</p>
        <ul>
          {#each match.reasons as reason (reason)}
            <li>{reason}</li>
          {/each}
        </ul>
      {/if}
      {#if match.meetingFrequency}
        <p>You’ll meet {match.meetingFrequency}.</p>
      {/if}
      <p>Your coordinator will introduce you.</p>
    </div>
  {/if}

  <BottomNav />
</main>
