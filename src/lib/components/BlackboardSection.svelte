<script>
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { currentUid } from '#lib/firebase/auth.js';
  import { connectBlackboard, disconnectBlackboard, loadBlackboard } from '#lib/blackboard/api.js';
  import { closeGuide, guideDone, markSeen, newIds } from '#lib/blackboard/seen.js';
  import { agoText, dueText, topThing, whenText } from '#lib/blackboard/priority.js';
  import { deadlineEntry, eventEntry } from '#lib/blackboard/ics.js';
  import AddToCalendar from '#lib/components/AddToCalendar.svelte';

  /**
   * The checklist's Blackboard section. Before connecting: one step, saying what it reads and that
   * they can disconnect at any time. After: a card per module with its most important thing at the
   * top, and the rest (deadlines, dates, what's new, announcements, everything released so far) one
   * tap away. Every date has "Add to calendar": Outlook on the web or a calendar file (see
   * AddToCalendar.svelte). Nothing from here goes to Gemini.
   *
   * preview is for the development preview page only: a made-up view and user, so the layout can be
   * checked without signing in or a server.
   * @type {{ preview?: { view: import('#lib/blackboard/shapes.js').BlackboardView, uid: string, now: number } }}
   */
  let { preview } = $props();

  /** What Blackboard said, or null while loading. */
  let view = $state(/** @type {import('#lib/blackboard/shapes.js').BlackboardView | null} */ (null));
  /** True while connecting or disconnecting. */
  let busy = $state(false);
  /** What just happened (connected, denied, disconnected...). */
  let message = $state('');
  /** Which modules are showing everything. */
  let open = $state(/** @type {Record<string, boolean>} */ ({}));
  /** The ids of what's new in each module (seen.js), worked out when the section loads. */
  let fresh = $state(/** @type {Record<string, Set<string>>} */ ({}));
  let showGuide = $state(false);

  const uid = () => preview?.uid ?? currentUid();
  const now = () => preview?.now ?? Date.now();

  /** What the address says after Blackboard sends the student back. */
  const OUTCOMES = /** @type {Record<string, string>} */ ({
    connected: 'Blackboard is connected.',
    denied: 'You didn’t allow access, so nothing was connected.',
    failed: 'Connecting to Blackboard didn’t work. Please try again.',
    unavailable: 'Blackboard isn’t answering right now. Please try again later.',
    // Until IT register AG2 with Blackboard (see isNotRegistered in flow.js).
    'not-registered': 'Northumbria’s Blackboard hasn’t switched AG2 on yet, so it can’t connect for now. Please try again later.'
  });

  /** The words before a module's most important thing. */
  const LABELS = { 'past-due': 'Due date passed:', 'due-soon': 'Due soon:', announcement: 'New announcement:', content: 'New:', next: 'Next deadline:', nothing: '' };

  async function load() {
    view = null;
    const loaded = preview ? preview.view : await loadBlackboard();
    const id = uid();
    if ('modules' in loaded && id) {
      fresh = Object.fromEntries(loaded.modules.map((module) => [module.id, newIds(id, module, now())]));
      showGuide = !guideDone(id);
    }
    view = loaded;
  }

  onMount(() => {
    const outcome = page.url.searchParams.get('blackboard');
    if (outcome && OUTCOMES[outcome]) {
      message = OUTCOMES[outcome];
      const tidy = new URL(page.url.href);
      tidy.searchParams.delete('blackboard');
      replaceState(tidy, page.state);
    }
    load();
  });

  async function connect() {
    busy = true;
    message = '';
    if (preview) {
      busy = false;
      return;
    }
    try {
      await connectBlackboard();
    } catch (err) {
      console.error('Connecting Blackboard did not start:', err instanceof Error ? err.message : err);
      message = 'We couldn’t start connecting to Blackboard. Please try again.';
      busy = false;
    }
  }

  async function disconnect() {
    busy = true;
    try {
      if (!preview) await disconnectBlackboard();
      view = { connected: false, reason: 'not-connected' };
      open = {};
      // How students remove an app themselves, from Anthology's help page "Authorize access to
      // integrated apps". Still to check on Northumbria's Blackboard once IT registers the app.
      message =
        'Disconnected: AG2 no longer keeps anything from your Blackboard. To take away its access in Blackboard too, go to Tools, then Application Authorization, and choose Revoke next to AG2.';
    } catch (err) {
      console.error('Disconnecting Blackboard failed:', err instanceof Error ? err.message : err);
      message = 'We couldn’t disconnect just now. Please try again.';
    } finally {
      busy = false;
    }
  }

  /** Shows or hides everything for a module; opening it marks what's there as seen for next time. @param {import('#lib/blackboard/shapes.js').Module} module */
  function toggle(module) {
    open[module.id] = !open[module.id];
    const id = uid();
    if (open[module.id] && id) markSeen(id, module);
  }

  function finishGuide() {
    const id = uid();
    if (id) closeGuide(id);
    showGuide = false;
  }

  /** @param {import('#lib/blackboard/shapes.js').Task} task */
  const passed = (task) => Date.parse(task.due) < now();
</script>

<section class="card blackboard" id="blackboard" aria-labelledby="blackboard-title">
  <h2 id="blackboard-title">Your modules on Blackboard</h2>

  {#if message}
    <p class="note" role="status">{message}</p>
  {/if}

  {#if view === null}
    <p class="muted" role="status">Loading Blackboard…</p>
  {:else if !view.connected}
    {#if view.reason === 'not-set-up'}
      <p class="muted">Blackboard isn’t set up on this server yet.</p>
    {:else}
      <p>{view.reason === 'reconnect' ? 'Your Blackboard connection needs renewing.' : 'See every module’s deadlines, new content and announcements here.'}</p>
      <p class="muted small">
        AG2 reads your modules, deadlines, new content and announcements, never your grades. You sign
        in on Northumbria’s Blackboard, not here, and you can disconnect at any time.
      </p>
      <button class="primary-button" type="button" onclick={connect} disabled={busy}>
        {view.reason === 'reconnect' ? 'Reconnect Blackboard' : 'Connect Blackboard'}
      </button>
    {/if}
  {:else if 'error' in view}
    <p>Blackboard isn’t answering right now. You’re still connected.</p>
    <button class="secondary-button" type="button" onclick={load}>Try again</button>
  {:else}
    {#if view.mock}
      <p class="mock">Pretend Blackboard, for testing</p>
    {/if}
    <p class="muted small">
      Blackboard only shows what tutors have added, so check your module pages too. A passed due date
      stays flagged even if you’ve handed the work in, as AG2 can’t see submissions.
    </p>

    {#if view.modules.length === 0}
      <p>No modules for this term on Blackboard yet.</p>
    {/if}

    {#each view.modules as module (module.id)}
      {@const isNew = fresh[module.id] ?? new Set()}
      {@const top = topThing(module, isNew, now())}
      <article class="module" aria-labelledby={`module-${module.id}`}>
        <h3 id={`module-${module.id}`}>{module.name}</h3>
        <p class="muted small">{module.code}{#if isNew.size}<span class="badge">{isNew.size} new</span>{/if}</p>

        <div class={`top ${top.kind}`}>
          <p>
            {#if LABELS[top.kind]}<strong>{LABELS[top.kind]}</strong>{/if}
            {top.title}
          </p>
          {#if top.task}
            <p class="small">{dueText(top.task.due, now())}</p>
            <AddToCalendar entry={deadlineEntry(top.task, module.name)} />
          {/if}
        </div>

        <button class="secondary-button toggle" type="button" aria-expanded={open[module.id] ? 'true' : 'false'} onclick={() => toggle(module)}>
          {open[module.id] ? 'Show less' : 'Show everything'}
        </button>

        {#if open[module.id]}
          <div class="all">
            <h4>Deadlines</h4>
            {#if module.tasks.length}
              <ul>
                {#each module.tasks as task (task.id)}
                  <li class:passed={passed(task)}>
                    {#if passed(task)}<span class="flag">Due date passed</span>{/if}
                    {task.title}
                    <span class="muted small">{dueText(task.due, now())}</span>
                    <AddToCalendar entry={deadlineEntry(task, module.name)} />
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted small">No deadlines on Blackboard for this module.</p>
            {/if}
            {#if module.partial.includes('tasks')}
              <p class="muted small">This module doesn’t show its gradebook to students, so these come from its calendar.</p>
            {/if}

            {#if module.events.length}
              <h4>Dates</h4>
              <ul>
                {#each module.events as event (event.id)}
                  <li>
                    {event.title}
                    <span class="muted small">{whenText(event.start)}</span>
                    <AddToCalendar entry={eventEntry(event, module.name)} />
                  </li>
                {/each}
              </ul>
            {/if}

            {#if module.announcements.length}
              <h4>Announcements</h4>
              <ul>
                {#each module.announcements as item (item.id)}
                  <li>
                    {#if isNew.has(item.id)}<span class="badge">New</span>{/if}
                    <strong>{item.title}</strong>
                    <span class="muted small">{agoText(item.posted, now())}</span>
                    <span class="text">{item.text}</span>
                  </li>
                {/each}
              </ul>
            {/if}

            <h4>Released so far</h4>
            {#if module.content.length}
              <details>
                <summary>
                  {module.content.length} items{#if module.content.some((item) => isNew.has(item.id))}, {module.content.filter((item) => isNew.has(item.id)).length} new{/if}
                </summary>
                <ul>
                  {#each module.content as item (item.id)}
                    <li class:folder={item.kind === 'folder'}>
                      {#if isNew.has(item.id)}<span class="badge">New</span>{/if}
                      {#if item.url}
                        <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} on Blackboard (opens in a new tab)`}>{item.title} ↗</a>
                      {:else}
                        {item.title}
                      {/if}
                      <span class="muted small">{agoText(item.created, now())}</span>
                    </li>
                  {/each}
                </ul>
              </details>
            {:else}
              <p class="muted small">Nothing released on Blackboard yet.</p>
            {/if}

            {#if module.url}
              <a class="open" href={module.url} target="_blank" rel="noopener noreferrer" aria-label={`${module.name} on Blackboard (opens in a new tab)`}>Open the module on Blackboard ↗</a>
            {/if}
          </div>
        {/if}
      </article>
    {/each}

    {#if showGuide}
      <aside class="guide" aria-labelledby="outlook-guide">
        <h3 id="outlook-guide">Keep every deadline in Outlook</h3>
        <ol>
          <li>In Blackboard, open your Calendar, then its settings, and copy the link for sharing your calendar.</li>
          <li>In Outlook, choose Add calendar, then Subscribe from web, and paste the link.</li>
        </ol>
        <p class="muted small">The link goes from Blackboard straight to Outlook: AG2 never sees it. Outlook then keeps your deadlines up to date.</p>
        <button class="secondary-button" type="button" onclick={finishGuide}>Got it</button>
      </aside>
    {/if}

    <div class="footer">
      <button class="link" type="button" onclick={load}>Refresh</button>
      <button class="link" type="button" onclick={disconnect} disabled={busy}>Disconnect Blackboard</button>
    </div>
  {/if}
</section>

<style>
  .blackboard h2 {
    margin-top: 0;
  }

  .small {
    font-size: 13px;
  }

  .note {
    padding: 10px 12px;
    border-radius: 10px;
    background: #eaf2f8;
  }

  .mock {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    background: #fff3cd;
    color: #4d3800;
    font-size: 13px;
    font-weight: bold;
  }

  .module {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .module h3 {
    margin: 0;
    font-size: 17px;
  }

  .module > p {
    margin: 2px 0 8px;
  }

  .badge {
    display: inline-block;
    margin: 0 6px;
    padding: 1px 8px;
    border-radius: 10px;
    background: #e3f1e6;
    color: #1d5e2c;
    font-size: 12px;
    font-weight: bold;
  }

  .top {
    padding: 10px 12px;
    border-radius: 10px;
    background: #f1f6f9;
  }

  .top p {
    margin: 0;
  }

  .top.past-due {
    background: #fdecea;
  }

  .top.due-soon {
    background: #fff3cd;
  }

  .toggle {
    width: 100%;
    margin-top: 8px;
  }

  .all h4 {
    margin: 14px 0 4px;
    font-size: 15px;
  }

  .all ul {
    margin: 0;
    padding-left: 18px;
  }

  .all li {
    margin: 6px 0;
  }

  .all li > .small,
  .all li > .text {
    display: block;
  }

  .flag {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 8px;
    border-radius: 10px;
    background: #fdecea;
    color: #8a1c13;
    font-size: 12px;
    font-weight: bold;
  }

  .folder {
    font-weight: bold;
  }

  .link {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--primary);
    font-size: 14px;
    text-decoration: underline;
  }

  .open {
    display: block;
    margin-top: 10px;
  }

  details summary {
    min-height: 36px;
    cursor: pointer;
    color: var(--primary);
  }

  .guide {
    margin-top: 16px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #fbfcfd;
  }

  .guide h3 {
    margin: 0 0 6px;
    font-size: 16px;
  }

  .guide ol {
    margin: 0 0 6px;
    padding-left: 18px;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    margin-top: 14px;
  }
</style>
