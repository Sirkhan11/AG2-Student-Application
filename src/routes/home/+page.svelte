<script>
  import { onMount } from 'svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import FinishDetailsCard from '#lib/components/FinishDetailsCard.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { loadMyRecord } from '#lib/checklist/store.js';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { nextTask, societiesForYou, weekLine } from '#lib/home/dashboard.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { hasMentorProfile } from '#lib/matching/mentor-account.js';
  import { greetingFor } from '#lib/students/greeting.js';

  // Home as a dashboard, as the group's wireframe: the greeting, with Need help now always in view at
  // the top right; their checklist (progress, the next task and the button that does it); their
  // mentor, whichever state they're in; the way into the chat (Ask me anything, which grows into the
  // chat: page-transitions.js); and Societies for you. All of it is worked out on the phone from their
  // own record (home/dashboard.js): Home never calls Gemini, and nothing is sent anywhere. Only what
  // the app really holds is shown: with no mentor yet, it offers to find one. Log out is on More.

  // "Hi Sam", from the name they gave at sign-up, or "Hi there". null until it's known: the heading
  // keeps its space but stays hidden, so a wrong name never flashes.
  let greeting = $state(/** @type {string | null} */ (null));
  /** "Week 2 at Northumbria", only when the arrival date they gave makes it true. */
  let week = $state(/** @type {string | null} */ (null));
  /** Their checklist so far: null until it's loaded (or if it can't be). */
  let checklist = $state(/** @type {{ done: number, total: number, next: ReturnType<typeof nextTask> } | null} */ (null));
  let societies = $state(/** @type {ReturnType<typeof societiesForYou> | null} */ (null));
  /** Whether they ticked "Match me with a mentor" at sign-up: the offer then says so. */
  let wantsMentor = $state(false);
  /** Which state their mentor is in: none yet, waiting for the coordinator, or matched (and a mentor's own account, or a failed load). */
  let mentor = $state(/** @type {'loading' | 'none' | 'waiting' | 'matched' | 'is-mentor' | 'error'} */ ('loading'));
  let match = $state(/** @type {import('#lib/matching/matches.js').Match | null} */ (null));

  onMount(() =>
    watchAccount(async (account) => {
      if (!account?.verified) return;
      try {
        const record = await loadMyRecord();
        greeting = greetingFor(record.name);
        week = weekLine(record.arrivalDate, new Date());
        const tasks = record.checklist.tasks;
        checklist = { done: tasks.filter((task) => task.done).length, total: tasks.length, next: nextTask(tasks) };
        const interests = Array.isArray(record.interests) ? record.interests.filter((interest) => typeof interest === 'string') : [];
        societies = societiesForYou(interests);
        wantsMentor = record.wantsMentor;
      } catch (err) {
        console.error('Loading Home failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
        greeting = greetingFor(null);
      }
      try {
        const [found, isMentor] = await Promise.all([loadMyMatch(), hasMentorProfile()]);
        match = found;
        mentor = isMentor ? 'is-mentor' : found?.status === 'matched' ? 'matched' : found?.status === 'coordinator' ? 'waiting' : 'none';
      } catch (err) {
        console.error('Loading the mentor for Home failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
        mentor = 'error';
      }
    })
  );
</script>

<main class="page">
  <header class="hero">
    <div class="hero-row">
      <h1 class:waiting={greeting === null}>{greeting ?? 'Hi there'}</h1>
      <!-- Always in view at the top, as the wireframe asks (US7). -->
      <a class="help-pill" href="/need-help"><Icon name="help" size={18} /> Need help now</a>
    </div>
    <p class="lead">{week ?? 'How can we help you today?'}</p>
  </header>

  <!-- Only if their sign-up details were lost before they verified their email, or their account is from before the about-you questions. -->
  <FinishDetailsCard />

  <section class="card dash" aria-labelledby="checklist-title">
    <div class="dash-head">
      <h2 id="checklist-title"><a href="/checklist">Your checklist</a></h2>
      {#if checklist}<span class="muted">{checklist.done} of {checklist.total} done</span>{/if}
    </div>
    {#if checklist}
      <div class="bar" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax={checklist.total} aria-valuenow={checklist.done}>
        <span style={`width: ${Math.round((checklist.done / Math.max(1, checklist.total)) * 100)}%`}></span>
      </div>
      {#if checklist.next}
        <div class="next-row">
          <p class="next">Next: {checklist.next.title}</p>
          {#if checklist.next.do}
            <!-- The screen in the app that gets it done: one tap from Home. -->
            <a class="primary-button do" href={checklist.next.do.href}>{checklist.next.do.label}</a>
          {:else}
            <a class="secondary-button do" href="/checklist">How to</a>
          {/if}
        </div>
      {:else}
        <p class="next">All done: everything’s ticked.</p>
      {/if}
    {:else}
      <p class="muted" role="status">Loading…</p>
    {/if}
  </section>

  <section class="card dash" aria-labelledby="mentor-title">
    <h2 id="mentor-title"><a href="/mentor">Your mentor</a></h2>
    {#if mentor === 'loading'}
      <p class="muted" role="status">Loading…</p>
    {:else if mentor === 'matched' && match?.status === 'matched'}
      <p class="name">{match.mentorName ?? 'Your mentor'}</p>
      <!-- The same as the Your Mentor page: the coordinator introduces them. -->
      <p>Getting in touch: your coordinator will introduce you.{#if match.meetingFrequency} You asked to meet {match.meetingFrequency}.{/if}</p>
      <a class="secondary-button do" href="/mentor">Your mentor page</a>
    {:else if mentor === 'waiting'}
      <p>We’re finding you a mentor, and we’ll let you know soon.</p>
    {:else if mentor === 'is-mentor'}
      <p>You’re a mentor yourself, so there’s nothing to find here.</p>
    {:else if mentor === 'error'}
      <p>We couldn’t load your mentor just now.</p>
      <a class="secondary-button do" href="/mentor">Your mentor page</a>
    {:else}
      <p>
        {wantsMentor ? 'You asked to be matched with a second- or third-year mentor.' : 'No mentor yet. A second- or third-year student can show you the ropes.'}
        Six short questions, and we’ll find you one.
      </p>
      <a class="primary-button do" href="/find-mentor">Find my mentor</a>
    {/if}
  </section>

  <!-- The chat grows out of this when it's tapped (page-transitions.js). -->
  <a class="ask" href="/check-in">
    <span class="ask-icon"><Icon name="sparkle" size={22} /></span>
    <span class="ask-words">
      <strong>Ask me anything</strong>
      <span>Tasks, societies, help and more</span>
    </span>
    <span class="ask-go"><Icon name="arrow" size={20} /></span>
  </a>

  <section class="card dash" aria-labelledby="societies-title">
    <div class="dash-head">
      <h2 id="societies-title">Societies for you</h2>
      <a href="/societies">See all</a>
    </div>
    {#if societies}
      {#if societies.matches.length || societies.tryNew}
        <ul class="societies">
          {#each societies.matches as society (society.nsuId)}
            <li>
              <a href={`/societies/${society.nsuId}`}>
                <strong>{society.name}</strong>
                <span class="muted">Matches your interests</span>
              </a>
            </li>
          {/each}
          {#if societies.tryNew}
            <li>
              <a href={`/societies/${societies.tryNew.nsuId}`}>
                <strong>{societies.tryNew.name}</strong>
                <span class="tag">Try something new</span>
              </a>
            </li>
          {/if}
        </ul>
      {/if}
      {#if !societies.matches.length}
        <p class="muted">Tell us what you’re into on <a href="/about-you">What the chat knows about you</a>, and we’ll pick some for you.</p>
      {/if}
    {:else}
      <p class="muted" role="status">Loading…</p>
    {/if}
  </section>

  <BottomNav />
</main>

<style>
  .waiting {
    visibility: hidden;
  }

  .hero {
    margin: 8px 0 18px;
  }

  .hero-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .hero h1 {
    font-size: 30px;
    margin: 0 0 2px;
  }

  .lead {
    margin: 0;
    color: var(--ink-3);
  }

  /* Need help now, always in view: a soft red pill at the top right. */
  .help-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--danger-line);
    border-radius: var(--radius-pill);
    background: var(--danger-soft);
    color: var(--danger-ink);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  .dash {
    margin: 12px 0;
  }

  .dash-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .dash h2 {
    margin: 0;
    font-size: 17px;
  }

  .dash h2 a {
    color: inherit;
    text-decoration: none;
  }

  .dash p {
    margin: 0 0 8px;
  }

  /* How far along they are, as a bar. */
  .bar {
    height: 8px;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--line);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--mint);
    transition: width var(--dur-3) var(--ease-out);
  }

  .next-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
  }

  .next {
    font-weight: 500;
  }

  .next-row .next {
    margin: 0;
    min-width: 0;
  }

  .do {
    display: inline-flex;
    align-items: center;
    flex: none;
    width: auto;
    min-height: 40px;
    margin: 0;
    padding: 8px 14px;
    font-size: 15px;
  }

  .name {
    font-size: 18px;
    font-weight: 600;
  }

  /* The way into the chat: like a search box, so it reads as "ask here". */
  .ask {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 12px 0;
    padding: 14px;
    border-radius: var(--radius-l);
    color: var(--ink);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-2);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .ask-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    color: white;
    background: var(--violet);
    flex: none;
  }

  .ask-words {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .ask-words strong {
    font-size: 17px;
    font-weight: 600;
  }

  .ask-words span {
    color: var(--ink-3);
    font-size: 14px;
  }

  .ask-go {
    color: var(--ink-3);
    flex: none;
  }

  .ask:active {
    transform: scale(0.98);
    transition-duration: var(--dur-tap);
  }

  .societies {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .societies li + li {
    border-top: 1px solid var(--line);
  }

  .societies a {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 0;
    color: var(--ink);
    text-decoration: none;
  }

  .societies .muted {
    font-size: 14px;
  }

  .tag {
    align-self: flex-start;
    padding: 1px 8px;
    border-radius: var(--radius-s);
    background: var(--sun-soft);
    color: var(--sun-ink);
    font-size: 13px;
    font-weight: 600;
  }

  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
