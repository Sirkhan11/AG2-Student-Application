<script>
  import { questions } from '#lib/matching/questions.js';
  import { loadApprovedMentors, watchSignedIn } from '#lib/matching/mentors.js';
  import { embedAnswers, rankMentors, needsCoordinator } from '#lib/matching/match.js';

  let answers = $state(questions.map(() => ''));
  let ranked = $state(
    /** @type {{ id: string, name: string, score: number, perQuestion: number[] }[]} */ ([])
  );
  let loading = $state(false);
  let error = $state('');
  // How many approved mentors the last search compared against (null until the first search).
  let mentorCount = $state(/** @type {number | null} */ (null));
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
    try {
      // Load the mentors and embed the student's answers at the same time.
      // Only the student is embedded: the mentors' vectors come ready-made from Firestore.
      const [mentors, studentVectors] = await Promise.all([loadApprovedMentors(), embedAnswers(answers)]);
      mentorCount = mentors.length;
      ranked = rankMentors(studentVectors, mentors);
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

{#if mentorCount === 0}
  <p>There are no approved mentors to match with yet.</p>
{:else if ranked.length}
  <p>Compared with {mentorCount} approved {mentorCount === 1 ? 'mentor' : 'mentors'}.</p>
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
