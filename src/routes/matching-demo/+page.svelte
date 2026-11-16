<script>
  import { questions } from '#lib/matching/questions.js';
  import { sampleMentors } from '#lib/matching/sample-mentors.js';
  import { embedAnswers, rankMentors, needsCoordinator } from '#lib/matching/match.js';

  let answers = $state(questions.map(() => ''));
  let ranked = $state(
    /** @type {{ id: string, name: string, score: number, perQuestion: number[] }[]} */ ([])
  );
  let loading = $state(false);

  async function findMatches() {
    loading = true;
    const mentors = await Promise.all(
      sampleMentors.map(async (m) => ({ id: m.id, name: m.name, vectors: await embedAnswers(m.answers) }))
    );
    ranked = rankMentors(await embedAnswers(answers), mentors);
    loading = false;
  }
</script>

<h1>Matching demo</h1>

{#each questions as question, i}
  <label>
    {question}
    <textarea bind:value={answers[i]}></textarea>
  </label>
{/each}

<button onclick={findMatches} disabled={loading}>
  {loading ? 'Matching…' : 'Find matches'}
</button>

{#if ranked.length}
  {#if needsCoordinator(ranked)}
    <p>Weak or close match, so this would go to the coordinator.</p>
  {/if}
  <ol>
    {#each ranked as mentor}
      <li>
        {mentor.name}: {mentor.score.toFixed(3)}
        (per question: {mentor.perQuestion.map((s) => s.toFixed(2)).join(', ')})
      </li>
    {/each}
  </ol>
{/if}

<style>
  label {
    display: block;
    margin-bottom: 1rem;
  }
  textarea {
    display: block;
    width: 100%;
  }
</style>