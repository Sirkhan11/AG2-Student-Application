<script>
  /** @type {import('./$types').PageProps} */
  let { data } = $props();
</script>

<svelte:head>
  <title>Pretend Blackboard</title>
</svelte:head>

<main class="page">
  <p><a href="/checklist#blackboard">← Back to your checklist</a></p>
  <h1>Pretend Blackboard</h1>
  <p>In the real app, this link opens this page on Northumbria’s Blackboard:</p>
  <p class="muted"><code>{data.path}</code></p>
</main>
