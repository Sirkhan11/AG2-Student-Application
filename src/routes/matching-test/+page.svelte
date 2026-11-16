<script>
  import { embed } from '#lib/matching/embed.js';
  import { similarity } from '#lib/matching/similarity.js';
  import { summariseWants } from '#lib/matching/summarise.js';

  // The negation example: the student rules sport out, so the gig-goer should be the better match.
  const exampleStudent = "I'm not into sport or the gym at all, I'd rather go to gigs.";
  const sportyMentor = 'I love sport, especially football and the gym.';
  const gigMentor = 'Live music and going to gigs every weekend.';

  let first = $state('');
  let second = $state('');
  let score = $state(/** @type {number | null} */ (null));
  let loading = $state(false);

  // Results of the Gemini version: each person's "wants" list, and the similarity of those lists.
  let firstWants = $state(/** @type {string[] | null} */ (null));
  let secondWants = $state(/** @type {string[] | null} */ (null));
  let summaryScore = $state(/** @type {number | null} */ (null));
  let summarising = $state(false);
  let error = $state('');

  function clearResults() {
    score = null;
    firstWants = null;
    secondWants = null;
    summaryScore = null;
    error = '';
  }

  /** @param {string} mentorAnswer */
  function useExample(mentorAnswer) {
    first = exampleStudent;
    second = mentorAnswer;
    clearResults();
  }

  // Compares the answers as written, which is what matching does today.
  async function compare() {
    loading = true;
    try {
      const [a, b] = await Promise.all([embed(first), embed(second)]);
      score = similarity(a, b);
    } finally {
      loading = false;
    }
  }

  // Asks Gemini for each answer's "wants" list, then compares the lists instead of the raw answers.
  async function compareSummaries() {
    summarising = true;
    error = '';
    firstWants = null;
    secondWants = null;
    summaryScore = null;
    try {
      const [a, b] = await Promise.all([summariseWants(first), summariseWants(second)]);
      firstWants = a;
      secondWants = b;
      // An empty list means the answer only said what they don't want, so there's nothing to compare.
      if (a.length > 0 && b.length > 0) {
        const [vectorA, vectorB] = await Promise.all([embed(a.join(', ')), embed(b.join(', '))]);
        summaryScore = similarity(vectorA, vectorB);
      }
    } catch (err) {
      console.error(err);
      error = `Summarising failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      summarising = false;
    }
  }
</script>

<h1>Matching test</h1>

<p>
  Negation example:
  <button onclick={() => useExample(sportyMentor)}>Student vs sporty mentor</button>
  <button onclick={() => useExample(gigMentor)}>Student vs gig-going mentor</button>
</p>

<textarea bind:value={first} placeholder="Student answer"></textarea>
<textarea bind:value={second} placeholder="Mentor answer"></textarea>

<button onclick={compare} disabled={loading}>
  {loading ? 'Comparing…' : 'Compare'}
</button>
<button onclick={compareSummaries} disabled={summarising}>
  {summarising ? 'Asking Gemini…' : 'Compare Gemini summaries'}
</button>

{#if score !== null}
  <p>Similarity of the answers as written: {score.toFixed(3)}</p>
{/if}

{#if error}
  <p role="alert">{error}</p>
{/if}

{#if firstWants && secondWants}
  <p>Student wants: {firstWants.length ? firstWants.join(', ') : '(nothing, only things they don’t want)'}</p>
  <p>Mentor wants: {secondWants.length ? secondWants.join(', ') : '(nothing, only things they don’t want)'}</p>
  <p>
    Similarity of the summaries:
    {summaryScore === null ? 'none (one list is empty, so there’s nothing to compare)' : summaryScore.toFixed(3)}
  </p>
{/if}
