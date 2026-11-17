<script>
  import { embed } from '#lib/matching/embed.js';
  import { similarity } from '#lib/matching/similarity.js';
  import { summariseAnswer } from '#lib/matching/summarise.js';
  import { stylesText } from '#lib/matching/summary-prompt.js';
  import { bestMatches, compareItems, embedItems } from '#lib/matching/compare-items.js';

  /** @typedef {import('#lib/matching/summary-prompt.js').Styles} Styles */
  /** One answer's summary: what it likes and avoids, and any styles it states. */
  /** @typedef {{ likes: string[], avoids: string[], styles: Styles }} AnswerSummary */

  // The negation example: the student rules sport out, so the gig-goer should be the better match.
  const exampleStudent = "I'm not into sport or the gym at all, I'd rather go to gigs.";
  const sportyMentor = 'I love sport, especially football and the gym.';
  const gigMentor = 'Live music and going to gigs every weekend.';

  /**
   * Writing-style fairness tests. Each one is a single student written three ways, compared with one
   * mentor. Every version says the same thing, so a fair method gives them about the same score, and
   * every version's summary should meet the expectations: phrases its likes must keep, phrases its
   * avoids must hold, and the styles it must get.
   * @type {{ name: string, mentor: string, note: string,
   *   expect: { likes?: string[], avoids?: string[], styles?: Partial<Styles> },
   *   versions: { label: string, text: string }[] }[]}
   */
  const styleTests = [
    {
      name: 'Interests',
      mentor: gigMentor,
      note: 'No sport or gym; likes gigs and live music. Sport and the gym go in avoids, never in likes.',
      expect: { likes: ['gigs', 'live music'], avoids: ['sport', 'gym'] },
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
      // Work style is a style, not a like: it's never embedded, so this test has no scores. What
      // matters is that every version gets the same styles. The first version is word for word the
      // answer that once came back as just "working alone".
      mentor: 'I always plan ahead and I like working on my own.',
      note: 'Leaves things to the last minute; works best alone. Every version should get the styles "last minute" and "on my own", with nothing in likes.',
      expect: { likes: [], styles: { planning: 'last minute', working: 'on my own' } },
      versions: [
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
      // score moves, as well as the check failing.
      mentor: 'Up early for a run, then football in the afternoon.',
      note: 'Likes a lie-in, then the cinema. A lie-in is something they do, not a schedule detail, so it must be kept.',
      expect: { likes: ['lie-in'] },
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
   * Two lists of likes scored three ways: the old way (each list joined up and embedded as one),
   * and both item-by-item options. `matches` gives each student item's closest mentor item.
   * @typedef {{
   *   wholeList: number | null,
   *   studentSide: number | null,
   *   both: number | null,
   *   matches: { index: number, score: number }[]
   * }} ListScores
   */

  /**
   * One fairness test's results: the mentor's summary, then one row per version of the student.
   * @typedef {{ mentor: AnswerSummary, rows: ({ label: string, summary: AnswerSummary, ok: boolean } & ListScores)[] }} StyleResult
   */

  let first = $state('');
  let second = $state('');
  let score = $state(/** @type {number | null} */ (null));
  let loading = $state(false);

  // Results of the Gemini version: each person's summary, and how their likes compare.
  let firstSummary = $state(/** @type {AnswerSummary | null} */ (null));
  let secondSummary = $state(/** @type {AnswerSummary | null} */ (null));
  let summaryScores = $state(/** @type {ListScores | null} */ (null));
  let summarising = $state(false);
  let error = $state('');

  // Fairness test results and errors, one slot per test, and which test is running (null if none).
  let styleResults = $state(/** @type {(StyleResult | null)[]} */ (styleTests.map(() => null)));
  let styleErrors = $state(styleTests.map(() => ''));
  let styleRunning = $state(/** @type {number | null} */ (null));

  function clearResults() {
    score = null;
    firstSummary = null;
    secondSummary = null;
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

  /** @param {string[]} phrases */
  function list(phrases) {
    return phrases.length ? phrases.join(', ') : '(nothing)';
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

  /** Ignores capitals and hyphens, so "last-minute working" counts as containing "last minute". */
  const normalise = (/** @type {string} */ text) => text.toLowerCase().replaceAll('-', ' ');

  /**
   * True when every expected phrase appears inside one of the phrases in the list.
   * @param {string[]} phrases
   * @param {string[]} expected
   */
  function containsAll(phrases, expected) {
    return expected.every((needed) => phrases.some((phrase) => normalise(phrase).includes(normalise(needed))));
  }

  /**
   * True when a summary meets a test's expectations. An empty expected likes list means the likes
   * must be empty (the work style test).
   * @param {AnswerSummary} summary
   * @param {{ likes?: string[], avoids?: string[], styles?: Partial<Styles> }} expect
   */
  function meetsExpectations(summary, expect) {
    const likesOk = !expect.likes || (expect.likes.length === 0 ? summary.likes.length === 0 : containsAll(summary.likes, expect.likes));
    const avoidsOk = !expect.avoids || containsAll(summary.avoids, expect.avoids);
    const stylesOk = Object.entries(expect.styles ?? {}).every(
      ([name, value]) => summary.styles[/** @type {keyof Styles} */ (name)] === value
    );
    return likesOk && avoidsOk && stylesOk;
  }

  /** @param {{ likes?: string[], avoids?: string[], styles?: Partial<Styles> }} expect */
  function expectText(expect) {
    const parts = [];
    if (expect.likes) parts.push(expect.likes.length ? `likes keep ${expect.likes.join(', ')}` : 'no likes');
    if (expect.avoids) parts.push(`avoids ${expect.avoids.join(', ')}`);
    if (expect.styles) parts.push(`styles ${Object.values(expect.styles).join(', ')}`);
    return parts.join('; ');
  }

  /**
   * Scores two lists of likes the old way and both new ways, so they can be compared side by side.
   * @param {string[]} studentLikes
   * @param {string[]} mentorLikes
   * @returns {Promise<ListScores>}
   */
  async function scoreLists(studentLikes, mentorLikes) {
    // An empty list means the answer only said what they don't want, or only gave styles.
    if (studentLikes.length === 0 || mentorLikes.length === 0) {
      return { wholeList: null, studentSide: null, both: null, matches: [] };
    }
    const [studentVectors, mentorVectors, studentWhole, mentorWhole] = await Promise.all([
      embedItems(studentLikes),
      embedItems(mentorLikes),
      embed(studentLikes.join(', ')),
      embed(mentorLikes.join(', '))
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

  // Asks Gemini to summarise each answer, then compares the likes instead of the raw answers.
  async function compareSummaries() {
    summarising = true;
    error = '';
    firstSummary = null;
    secondSummary = null;
    summaryScores = null;
    try {
      const [a, b] = await Promise.all([summariseAnswer(first), summariseAnswer(second)]);
      firstSummary = a;
      secondSummary = b;
      summaryScores = await scoreLists(a.likes, b.likes);
    } catch (err) {
      console.error(err);
      error = `Summarising failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      summarising = false;
    }
  }

  /**
   * Runs one fairness test: summarises the mentor and each version of the student (one Gemini
   * request each, so 4 in all), then scores each version's likes against the mentor's.
   * @param {number} index which test in styleTests
   */
  async function runStyleTest(index) {
    const test = styleTests[index];
    styleRunning = index;
    styleErrors[index] = '';
    styleResults[index] = null;
    try {
      const [mentor, ...versions] = await Promise.all([
        summariseAnswer(test.mentor),
        ...test.versions.map((version) => summariseAnswer(version.text))
      ]);
      const rows = await Promise.all(
        test.versions.map(async (version, i) => ({
          label: version.label,
          summary: versions[i],
          ok: meetsExpectations(versions[i], test.expect),
          ...(await scoreLists(versions[i].likes, mentor.likes))
        }))
      );
      styleResults[index] = { mentor, rows };
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

{#if firstSummary && secondSummary}
  <p>
    Student likes: {list(firstSummary.likes)}. Avoids: {list(firstSummary.avoids)}.
    Styles: {stylesText(firstSummary.styles)}.
  </p>
  <p>
    Mentor likes: {list(secondSummary.likes)}. Avoids: {list(secondSummary.avoids)}.
    Styles: {stylesText(secondSummary.styles)}.
  </p>
  {#if summaryScores}
    {#if summaryScores.wholeList === null}
      <p>No scores: one side has no likes, so there’s nothing to compare.</p>
    {:else}
      <ul>
        <li>Whole lists, each embedded as one (the old way): {show(summaryScores.wholeList)}</li>
        <li>Item by item, student side only: {show(summaryScores.studentSide)}</li>
        <li>Item by item, both directions averaged: {show(summaryScores.both)}</li>
      </ul>
      <p>Each student like’s closest mentor like:</p>
      <ul>
        {#each summaryScores.matches as match, i (i)}
          <li>{firstSummary.likes[i]} → {secondSummary.likes[match.index]} ({match.score.toFixed(3)})</li>
        {/each}
      </ul>
    {/if}
  {/if}
{/if}

<h2>Writing-style fairness tests</h2>
<p>
  Each test is one student written three ways and compared with one mentor. Every version says the
  same thing, so a fair method gives them close scores (a small spread), and every summary should
  meet the test’s expectations. Each test uses 4 of the 15 Gemini requests allowed a minute.
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
    <p>
      Mentor likes: {list(result.mentor.likes)}. Avoids: {list(result.mentor.avoids)}.
      Styles: {stylesText(result.mentor.styles)}.
    </p>
    <table>
      <thead>
        <tr>
          <th scope="col">Version</th>
          <th scope="col">Gemini summary</th>
          <th scope="col">As expected ({expectText(test.expect)})?</th>
          <th scope="col">Whole lists (old way)</th>
          <th scope="col">Item by item, student side</th>
          <th scope="col">Item by item, both directions</th>
        </tr>
      </thead>
      <tbody>
        {#each result.rows as row (row.label)}
          <tr>
            <th scope="row">{row.label}</th>
            <td>
              Likes: {list(row.summary.likes)}<br />
              Avoids: {list(row.summary.avoids)}<br />
              Styles: {stylesText(row.summary.styles)}
            </td>
            <td>{row.ok ? 'yes' : 'NO'}</td>
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
