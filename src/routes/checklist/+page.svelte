<script>
  import { tick } from 'svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import BlackboardSection from '#lib/components/BlackboardSection.svelte';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { loginPathFor } from '#lib/next-path.js';
  import { loadChecklist, saveChange } from '#lib/checklist/store.js';
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

  // null while Firebase checks for a saved login. Logged-out visitors are asked to log in (which
  // brings them back here) rather than shown a list that couldn't be saved.
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

  async function load() {
    loading = true;
    loadFailed = false;
    try {
      sync = createChecklistSync(await loadChecklist(), {
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
    same on any device.
  </p>

  <p class="visually-hidden" role="status">{announcement}</p>

  {#if signedIn === false}
    <div class="card">
      <p>Log in to keep your checklist. It’s saved to your account, so your ticks are still there next time, on any device.</p>
      <a class="primary-button" href={loginPathFor('/checklist')}>Log in</a>
    </div>
  {:else if signedIn === null || loading}
    <p class="muted">Loading your checklist…</p>
  {:else if loadFailed}
    <p class="error" role="alert">We couldn’t load your checklist. Please check your connection.</p>
    <button class="primary-button" onclick={load}>Try again</button>
  {:else}
    <div class="card">
      <p id="progress-label"><strong>{completed} of {tasks.length} completed</strong></p>
      <progress aria-labelledby="progress-label" value={completed} max={tasks.length || 1}></progress>
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
        <li class="task">
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
            <input
              type="checkbox"
              id={`task-${task.id}`}
              checked={task.done}
              onchange={(event) => record(makeTick(task.id, event.currentTarget.checked))}
            />
            <label for={`task-${task.id}`} class:finished={task.done}>{task.title}</label>
            {#if !isDefault(task.id)}
              <button
                id={`edit-button-${task.id}`}
                class="icon-button"
                onclick={() => startEdit(task)}
                aria-label={`Edit ${task.title}`}
              >
                Edit
              </button>
            {/if}
            <button class="icon-button delete" onclick={() => removeTask(task)} aria-label={`Delete ${task.title}`}>
              ×
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    <form
      class="add"
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
      <button class="primary-button" type="submit" disabled={full}>Add task</button>
    </form>
  {/if}

  {#if signedIn === true}
    <BlackboardSection />
  {/if}

  <BottomNav />
</main>

<style>
  progress {
    width: 100%;
    margin-top: 4px;
    accent-color: #1764a1;
  }

  .tasks {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .task {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border-bottom: 1px solid #e3eaee;
  }

  .task input[type='checkbox'] {
    flex: none;
    width: 22px;
    height: 22px;
  }

  /* The label is the big tap target: tapping the words ticks the box. */
  .task > label {
    flex: 1;
    min-height: 44px;
    display: flex;
    align-items: center;
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .finished {
    text-decoration: line-through;
    color: #81919a;
  }

  .icon-button {
    flex: none;
    min-width: 44px;
    min-height: 44px;
    border: none;
    background: transparent;
    color: var(--primary);
  }

  .delete {
    color: #c93d35;
    font-size: 22px;
  }

  .edit {
    flex: 1;
    padding: 8px 0;
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
    padding: 12px;
    border: 1px solid #e8b6b1;
    border-radius: 10px;
    background: #fdecea;
  }

  .notice.offline {
    border-color: var(--border);
    background: #f5f8f7;
  }

  .notice p {
    margin: 0 0 8px;
  }

  .add {
    margin-top: 30px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
