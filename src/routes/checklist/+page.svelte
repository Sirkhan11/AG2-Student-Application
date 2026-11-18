<script>
  import { tick } from 'svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import BlackboardSection from '#lib/components/BlackboardSection.svelte';
  import Ask4HelpLink from '#lib/components/Ask4HelpLink.svelte';
  import Burst from '#lib/components/Burst.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import ProgressRing from '#lib/components/ProgressRing.svelte';
  import { buzz } from '#lib/motion.js';
  import { howToFor, isOutside } from '#lib/checklist/how-to.js';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { loadMyRecord, saveChange } from '#lib/checklist/store.js';
  import { createChecklistSync } from '#lib/checklist/sync.js';
  import {
    ChecklistError,
    isDefault,
    makeAdd,
    makeDelete,
    makeEdit,
    makeTick,
    MAX_TASKS,
    MAX_TITLE_LENGTH
  } from '#lib/checklist/tasks.js';

  /** @typedef {import('#lib/checklist/tasks.js').Task} Task */
  /** @typedef {import('#lib/checklist/tasks.js').Change} Change */
  /** @typedef {import('#lib/checklist/sync.js').Problem} Problem */

  let loading = $state(true);
  let loadFailed = $state(false);
  let tasks = $state(/** @type {Task[]} */ ([]));
  // Something to tell the student about saving (see sync.js), and how many changes are still saving.
  let problem = $state(/** @type {Problem | null} */ (null));
  let waiting = $state(0);
  // Read out by screen readers but not shown, such as "All changes saved."
  let announcement = $state('');

  let newTitle = $state('');
  let addError = $state('');
  let editingId = $state(/** @type {string | null} */ (null));
  let editTitle = $state('');
  let editError = $state('');

  // Keeps the list on screen in step with the saved one. Not $state: the page shows `tasks` instead.
  /** @type {ReturnType<typeof createChecklistSync> | null} */
  let sync = null;

  let completed = $derived(tasks.filter((task) => task.done).length);
  let full = $derived(tasks.length >= MAX_TASKS);
  let allDone = $derived(tasks.length > 0 && completed === tasks.length);

  // The task just ticked here, for its little celebration, and whether that tick finished the whole
  // list, for a bigger one. Nothing celebrates when the page opens.
  let justTicked = $state(/** @type {string | null} */ (null));
  let cheer = $state(false);

  // null while Firebase checks for a saved login. Logged-out visitors are sent to log in by the root
  // layout, which brings them back here.
  let signedIn = $state(/** @type {boolean | null} */ (null));

  $effect(() =>
    watchSignedIn((value) => {
      signedIn = value;
      if (value) {
        load();
      } else {
        // Logged out (perhaps on another tab): their list goes from the screen too.
        sync = null;
        tasks = [];
      }
    })
  );

  /** Home or international, from sign-up (student-type.js): the how-tos leave out or add what applies. */
  let studentType = $state(/** @type {import('#lib/students/student-type.js').StudentType | null} */ (null));

  async function load() {
    loading = true;
    loadFailed = false;
    try {
      const record = await loadMyRecord();
      studentType = record.studentType;
      sync = createChecklistSync(record.checklist.tasks, {
        save: saveChange,
        onUpdate: (state) => {
          if (waiting > 0 && state.waiting === 0 && state.problem === null) announcement = 'All changes saved.';
          tasks = state.tasks;
          problem = state.problem;
          waiting = state.waiting;
        }
      });
      tasks = sync.tasks;
    } catch (err) {
      console.error(err);
      loadFailed = true;
    } finally {
      loading = false;
    }
  }

  /**
   * Shows a change straight away and saves it in the background.
   * @param {Change} change
   */
  function record(change) {
    sync?.record(change);
  }

  /**
   * Ticks or unticks a task, celebrating a tick (and more if it was the last one).
   * @param {Task} task
   * @param {boolean} done
   */
  function tickTask(task, done) {
    const last = done && tasks.every((other) => other.id === task.id || other.done);
    record(makeTick(task.id, done));
    justTicked = done ? task.id : null;
    cheer = last;
    if (done) buzz(last ? [14, 70, 24] : 12);
  }

  function addTask() {
    addError = '';
    try {
      record(makeAdd(newTitle));
      newTitle = '';
    } catch (err) {
      if (!(err instanceof ChecklistError)) throw err;
      addError = err.message;
    }
  }

  /** @param {Task} task */
  async function removeTask(task) {
    record(makeDelete(task.id));
    announcement = `Deleted ${task.title}.`;
    // The button that had focus has gone, so move focus somewhere sensible.
    await tick();
    document.getElementById('new-task')?.focus();
  }

  /** @param {Task} task */
  async function startEdit(task) {
    editingId = task.id;
    editTitle = task.title;
    editError = '';
    await tick();
    document.getElementById(`edit-${task.id}`)?.focus();
  }

  /**
   * Saves or cancels a rename, then puts focus back on that task's Edit button.
   * @param {string} id
   * @param {boolean} keep
   */
  async function finishEdit(id, keep) {
    if (keep) {
      try {
        record(makeEdit(id, editTitle));
      } catch (err) {
        if (!(err instanceof ChecklistError)) throw err;
        editError = err.message;
        return;
      }
    }
    editingId = null;
    await tick();
    document.getElementById(`edit-button-${id}`)?.focus();
  }
</script>

<main class="page">
  <h1>Your checklist</h1>
  <p class="muted">
    Complete these tasks to help you settle in. Your checklist is saved to your account, so it’s the
    same on any device. Tap a task’s button to do it, and open “How to” under it for the steps (and to delete it).
  </p>
  <Ask4HelpLink />

  <p class="visually-hidden" role="status">{announcement}</p>

  <!-- Logged-out visitors never get here: the root layout sends them to log in (see account-gate.js). -->
  {#if signedIn !== true || loading}
    <p class="muted">Loading your checklist…</p>
  {:else if loadFailed}
    <p class="error" role="alert">We couldn’t load your checklist. Please check your connection.</p>
    <button class="primary-button" onclick={load}>Try again</button>
  {:else}
    <div class="card progress-card" class:all-done={allDone}>
      <span class="ring">
        <ProgressRing done={completed} total={tasks.length} size={86} decorative />
        {#if cheer && allDone}
          <Burst count={24} spread={120} />
        {/if}
      </span>
      <div class="progress-words">
        <p id="progress-label"><strong>{completed} of {tasks.length} completed</strong></p>
        <p class="muted">
          {allDone ? 'All done! You’ve ticked off everything.' : tasks.length - completed === 1 ? 'One to go.' : `${tasks.length - completed} to go, one at a time.`}
        </p>
        <progress class="visually-hidden" aria-labelledby="progress-label" value={completed} max={tasks.length || 1}></progress>
      </div>
      {#if allDone}
        <span class="cheer"><Icon name="check" size={22} stroke={3} /></span>
      {/if}
    </div>

    {#if problem}
      <div class="notice" class:offline={problem.kind === 'offline'} role="alert">
        <p>{problem.message}</p>
        {#if problem.kind === 'error'}
          <button class="secondary-button" onclick={() => sync?.retry()}>Try again</button>
        {/if}
      </div>
    {/if}

    <ul class="tasks">
      {#each tasks as task (task.id)}
        <li class="task" class:done={task.done} class:pop={justTicked === task.id}>
          {#if editingId === task.id}
            <form
              class="edit"
              onsubmit={(event) => {
                event.preventDefault();
                finishEdit(task.id, true);
              }}
            >
              <label for={`edit-${task.id}`}>Rename “{task.title}”</label>
              <input
                id={`edit-${task.id}`}
                class="field"
                maxlength={MAX_TITLE_LENGTH}
                bind:value={editTitle}
                onkeydown={(event) => {
                  if (event.key === 'Escape') finishEdit(task.id, false);
                }}
              />
              {#if editError}
                <p class="error" role="alert">{editError}</p>
              {/if}
              <div class="row">
                <button class="secondary-button" type="submit">Save</button>
                <button class="secondary-button" type="button" onclick={() => finishEdit(task.id, false)}>
                  Cancel
                </button>
              </div>
            </form>
          {:else}
            {@const howTo = howToFor(task.id, studentType)}
            <div class="task-row">
              <span class="box">
                <input
                  type="checkbox"
                  id={`task-${task.id}`}
                  checked={task.done}
                  onchange={(event) => tickTask(task, event.currentTarget.checked)}
                />
                {#if justTicked === task.id && task.done}
                  <Burst count={10} spread={44} />
                {/if}
              </span>
              <label for={`task-${task.id}`} class:finished={task.done}><span class="title">{task.title}</span></label>
              {#if howTo?.do && !task.done}
                <!-- The screen in the app that gets it done, as on the wireframe ("Find one", "Browse"). -->
                <a class="secondary-button do" href={howTo.do.href}>{howTo.do.label}<span class="visually-hidden">: {task.title}</span></a>
              {/if}
              {#if !isDefault(task.id)}
                <button
                  id={`edit-button-${task.id}`}
                  class="icon-button"
                  onclick={() => startEdit(task)}
                  aria-label={`Edit ${task.title}`}
                >
                  <Icon name="edit" size={19} />
                </button>
              {/if}
            </div>
            <!-- How to do it (the standard tasks: how-to.js), and Ask4Help for every task. -->
            <details class="how-to">
              <summary>{howTo ? 'How to' : 'Stuck?'}<span class="visually-hidden">: {task.title}</span></summary>
              {#if howTo}
                <ol>
                  {#each howTo.steps as step, i (i)}
                    <li>{step}</li>
                  {/each}
                </ol>
                {#if howTo.pointer}
                  <p class="pointer"><a href={howTo.pointer.href}>{howTo.pointer.label}</a></p>
                {/if}
                {#if isOutside(howTo.link)}
                  <a class="secondary-button" href={howTo.link.href} target="_blank" rel="noopener noreferrer" aria-label={`${howTo.link.label} (opens in a new tab)`}>{howTo.link.label} ↗</a>
                {:else}
                  <a class="secondary-button" href={howTo.link.href}>{howTo.link.label}</a>
                {/if}
                <p class="sources">
                  {howTo.sources.length > 1 ? 'Sources:' : 'Source:'}
                  {#each howTo.sources as source, i (source.href)}
                    <a href={source.href} target="_blank" rel="noopener noreferrer" aria-label={`${source.label} (opens in a new tab)`}>{source.label} ↗</a>{i < howTo.sources.length - 1 ? '; ' : ''}
                  {/each}
                </p>
              {/if}
              <!-- Deleting lives here rather than on every row, so the bin isn't the most prominent thing on the page. -->
              <button class="secondary-button delete-task" type="button" onclick={() => removeTask(task)} aria-label={`Delete ${task.title}`}>Delete this task</button>
              <Ask4HelpLink about={task.title} />
            </details>
          {/if}
        </li>
      {/each}
    </ul>

    <form
      class="add card"
      onsubmit={(event) => {
        event.preventDefault();
        addTask();
      }}
    >
      <label for="new-task">Add your own task</label>
      <input
        id="new-task"
        class="field"
        placeholder="For example, buy a desk lamp"
        maxlength={MAX_TITLE_LENGTH}
        aria-describedby="task-limits"
        disabled={full}
        bind:value={newTitle}
      />
      <p id="task-limits" class="muted">
        {full
          ? `You’ve reached ${MAX_TASKS} tasks. Delete one to add another.`
          : `Up to ${MAX_TASKS} tasks, ${MAX_TITLE_LENGTH} characters each.`}
      </p>
      {#if addError}
        <p class="error" role="alert">{addError}</p>
      {/if}
      <button class="primary-button" type="submit" disabled={full}><Icon name="plus" size={20} stroke={2.6} /> Add task</button>
    </form>
  {/if}

  {#if signedIn === true}
    <BlackboardSection />
  {/if}

  <BottomNav />
</main>

<style>
  /* How far they've got: the ring fills, and finishing everything gets a cheer. */
  .progress-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 18px 0;
    overflow: visible;
  }

  .progress-card.all-done {
    border-color: #bfe9cf;
  }

  .ring {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
  }

  .progress-words {
    flex: 1;
    min-width: 0;
  }

  .progress-words p {
    margin: 0;
  }

  .progress-words strong {
    font-size: 18px;
    font-weight: 650;
  }

  /* All done: a green tick badge. */
  .cheer {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: white;
    background: var(--mint);
    flex: none;
  }

  .tasks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .task {
    padding: 4px 6px 0 12px;
    border-radius: var(--radius-m);
    background: white;
    border: 1px solid var(--line);
    transition: background-color var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
  }

  .task.done {
    background: white;
  }

  .task-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .box {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
  }

  /* A round box that springs when it's ticked. */
  .task input[type='checkbox'] {
    appearance: none;
    -webkit-appearance: none;
    flex: none;
    width: 30px;
    height: 30px;
    margin: 0;
    border-radius: 50%;
    border: 2px solid #c9c9d3;
    background: white center / 18px no-repeat;
    cursor: pointer;
    transition:
      background-color var(--dur-1) var(--ease-out),
      border-color var(--dur-1) var(--ease-out),
      transform var(--dur-2) var(--ease-bounce);
  }

  .task input[type='checkbox']:checked {
    border-color: var(--mint);
    background-color: var(--mint);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E");
  }

  /* The label is the big tap target: tapping the words ticks the box. */
  .task-row > label {
    flex: 1;
    min-height: 46px;
    display: flex;
    align-items: center;
    cursor: pointer;
    overflow-wrap: anywhere;
    font-weight: 500;
  }

  /* Done: a line drawn through it, and the words go quiet. */
  .title {
    background: linear-gradient(currentColor, currentColor) no-repeat 0 55% / 0% 2px;
    transition: background-size var(--dur-3) var(--ease-out), color var(--dur-2) var(--ease-out);
  }

  .finished .title {
    color: var(--ink-3);
    background-size: 100% 2px;
  }

  .icon-button {
    flex: none;
    display: grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--ink-3);
    transition: transform var(--dur-2) var(--ease-bounce), color var(--dur-1) ease;
  }

  .icon-button:hover {
    color: var(--violet);
  }

  /* The button that does the task: small, beside its name. */
  .do {
    flex: none;
    display: inline-flex;
    align-items: center;
    width: auto;
    min-height: 36px;
    margin: 0;
    padding: 6px 12px;
    font-size: 14px;
  }

  .delete-task {
    display: inline-flex;
    align-items: center;
    width: auto;
    margin: 8px 0 4px;
    color: var(--danger-ink);
  }

  .edit {
    flex: 1;
    padding: 8px 0;
  }

  /* Under the task's name, lined up with it. */
  .how-to {
    margin: 0 0 6px 40px;
  }

  .how-to summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    color: var(--violet-ink);
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    list-style: none;
  }

  .how-to summary::-webkit-details-marker {
    display: none;
  }

  .how-to summary::after {
    content: '';
    width: 7px;
    height: 7px;
    border-right: 2.5px solid currentColor;
    border-bottom: 2.5px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .how-to[open] summary::after {
    transform: translateY(1px) rotate(225deg);
  }

  .how-to[open] {
    padding: 0 12px 12px;
    margin-left: 28px;
    border-radius: var(--radius-s);
    background: var(--panel);
  }

  .how-to ol {
    margin: 0 0 12px;
    padding-left: 20px;
  }

  .how-to li + li {
    margin-top: 6px;
  }

  .sources {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--ink-3);
  }

  .edit .field {
    margin-bottom: 8px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .notice {
    margin: 12px 0;
    padding: 12px 14px;
    border: 1px solid #f5b6a7;
    border-radius: var(--radius-m);
    background: var(--coral-soft);
  }

  .notice.offline {
    border-color: var(--line);
    background: white;
  }

  .notice p {
    margin: 0 0 8px;
  }

  .add {
    margin-top: 24px;
  }

  .add label {
    font-size: 17px;
  }

  .add .primary-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .task input[type='checkbox']:active,
    .icon-button:active {
      transform: scale(0.82);
      transition-duration: var(--dur-tap);
    }

    /* Just ticked: the box pops, and the card gives a little hop. */
    .pop input[type='checkbox']:checked {
      animation: box-pop var(--dur-3) var(--ease-bounce);
    }

    .pop.done {
      animation: hop var(--dur-3) var(--ease-spring);
    }

    .all-done .cheer {
      animation: cheer-in var(--dur-4) var(--ease-bounce) both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .task,
    .title,
    .icon-button,
    .task input[type='checkbox'] {
      transition: none;
    }

    .how-to summary::after {
      transition: none;
    }
  }

  @keyframes box-pop {
    0% {
      transform: scale(0.55);
    }
  }

  @keyframes hop {
    40% {
      transform: translateY(-3px) scale(1.012);
    }
  }

  @keyframes cheer-in {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.6) rotate(-12deg);
    }
  }
</style>
