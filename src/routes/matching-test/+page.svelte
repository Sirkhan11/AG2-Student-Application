<script>
  import { embed } from '#lib/matching/embed.js';
  import { similarity } from '#lib/matching/similarity.js';

  let first = $state('');
  let second = $state('');
  let score = $state(/** @type {number | null} */ (null));
  let loading = $state(false);

  async function compare() {
    loading = true;
    const [a, b] = await Promise.all([embed(first), embed(second)]);
    score = similarity(a, b);
    loading = false;
  }
</script>

<h1>Matching test</h1>
<textarea bind:value={first} placeholder="Student answer"></textarea>
<textarea bind:value={second} placeholder="Mentor answer"></textarea>
<button onclick={compare} disabled={loading}>
  {loading ? 'Comparing…' : 'Compare'}
</button>
{#if score !== null}
  <p>Similarity: {score.toFixed(3)}</p>
{/if}