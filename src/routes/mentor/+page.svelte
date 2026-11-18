<script>
  import { tick } from 'svelte';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { db, getFirebaseAuth } from '#lib/firebase/client.js';
  import BackLink from '#lib/components/BackLink.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import ChangeMentorRequest from '#lib/components/ChangeMentorRequest.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import MentorContact from '#lib/components/MentorContact.svelte';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { hasMentorProfile } from '#lib/matching/mentor-account.js';
  import { loadMentorContact, loadMySharing, shareMyEmail, stopSharing } from '#lib/matching/mentor-contact.js';

  /**
   * Which part of the page is showing:
   * - 'checking': loading; 'error': loading failed (logged-out visitors are sent to login instead)
   * - 'none': no match record yet; 'waiting': the coordinator is finding a mentor; 'matched'
   * - 'mentor': a mentor's own account, which chooses whether their students see their email address
   * @typedef {'checking' | 'error' | 'none' | 'waiting' | 'matched' | 'mentor'} View
   */
  let view = $state(/** @type {View} */ ('checking'));
  let match = $state(/** @type {import('#lib/matching/matches.js').Match | null} */ (null));
  /** A matched student's mentor's shared email address (mentor-contact.js), or null: the coordinator introduces them. */
  let contact = $state(/** @type {import('#lib/matching/mentor-contact.js').MentorContact | null} */ (null));
  /** A mentor's own: the address their students can see, or null if they don't share it. */
  let sharing = $state(/** @type {{ email: string } | null} */ (null));
  let busy = $state(false);
  let said = $state('');
  let problem = $state('');

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
      const [isMentor, found] = await Promise.all([hasMentorProfile(), loadMyMatch()]);
      if (isMentor) {
        sharing = await loadMySharing(db, signedIn().uid);
        view = 'mentor';
        return;
      }
      match = found;
      // Loaded here, never with what the chat tells Gemini.
      contact = await loadMentorContact(db, found);
      view = match === null ? 'none' : match.status === 'matched' ? 'matched' : 'waiting';
    } catch (err) {
      console.error(err);
      view = 'error';
    }
  }

  /** The signed-in account (the layout sends anyone logged out to log in). */
  function signedIn() {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error('You need to be logged in.');
    return user;
  }

  /**
   * A mentor shares their email address with the students matched with them, or stops.
   * @param {boolean} share
   */
  async function setSharing(share) {
    busy = true;
    said = '';
    problem = '';
    try {
      const user = signedIn();
      if (share) await shareMyEmail(db, user);
      else await stopSharing(db, user.uid);
      sharing = await loadMySharing(db, user.uid);
      said = share ? 'Done: the students matched with you can see it now.' : 'Done: they can’t see it any more.';
    } catch (err) {
      console.error('Changing what a mentor shares failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
      problem = 'That didn’t work. Please check your connection and try again.';
    } finally {
      busy = false;
      // The other button has taken its place: the focus goes to it, where a keyboard user left off.
      await tick();
      document.getElementById('sharing-button')?.focus();
    }
  }
</script>

<main class="page">
  <!-- Reached from Home or More since Societies took its place in the bottom bar (nav-tabs.js). -->
  <BackLink />

  <h1>{view === 'mentor' ? 'You’re a mentor' : 'Your mentor'}</h1>

  {#if view === 'checking'}
    <p class="muted" role="status">Loading…</p>

  {:else if view === 'error'}
    <p class="error" role="alert">We couldn't load your mentor. Please check your connection.</p>
    <button class="primary-button" onclick={load}>Try again</button>

  {:else if view === 'none'}
    <div class="card hero">
      <span class="hero-icon"><Icon name="mentor" size={28} /></span>
      <p>You haven’t got a mentor yet. Answer a few short questions and we’ll match you with a student mentor.</p>
      <a class="primary-button" href="/find-mentor">Find a mentor</a>
    </div>

  {:else if view === 'waiting'}
    <div class="card hero">
      <span class="hero-icon"><Icon name="clock" size={28} /></span>
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
      <!-- Their mentor's email address if the mentor chose to share it; otherwise the coordinator. -->
      <p><strong>Getting in touch:</strong> <MentorContact {contact} /></p>
    </div>
    <!-- Asking the coordinator for someone else: only the coordinator sees the reason. -->
    <ChangeMentorRequest />

  {:else if view === 'mentor'}
    <!-- Whether the students matched with them see their email address: their choice, at any time. -->
    <section class="card" aria-labelledby="sharing-title">
      <h2 id="sharing-title">Your email address</h2>
      {#if sharing}
        <p>Students matched with you can see it, <strong class="address">{sharing.email}</strong>, so they can get in touch with you.</p>
        <button id="sharing-button" class="secondary-button" type="button" onclick={() => setSharing(false)} disabled={busy}>{busy ? 'Stopping…' : 'Stop sharing it'}</button>
      {:else}
        <p>Students matched with you can’t see it, so the coordinator introduces you.</p>
        <button id="sharing-button" class="primary-button" type="button" onclick={() => setSharing(true)} disabled={busy}>{busy ? 'Sharing…' : 'Share it with them'}</button>
      {/if}
      <!-- Always there, so a screen reader hears "Done" when it appears. -->
      <div class="muted" role="status">{#if said}<p>{said}</p>{/if}</div>
      {#if problem}<p class="error" role="alert">{problem}</p>{/if}
      <p class="muted">Only students matched with you can see it, on their Your mentor page and in the chat. It’s never sent to Gemini.</p>
    </section>
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
    margin: 8px 0 14px;
  }

  .hero-icon {
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    color: var(--violet);
    background: var(--violet-soft);
  }

  /* Matched: a warm card with a badge, and why, ticked off. */
  .matched {
    border-color: #d9dcfb;
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
    border-radius: 14px;
    color: white;
    background: var(--violet);
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
  }

  /* A long address wraps rather than pushing the card wider than a phone. */
  .address {
    overflow-wrap: anywhere;
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
