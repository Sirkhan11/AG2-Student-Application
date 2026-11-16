<script>
  import { questions } from '#lib/matching/questions.js';
  import { watchSignedIn } from '#lib/matching/mentors.js';
  import { matchStudent } from '#lib/matching/find-match.js';

  let answers = $state(questions.map(() => ''));
  let result = $state(/** @type {import('#lib/matching/find-match.js').MatchResult | null} */ (null));
  let loading = $state(false);
  let error = $state('');
  // null while Firebase is still checking for a saved login, so "not logged in" doesn't flash up first.
  let signedIn = $state(/** @type {boolean | null} */ (null));

  // $effect only runs in the browser, which is where Firebase Auth has to run.
  // It returns watchSignedIn's stop function, so Svelte stops listening when you leave the page.
  $effect(() =>
    watchSignedIn((value) => {
      signedIn = value;
    })
  );

  async function findMatches() {
    loading = true;
    error = '';
    result = null;
    try {
      result = await matchStudent(answers);
    } catch (err) {
      console.error(err);
      const code = /** @type {{ code?: string }} */ (err).code;
      error =
        code === 'permission-denied'
          ? "Firestore wouldn't share the mentor list. Check you're still logged in."
          : 'Something went wrong while matching. Please try again.';
    } finally {
      // Runs even if something fails, so the button can't get stuck on "Matching…".
      loading = false;
    }
  }

  /** A score to 2 places, or a dash for a question that couldn't be compared. @param {number | null} score */
  function show(score) {
    return score === null ? '–' : score.toFixed(2);
  }
</script>

<h1>Matching demo</h1>

{#if signedIn === false}
  <p role="alert">
    You need to be logged in to find a mentor, because only signed-in users can see mentor profiles.
  </p>
{/if}

{#each questions as question, i}
  <label>
    {question}
    <textarea bind:value={answers[i]}></textarea>
  </label>
{/each}

<button onclick={findMatches} disabled={loading || !signedIn}>
  {loading ? 'Matching…' : 'Find matches'}
</button>

{#if error}
  <p role="alert">{error}</p>
{/if}

{#if result && result.status === 'summarise-failed'}
  <p role="alert">
    Gemini couldn’t summarise these answers, so this would be passed to the coordinator. Nothing was
    matched on the raw answers.
  </p>
{:else if result && result.status === 'ranked'}
  <p>What Gemini picked out of each answer:</p>
  <ol>
    {#each result.studentSummaries as items, i (i)}
      <li>{items.length ? items.join(', ') : '(nothing to compare, so this question is skipped)'}</li>
    {/each}
  </ol>

  {#if result.mentorCount === 0}
    <p>There are no approved mentors to match with yet.</p>
  {:else}
    <p>Compared with {result.mentorCount} approved {result.mentorCount === 1 ? 'mentor' : 'mentors'}.</p>
    {#if result.passToCoordinator}
      <p>Weak or close match, or too few questions compared, so this would go to the coordinator.</p>
    {/if}
    <ol>
      {#each result.ranked as mentor (mentor.id)}
        <li>
          {mentor.name}: {show(mentor.score)} from {mentor.questionsCompared} of {questions.length} questions
          (per question: {mentor.perQuestion.map(show).join(', ')})
        </li>
      {/each}
    </ol>
  {/if}
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
