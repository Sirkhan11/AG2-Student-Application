<script>
  import { onMount } from 'svelte';
  import AddToCalendar from '#lib/components/AddToCalendar.svelte';
  import BackLink from '#lib/components/BackLink.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { currentUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { connectDeadlines, DeadlinesError, disconnectDeadlines, loadDeadlines } from '#lib/deadlines/read.js';
  import { calendarEntryFor, dueWords, readAgo, splitDeadlines } from '#lib/deadlines/show.js';
  import { CALENDAR_LINK_PREFIX } from '#shared/calendar-link.js';

  // Your deadlines: what's due, from the student's own Blackboard calendar. Blackboard gives every
  // student a private link to it; pasted here once, the app's function reads the calendar through it
  // (deadlines/read.js) and the deadlines show here, on Home and on the checklist. The link stays on
  // the phone (deadlines/store.js), can be forgotten here at any time, and goes when they log out.
  // These are deadlines from the calendar and nothing else: most don't say which module, and the full
  // Blackboard connection (modules, announcements, new content) still waits for IT.

  /** What's showing, or null until the kept deadlines have been loaded. */
  let view = $state(/** @type {import('#lib/deadlines/read.js').DeadlinesView | null} */ (null));
  /** What's been pasted. */
  let link = $state('');
  let busy = $state(false);
  /** What's wrong with the link, or what went wrong reading it, in words. */
  let problem = $state('');
  let confirmingForget = $state(false);

  onMount(() =>
    watchSignedIn((signedIn) => {
      if (signedIn) load();
      // Logged out: the root layout sends them to log in (account-gate.js).
    })
  );

  /** @param {boolean} [refresh] read the calendar again now, rather than only when the kept ones are old */
  async function load(refresh = false) {
    const uid = currentUid();
    if (!uid) return;
    busy = refresh;
    view = await loadDeadlines(uid, { refresh });
    busy = false;
  }

  /** @param {SubmitEvent} event */
  async function connect(event) {
    event.preventDefault();
    problem = '';
    busy = true;
    try {
      const uid = currentUid();
      if (!uid) throw new DeadlinesError('Log in first.');
      await connectDeadlines(uid, link);
      link = '';
      await load();
    } catch (err) {
      problem = err instanceof DeadlinesError ? err.message : 'We couldn’t read your deadlines just now. Try again in a minute.';
    } finally {
      busy = false;
    }
  }

  function forget() {
    const uid = currentUid();
    if (uid) disconnectDeadlines(uid);
    confirmingForget = false;
    problem = '';
    view = { state: 'not-connected' };
  }
</script>

<main class="page">
  <BackLink />
  <h1>Your deadlines</h1>

  {#if view === null}
    <p class="muted" role="status">Loading…</p>
  {:else if view.state === 'not-connected'}
    <p class="muted">
      What’s due, from your own Blackboard calendar, here and on Home. Blackboard gives you a private link
      to that calendar: paste it once.
    </p>

    <section class="card" aria-labelledby="copy-title">
      <h2 id="copy-title">Copy the link in Blackboard</h2>
      <ol>
        <li>Open <strong>Calendar</strong>.</li>
        <li>Tap the cog (<strong>Calendar Settings</strong>), then the three dots (<strong>More options</strong>).</li>
        <li>Choose <strong>Share calendar</strong>, then <strong>Copy</strong>.</li>
      </ol>
      <form onsubmit={connect}>
        <label for="calendar-link">Paste it here</label>
        <input
          id="calendar-link"
          class="field"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder={`${CALENDAR_LINK_PREFIX}…`}
          aria-describedby="link-help"
          bind:value={link}
        />
        {#if problem}
          <p class="error" role="alert">{problem}</p>
        {/if}
        <button class="primary-button" type="submit" disabled={busy}>{busy ? 'Reading your calendar…' : 'Show my deadlines'}</button>
      </form>
    </section>

    <section class="card" id="link-help" aria-labelledby="help-title">
      <h2 id="help-title">What the link lets the app see</h2>
      <ul>
        <li>
          <strong>Only your calendar:</strong> the titles and dates of what’s on your Blackboard calendar, a year
          back and a year ahead. Not your grades, modules, announcements or messages.
        </li>
        <li>
          <strong>It stays on this phone,</strong> and isn’t saved to your account. When the app reads your
          deadlines (at most every four hours), it sends the link to AG2’s own server function, which fetches
          your calendar from Blackboard, hands back the titles and dates, and keeps nothing.
        </li>
        <li>
          <strong>Treat it like a password.</strong> Anyone with the link can read your calendar without logging
          in, which is why Blackboard says to share it only with sources you trust. Forget it here at any time;
          logging out forgets it too.
        </li>
        <li><strong>Gemini, the chat’s AI, is never told it,</strong> or your deadlines.</li>
      </ul>
    </section>
  {:else}
    {@const { coming, passed } = splitDeadlines(view.deadlines)}
    <p class="muted">
      From your Blackboard calendar{#if view.readAt}, read {readAgo(view.readAt)}{/if}. Most items don’t say
      which module they’re for, so check Blackboard for the details.
    </p>
    {#if view.problem}
      <p class="notice" role="alert">{view.problem} These are from the last time it was read.</p>
    {/if}

    <section class="card" aria-labelledby="coming-title">
      <h2 id="coming-title">Coming up</h2>
      {#if coming.length}
        <ul class="deadlines">
          {#each coming as deadline (deadline.id)}
            <li>
              <span class="title">{deadline.title}</span>
              <span class="muted">{dueWords(deadline)}</span>
              <AddToCalendar entry={calendarEntryFor(deadline)} />
            </li>
          {/each}
        </ul>
      {:else}
        <p>Nothing due in the year ahead on your Blackboard calendar.</p>
      {/if}
    </section>

    {#if passed.length}
      <section class="card" aria-labelledby="passed-title">
        <h2 id="passed-title">In the last week</h2>
        <ul class="deadlines passed">
          {#each passed as deadline (deadline.id)}
            <li>
              <span class="title">{deadline.title}</span>
              <span class="muted">{dueWords(deadline)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="actions">
      <button class="secondary-button" type="button" onclick={() => load(true)} disabled={busy}>{busy ? 'Reading…' : 'Refresh'}</button>
      {#if confirmingForget}
        <p>Forget the link? Your deadlines go from the app on this phone; paste the link again any time.</p>
        <div class="row">
          <button class="primary-button" type="button" onclick={forget}>Forget it</button>
          <button class="secondary-button" type="button" onclick={() => (confirmingForget = false)}>Keep it</button>
        </div>
      {:else}
        <button class="secondary-button" type="button" onclick={() => (confirmingForget = true)}>Forget this link</button>
      {/if}
    </div>

    <p class="muted small">
      These are the deadlines on your Blackboard calendar and nothing else. The link stays on this phone, and
      logging out forgets it. The full Blackboard connection (your modules, announcements and new content) is
      still to come, if IT agree.
    </p>
  {/if}

  <BottomNav />
</main>

<style>
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
  }

  ol,
  ul {
    margin: 0 0 12px;
    padding-left: 20px;
  }

  li + li {
    margin-top: 6px;
  }

  form {
    margin-top: 12px;
  }

  form label {
    display: block;
    margin-bottom: 4px;
    font-weight: 600;
  }

  form .primary-button {
    margin-top: 10px;
  }

  .error {
    margin: 8px 0 0;
    color: var(--danger-ink);
  }

  .notice {
    padding: 10px 12px;
    border-radius: var(--radius-s);
    background: var(--sun-soft);
    color: var(--sun-ink);
  }

  .deadlines {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .deadlines li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 10px 0;
  }

  .deadlines li + li {
    border-top: 1px solid var(--line);
  }

  .title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .passed .title {
    color: var(--ink-3);
  }

  .deadlines .muted {
    font-size: 14px;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 16px 0 8px;
  }

  .actions p {
    margin: 4px 0 0;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row button {
    flex: 1;
  }

  .small {
    font-size: 14px;
  }
</style>
