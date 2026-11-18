<script>
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import ChangeMentorRequest from '#lib/components/ChangeMentorRequest.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Mascot from '#lib/components/Mascot.svelte';
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
      // Logged out: the root layout sends them to log in (see account-gate.js).
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
    <div class="card hero">
      <Mascot mood="wave" size={92} />
      <p>You haven’t got a mentor yet. Answer a few short questions and we’ll match you with a student mentor.</p>
      <a class="primary-button" href="/find-mentor">Find a mentor</a>
    </div>

  {:else if view === 'waiting'}
    <div class="card hero">
      <Mascot mood="calm" size={92} />
      <p>We’re finding you a mentor, and we’ll let you know soon.</p>
    </div>

  {:else if match && match.status === 'matched'}
    <!-- A match the coordinator made in the console may have no name, reasons or meeting frequency,
         so each part only shows when it's there. -->
    <div class="card matched">
      <div class="matched-head">
        <span class="badge"><Icon name="people" size={26} /></span>
        <h2>{match.mentorName ? `You’ve been matched with ${match.mentorName}` : 'You’ve been matched with a mentor'}</h2>
      </div>
      {#if match.reasons.length}
        <p>Why we matched you:</p>
        <ul class="reasons">
          {#each match.reasons as reason (reason)}
            <li><Icon name="check" size={18} stroke={3} /> <span>{reason}</span></li>
          {/each}
        </ul>
      {/if}
      {#if match.meetingFrequency}
        <!-- The student's own choice from /find-mentor, until the coordinator confirms it. -->
        <p>You asked to meet {match.meetingFrequency}.</p>
      {/if}
      <p>Your coordinator will introduce you.</p>
    </div>
    <!-- Asking the coordinator for someone else: only the coordinator sees the reason. -->
    <ChangeMentorRequest />
  {/if}

  <BottomNav />
</main>

<style>
  /* No mentor yet, or one being found: the mascot, and the way to start. */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
    padding: 22px 20px;
  }

  .hero p {
    margin: 4px 0 14px;
    font-weight: 600;
  }

  /* Matched: a warm card with a badge, and why, ticked off. */
  .matched {
    background: linear-gradient(160deg, var(--sun-soft) 0%, white 45%);
  }

  .matched-head {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .matched-head h2 {
    margin: 0;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 18px;
    color: white;
    background: linear-gradient(135deg, var(--coral) 0%, var(--violet) 100%);
    box-shadow: 0 6px 14px rgb(107 60 245 / 0.28);
    flex: none;
  }

  .reasons {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .reasons li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-weight: 600;
  }

  .reasons :global(.icon) {
    margin-top: 2px;
    color: var(--mint);
  }

  @media (prefers-reduced-motion: no-preference) {
    .badge {
      animation: badge-in var(--dur-4) var(--ease-bounce) 120ms both;
    }
  }

  @keyframes badge-in {
    from {
      transform: scale(0.4) rotate(-20deg);
    }
  }
</style>
