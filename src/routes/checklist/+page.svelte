
<script>
  import BottomNav from '#lib/components/BottomNav.svelte';

  let tasks = $state([
    { id: 1, title: 'Register with a GP', done: false },
    { id: 2, title: 'Collect student ID', done: true },
    { id: 3, title: 'Join a society', done: false },
    { id: 4, title: 'Find a dentist', done: false },
    { id: 5, title: 'Save key contacts', done: false }
  ]);

  let newTask = $state('');

  let completed = $derived(
    tasks.filter((task) => task.done).length
  );

  function addTask() {
    if (!newTask.trim()) return;

    tasks.push({
      id: Date.now(),
      title: newTask.trim(),
      done: false
    });

    newTask = '';
  }

  function removeTask(id) {
    tasks = tasks.filter((task) => task.id !== id);
  }
</script>

<main class="page">
  <h1>Your checklist</h1>
  <p class="muted">
    Complete these tasks to help you settle in.
  </p>

  <div class="card">
    <strong>{completed} of {tasks.length} completed</strong>

    <progress
      value={completed}
      max={tasks.length || 1}
    ></progress>
  </div>

  {#each tasks as task (task.id)}
    <div class="task">
      <label>
        <input type="checkbox" bind:checked={task.done} />
        <span class:finished={task.done}>
          {task.title}
        </span>
      </label>

      <button
        class="delete"
        onclick={() => removeTask(task.id)}
        aria-label={`Remove ${task.title}`}
      >
        ×
      </button>
    </div>
  {/each}

  <form onsubmit={(event) => {
    event.preventDefault();
    addTask();
  }}>
    <label for="new-task">Add your own task</label>

    <input
      id="new-task"
      class="field"
      placeholder="Enter a new task"
      bind:value={newTask}
    />

    <button class="primary-button" type="submit">
      Add task
    </button>
  </form>

  <BottomNav />
</main>

<style>
  progress {
    width: 100%;
    margin-top: 12px;
    accent-color: #1764a1;
  }

  .task {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 10px;
    border-bottom: 1px solid #e3eaee;
  }

  .task label {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .task input {
    width: 18px;
    height: 18px;
  }

  .finished {
    text-decoration: line-through;
    color: #81919a;
  }

  .delete {
    border: none;
    background: transparent;
    color: #c93d35;
    font-size: 22px;
  }

  form {
    margin-top: 30px;
  }
</style>
