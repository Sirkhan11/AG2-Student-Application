<script>
  import { onMount } from 'svelte';
  import { loadChecklist, saveChange } from '#lib/checklist/store.js';
  import { ChecklistError, MAX_TASKS } from '#lib/checklist/tasks.js';
  import { addSuggestedTask, stateFor } from '#lib/checkin/task-suggestions.js';

  /**
   * A checklist task the check-in chat suggested, under its reply, with Add and No thanks. Nothing
   * is added without the student's tap, and Add goes through the checklist's own "add" change (an
   * own- task), so the checklist's limits and rules apply (see addSuggestedTask). Before offering
   * Add, it looks at their checklist: if the task is already there, it points to that task instead.
   * task is bound to the chat's message, so what happened stays the same when they come back.
   * @type {{ task: import('#lib/checkin/chat-session.svelte.js').SuggestedTask }}
   */
  let { task = $bindable() } = $props();

  let busy = $state(false);
  let problem = $state('');

  // Is it already on their checklist, or is there no room? Add checks again before it saves.
  onMount(async () => {
    if (task.state !== 'offered') return;
    try {
      const found = stateFor(await loadChecklist(), task.title);
      // Unless they've already tapped something meanwhile.
      if (task.state === 'offered' && !busy) Object.assign(task, found);
    } catch (err) {
      console.error('Looking at the checklist failed:', err instanceof Error ? err.message : err);
    }
  });

  // The only place a suggested task is added: the student's tap on Add.
  async function add() {
    busy = true;
    problem = '';
    try {
      Object.assign(task, await addSuggestedTask(task.title, { loadChecklist, saveChange }));
    } catch (err) {
      if (err instanceof ChecklistError) {
        problem = err.message;
      } else {
        console.error('Adding the task failed:', err instanceof Error ? err.message : err);
        problem = 'We couldn’t add it just now. Please try again.';
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="task-card" role="group" aria-label="Checklist reminder">
  {#if task.state === 'offered'}
    <p class="label">Add to your checklist?</p>
    <p class="title">{task.title}</p>
    {#if problem}
      <p class="problem" role="alert">{problem}</p>
    {/if}
    <div class="actions">
      <button class="primary-button" type="button" onclick={add} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      <button class="secondary-button" type="button" onclick={() => (task.state = 'declined')} disabled={busy}>No thanks</button>
    </div>
  {:else if task.state === 'added' || task.state === 'queued'}
    <p role="status">
      ✓ Added to your checklist: <strong>{task.title}</strong>{#if task.state === 'queued'}. It’ll save when you’re back online.{/if}
    </p>
    <a href="/checklist">Open your checklist</a>
  {:else if task.state === 'exists'}
    <p>That’s already on your checklist: <strong>{task.existing}</strong></p>
    <a href="/checklist">Open your checklist</a>
  {:else if task.state === 'full'}
    <p>Your checklist is full ({MAX_TASKS} tasks), so this wasn’t added. Delete one to make room.</p>
    <a href="/checklist">Open your checklist</a>
  {:else}
    <p class="muted">Not added.</p>
  {/if}
</div>

<style>
  .task-card {
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-1);
    background: #fff;
    color: var(--ink);
  }

  .task-card p {
    margin: 0 0 6px;
  }

  .label {
    color: var(--ink-3);
    font-size: 14px;
  }

  .title {
    font-weight: bold;
  }

  .problem {
    color: var(--danger-ink);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .actions button {
    flex: 1;
  }
</style>
