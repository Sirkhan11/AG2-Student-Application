<script>
  import { embed } from '#lib/matching/embed.js';
  import { similarity } from '#lib/matching/similarity.js';
  import { summariseWants } from '#lib/matching/summarise.js';
  import { bestMatches, compareItems, embedItems } from '#lib/matching/compare-items.js';

  // The negation example: the student rules sport out, so the gig-goer should be the better match.
  const exampleStudent = "I'm not into sport or the gym at all, I'd rather go to gigs.";
  const sportyMentor = 'I love sport, especially football and the gym.';
  const gigMentor = 'Live music and going to gigs every weekend.';

  /**
   * Writing-style fairness tests. Each one is a single student written three ways, compared with one
   * mentor. Every version says the same thing, so a fair method gives them about the same score.
   * mustKeep lists phrases every version's summary has to keep: a dropped phrase doesn't always move
   * the score (see the work style test), so it's checked separately.
   * @type {{ name: string, mentor: string, note: string, mustKeep: string[],
   *   versions: { label: string, text: string }[] }[]}
   */
  const styleTests = [
    {
      name: 'Interests',
      mentor: gigMentor,
      note: 'No sport or gym; likes gigs and live music.',
      mustKeep: ['gigs', 'live music'],
      versions: [
        { label: 'Short', text: 'Not sport or the gym. Gigs and live music.' },
        {
          label: 'Long',
          text: "To be honest I'm not really into sport or the gym at all, it's just never been my thing. What I actually love is live music, and I try to get to gigs pretty much every weekend if I can, whoever's playing."
        },
        {
          label: 'Spelling mistakes',
          text: 'im not realy into sprot or the jym, i wud rarther go to gigz and here live musik'
        }
      ]
    },
    {
      name: 'Work style',
      // A mentor who plans ahead, on purpose: if a summary drops "last minute", that version's score
      // goes UP (only "working alone" is left, which matches perfectly), hiding a real difference.
      // With a last-minute mentor, dropping it wouldn't change the score at all.
      mentor: 'I always plan ahead and I like working on my own.',
      note: 'Leaves things to the last minute; works best alone. "Last minute" is a work style, not a schedule detail, so it must be kept.',
      mustKeep: ['last minute'],
      versions: [
        // Word for word, the answer that came back as just "working alone" in testing.
        { label: 'Short', text: 'Last minute, and I work best on my own' },
        {
          label: 'Long',
          text: "I'm definitely a last-minute person, I always seem to leave things until the night before, and I work best on my own rather than in a group."
        },
        { label: 'Spelling mistakes', text: 'last minit, and i wurk best on my own' }
      ]
    },
    {
      name: 'Weekend',
      // An early riser, on purpose: if a summary drops "lie-in", only "cinema" is left, and the
      // score moves, as well as the must-keep check failing.
      mentor: 'Up early for a run, then football in the afternoon.',
      note: 'Likes a lie-in, then the cinema. A lie-in is something they do, not a schedule detail, so it must be kept.',
      mustKeep: ['lie-in'],
      versions: [
        { label: 'Short', text: 'A lie-in, then the cinema' },
        {
          label: 'Long',
          text: "A proper lie-in is the best bit of my weekend, and then I'll usually head to the cinema in the afternoon."
        },
        { label: 'Spelling mistakes', text: 'a lie in, then the cinama' }
      ]
    }
  ];

  /**
   * Two summary lists scored three ways: the old way (each list joined up and embedded as one),
   * and both item-by-item options. `matches` gives each student item's closest mentor item.
   * @typedef {{
   *   wholeList: number | null,
   *   studentSide: number | null,
   *   both: number | null,
   *   matches: { index: number, score: number }[]
   * }} ListScores
   */

  /**
   * One fairness test's results: the mentor's list, then one row per version of the student.
   * @typedef {{ mentorWants: string[], rows: ({ label: string, wants: string[], kept: boolean } & ListScores)[] }} StyleResult
   */

  let first = $state('');
  let second = $state('');
  let score = $state(/** @type {number | null} */ (null));
  let loading = $state(false);

  // Results of the Gemini version: each person's list, and how the lists compare.
  let firstWants = $state(/** @type {string[] | null} */ (null));
  let secondWants = $state(/** @type {string[] | null} */ (null));
  let summaryScores = $state(/** @type {ListScores | null} */ (null));
  let summarising = $state(false);
  let error = $state('');

  // Fairness test results and errors, one slot per test, and which test is running (null if none).
  let styleResults = $state(/** @type {(StyleResult | null)[]} */ (styleTests.map(() => null)));
  let styleErrors = $state(styleTests.map(() => ''));
  let styleRunning = $state(/** @type {number | null} */ (null));

  function clearResults() {
    score = null;
    firstWants = null;
    secondWants = null;
    summaryScores = null;
    error = '';
  }

  /** @param {string} mentorAnswer */
  function useExample(mentorAnswer) {
    first = exampleStudent;
    second = mentorAnswer;
    clearResults();
  }

  /** @param {number | null} value */
  function show(value) {
    return value === null ? 'none' : value.toFixed(3);
  }

  /**
   * How far apart the highest and lowest scores are. Every version says the same thing, so the
   * smaller the spread, the less a method cares about writing style. Null if any score is missing.
   * @param {(number | null)[]} scores
   */
  function spread(scores) {
    const numbers = /** @type {number[]} */ (scores.filter((s) => s !== null));
    if (numbers.length !== scores.length) return null;
    return Math.max(...numbers) - Math.min(...numbers);
  }

  /**
   * True when every must-keep phrase appears inside one of the summary's phrases, ignoring capitals
   * and hyphens, so "last-minute working" counts as keeping "last minute".
   * @param {string[]} wants
   * @param {string[]} mustKeep
   */
  function keepsAll(wants, mustKeep) {
    /** @param {string} text */
    const normalise = (text) => text.toLowerCase().replaceAll('-', ' ');
    return mustKeep.every((needed) => wants.some((want) => normalise(want).includes(normalise(needed))));
  }

  /**
   * Scores two summary lists the old way and both new ways, so they can be compared side by side.
   * @param {string[]} studentWants
   * @param {string[]} mentorWants
   * @returns {Promise<ListScores>}
   */
  async function scoreLists(studentWants, mentorWants) {
    // An empty list means the answer only said what they don't want, so there's nothing to compare.
    if (studentWants.length === 0 || mentorWants.length === 0) {
      return { wholeList: null, studentSide: null, both: null, matches: [] };
    }
    const [studentVectors, mentorVectors, studentWhole, mentorWhole] = await Promise.all([
      embedItems(studentWants),
      embedItems(mentorWants),
      embed(studentWants.join(', ')),
      embed(mentorWants.join(', '))
    ]);
    return {
      wholeList: similarity(studentWhole, mentorWhole),
      studentSide: compareItems(studentVectors, mentorVectors, 'student'),
      both: compareItems(studentVectors, mentorVectors, 'both'),
      matches: bestMatches(studentVectors, mentorVectors)
    };
  }

  // Compares the answers as written, which is what matching did before summaries.
  async function compare() {
    loading = true;
    try {
      const [a, b] = await Promise.all([embed(first), embed(second)]);
      score = similarity(a, b);
    } finally {
      loading = false;
    }
  }

  // Asks Gemini for each answer's list, then compares the lists instead of the raw answers.
  async function compareSummaries() {
    summarising = true;
    error = '';
    firstWants = null;
    secondWants = null;
    summaryScores = null;
    try {
      const [a, b] = await Promise.all([summariseWants(first), summariseWants(second)]);
      firstWants = a;
      secondWants = b;
      summaryScores = await scoreLists(a, b);
    } catch (err) {
      console.error(err);
      error = `Summarising failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      summarising = false;
    }
  }

  /**
   * Runs one fairness test: summarises the mentor and each version of the student (one Gemini
   * request each, so 4 in all), then scores each version against the mentor.
   * @param {number} index which test in styleTests
   */
  async function runStyleTest(index) {
    const test = styleTests[index];
    styleRunning = index;
    styleErrors[index] = '';
    styleResults[index] = null;
    try {
      const [mentorWants, ...versionWants] = await Promise.all([
        summariseWants(test.mentor),
        ...test.versions.map((version) => summariseWants(version.text))
      ]);
      const rows = await Promise.all(
        test.versions.map(async (version, i) => ({
          label: version.label,
          wants: versionWants[i],
          kept: keepsAll(versionWants[i], test.mustKeep),
          ...(await scoreLists(versionWants[i], mentorWants))
        }))
      );
      styleResults[index] = { mentorWants, rows };
    } catch (err) {
      console.error(err);
      styleErrors[index] = `Fairness test failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      styleRunning = null;
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
  {#if summaryScores}
    {#if summaryScores.wholeList === null}
      <p>No scores: one list is empty, so there’s nothing to compare.</p>
    {:else}
      <ul>
        <li>Whole lists, each embedded as one (the old way): {show(summaryScores.wholeList)}</li>
        <li>Item by item, student side only: {show(summaryScores.studentSide)}</li>
        <li>Item by item, both directions averaged: {show(summaryScores.both)}</li>
      </ul>
      <p>Each student item’s closest mentor item:</p>
      <ul>
        {#each summaryScores.matches as match, i (i)}
          <li>{firstWants[i]} → {secondWants[match.index]} ({match.score.toFixed(3)})</li>
        {/each}
      </ul>
    {/if}
  {/if}
{/if}

<h2>Writing-style fairness tests</h2>
<p>
  Each test is one student written three ways and compared with one mentor. Every version says the
  same thing, so a fair method gives them close scores (a small spread), and every summary should
  keep the listed phrases. Each test uses 4 of the 15 Gemini requests allowed a minute.
</p>

{#each styleTests as test, t (test.name)}
  {@const result = styleResults[t]}
  <h3>{test.name}</h3>
  <p>{test.note}</p>
  <p>Mentor: “{test.mentor}”</p>
  <ul>
    {#each test.versions as version (version.label)}
      <li><strong>{version.label}:</strong> {version.text}</li>
    {/each}
  </ul>
  <button onclick={() => runStyleTest(t)} disabled={styleRunning !== null}>
    {styleRunning === t ? 'Running…' : `Run ${test.name.toLowerCase()} test`}
  </button>

  {#if styleErrors[t]}
    <p role="alert">{styleErrors[t]}</p>
  {/if}

  {#if result}
    <p>Mentor wants: {result.mentorWants.length ? result.mentorWants.join(', ') : '(nothing)'}</p>
    <table>
      <thead>
        <tr>
          <th scope="col">Version</th>
          <th scope="col">Gemini summary</th>
          <th scope="col">Keeps {test.mustKeep.join(', ')}?</th>
          <th scope="col">Whole lists (old way)</th>
          <th scope="col">Item by item, student side</th>
          <th scope="col">Item by item, both directions</th>
        </tr>
      </thead>
      <tbody>
        {#each result.rows as row (row.label)}
          <tr>
            <th scope="row">{row.label}</th>
            <td>{row.wants.length ? row.wants.join(', ') : '(nothing)'}</td>
            <td>{row.kept ? 'yes' : 'NO'}</td>
            <td>{show(row.wholeList)}</td>
            <td>{show(row.studentSide)}</td>
            <td>{show(row.both)}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colspan="3">Spread (highest − lowest)</th>
          <td>{show(spread(result.rows.map((row) => row.wholeList)))}</td>
          <td>{show(spread(result.rows.map((row) => row.studentSide)))}</td>
          <td>{show(spread(result.rows.map((row) => row.both)))}</td>
        </tr>
      </tfoot>
    </table>
  {/if}
{/each}
