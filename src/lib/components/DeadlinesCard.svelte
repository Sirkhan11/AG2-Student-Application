<script>
  import { onMount } from 'svelte';
  import { currentUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { loadDeadlines } from '#lib/deadlines/read.js';
  import { comingDeadlines, dueWords } from '#lib/deadlines/show.js';

  /**
   * Your deadlines, on Home and the checklist: the next few from the student's own Blackboard
   * calendar (deadlines/read.js: the link they pasted is kept on the phone, and the deadlines are read
   * through the app's function at most every four hours), or, before they've pasted it, the way to.
   * Connecting, the full list and forgetting are on /deadlines. Nothing here goes to Gemini.
   * @type {{ limit?: number }}
   */
  let { limit = 3 } = $props();

  /** What to show, or null while it's being worked out. */
  let view = $state(/** @type {import('#lib/deadlines/read.js').DeadlinesView | null} */ (null));

  onMount(() =>
    watchSignedIn(async (signedIn) => {
      const uid = signedIn ? currentUid() : null;
      view = uid ? await loadDeadlines(uid) : { state: 'not-connected' };
    })
  );

  let coming = $derived(view?.state === 'ready' ? comingDeadlines(view.deadlines).slice(0, limit) : []);
</script>

<section class="card deadlines" aria-labelledby="deadlines-title">
  <div class="head">
    <h2 id="deadlines-title"><a href="/deadlines">Your deadlines</a></h2>
    {#if view?.state === 'ready'}
      <a href="/deadlines">See all</a>
    {/if}
  </div>

  {#if view === null}
    <p class="muted" role="status">Loading…</p>
  {:else if view.state === 'not-connected'}
    <p>What’s due, from your own Blackboard calendar. Paste its link once and your deadlines show here.</p>
    <a class="secondary-button do" href="/deadlines">Show my deadlines</a>
  {:else}
    {#if coming.length}
      <ul>
        {#each coming as deadline (deadline.id)}
          <li>
            <span class="title">{deadline.title}</span>
            <span class="muted">{dueWords(deadline)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p>Nothing due in the year ahead on your Blackboard calendar.</p>
    {/if}
    {#if view.problem}
      <p class="muted small" role="status">{view.problem} These are from the last time it was read.</p>
    {/if}
  {/if}
</section>

<style>
  .deadlines {
    margin: 12px 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .head h2 {
    margin: 0;
    font-size: 17px;
  }

  .head h2 a {
    color: inherit;
    text-decoration: none;
  }

  .deadlines p {
    margin: 0 0 8px;
  }

  .small {
    font-size: 14px;
  }

  .do {
    display: inline-flex;
    align-items: center;
    width: auto;
    min-height: 40px;
    margin: 0;
    padding: 8px 14px;
    font-size: 15px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 0;
  }

  li + li {
    border-top: 1px solid var(--line);
  }

  .title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  li .muted {
    font-size: 14px;
  }
</style>
