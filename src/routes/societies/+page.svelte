<script>
  import BottomNav from '$lib/components/BottomNav.svelte';

  let search = $state('');

  const societies = [
    {
      id: 1,
      name: 'Climbing Society',
      interests: ['sport', 'climbing', 'outdoors']
    },
    {
      id: 2,
      name: 'Board Games Society',
      interests: ['gaming', 'board games']
    },
    {
      id: 3,
      name: 'Photography Society',
      interests: ['photography', 'creative']
    }
  ];

  let filtered = $derived(
    societies.filter((society) =>
      society.name.toLowerCase().includes(
        search.toLowerCase()
      )
    )
  );
</script>

<main class="page">
  <h1>Societies</h1>
  <p class="muted">
    Discover societies that match your interests.
  </p>

  <label for="society-search">Search societies</label>
  <input
    id="society-search"
    class="field"
    placeholder="Search..."
    bind:value={search}
  />

  {#each filtered as society}
    <section class="card">
      <h2>{society.name}</h2>
      <p class="muted">
        {society.interests.join(', ')}
      </p>
    </section>
  {/each}

  <BottomNav />
</main>
