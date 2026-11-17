<script>
  import { questions } from '#lib/matching/questions.js';
  import { findBlankAnswer, watchSignedIn } from '#lib/matching/mentors.js';
  import { SUMMARISE_FAILED } from '#lib/matching/summarise.js';
  import { MAX_AVAILABILITY_LENGTH, MEETING_FREQUENCIES } from '#lib/matching/matches.js';
  import {
    askCoordinator,
    checkBeforeMatching,
    matchAndSave,
    prepareStudent
  } from '#lib/matching/find-match.js';

  /**
   * Which part of the page is showing (only one at a time):
   * - 'checking': working out what to show
   * - 'signed-out', 'is-mentor', 'no-mentors', 'has-record': shown instead of the form
   * - 'form', then 'busy' while matching or saving (the form stays, disabled)
   * - 'gemini-failed': Gemini is down, so try again or ask the coordinator
   * - 'error': anything else failed, so try that step again
   * - 'matched', 'coordinator': the result
   * @typedef {'checking' | 'signed-out' | 'is-mentor' | 'no-mentors' | 'has-record' | 'form' | 'busy'
   *   | 'gemini-failed' | 'error' | 'matched' | 'coordinator'} View
   */
  let view = $state(/** @type {View} */ ('checking'));

  let answers = $state(questions.map(() => ''));
  let meetingFrequency = $state('every two weeks');
  let availability = $state('');
  let formError = $state('');

  // What 'busy' says; what 'error' says, and what its Try again button does.
  let busyMessage = $state('');
  let errorMessage = $state('');
  let errorDetail = $state('');
  let retry = $state(/** @type {() => void} */ (() => {}));

  // An existing match record ('has-record'), or the new match ('matched').
  let savedMatch = $state(/** @type {import('#lib/matching/matches.js').Match | null} */ (null));
  let mentorName = $state('');
  let reasons = $state(/** @type {string[]} */ ([]));

  // The student's phrases and vectors, kept so that trying again never asks Gemini again.
  // Not $state, because the page never shows it.
  /** @type {import('#lib/matching/find-match.js').PreparedStudent | null} */
  let prepared = null;

  // $effect only runs in the browser, where Firebase Auth runs. watchSignedIn's stop function is
  // returned, so Svelte stops listening when the student leaves the page.
  $effect(() =>
    watchSignedIn((signedIn) => {
      if (signedIn) start();
      else view = 'signed-out';
    })
  );

  /** Works out what to show when the page opens, or when someone logs in. */
  async function start() {
    view = 'checking';
    try {
      const state = await checkBeforeMatching();
      if (state.view === 'has-record') savedMatch = state.match;
      view = state.view;
    } catch (err) {
      showError("We couldn't load this page. Please check your connection.", start, err);
    }
  }

  /**
   * @param {string} message what to tell the student
   * @param {() => void} again what Try again should do
   * @param {unknown} err the error, shown underneath in smaller text
   */
  function showError(message, again, err) {
    console.error(err);
    errorMessage = message;
    errorDetail = err instanceof Error ? err.message : '';
    retry = again;
    view = 'error';
  }

  const preferences = () => ({ meetingFrequency, availability });

  /** Step 1: Gemini and embedding, done once. Then step 2, save(). */
  async function findMentor() {
    formError = '';
    const blank = findBlankAnswer(answers);
    if (blank !== -1) {
      formError = `Please answer question ${blank + 1}.`;
      return;
    }
    if (availability.trim() === '') {
      formError = 'Please say when you’re usually free.';
      return;
    }

    busyMessage = 'Finding your mentor… The first time, this can take a minute while the matching model downloads.';
    view = 'busy';
    try {
      prepared = await prepareStudent(answers.map((answer) => answer.trim()));
    } catch (err) {
      if (/** @type {{ code?: string }} */ (err).code === SUMMARISE_FAILED) {
        // Not passed to the coordinator automatically: a match record is permanent, so the student chooses.
        view = 'gemini-failed';
        return;
      }
      showError("We couldn't get your answers ready to match.", findMentor, err);
      return;
    }
    await save();
  }

  /** Step 2: rank the mentors and save the result. Try again repeats only this step. */
  async function save() {
    view = 'busy';
    try {
      showOutcome(
        await matchAndSave(
          /** @type {import('#lib/matching/find-match.js').PreparedStudent} */ (prepared),
          preferences()
        )
      );
    } catch (err) {
      showError("We couldn't save your match.", save, err);
    }
  }

  /** For when Gemini is down and the student would rather be matched by hand. */
  async function askCoordinatorNow() {
    busyMessage = 'Sending your answers to the coordinator…';
    view = 'busy';
    try {
      showOutcome(await askCoordinator(answers.map((answer) => answer.trim()), preferences()));
    } catch (err) {
      showError("We couldn't send your request to the coordinator.", askCoordinatorNow, err);
    }
  }

  /** @param {import('#lib/matching/find-match.js').SaveOutcome} outcome */
  function showOutcome(outcome) {
    if (outcome.outcome === 'matched') {
      mentorName = outcome.mentorName;
      reasons = outcome.reasons;
      view = 'matched';
    } else if (outcome.outcome === 'already-saved') {
      savedMatch = outcome.match;
      view = 'has-record';
    } else {
      view = outcome.outcome; // 'coordinator' or 'no-mentors'
    }
  }

  /** "every two weeks" → "Every two weeks". @param {string} text */
  const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);
</script>

<main class="page">
  <h1>Find a mentor</h1>

  {#if view === 'checking'}
    <p class="muted" role="status">Loading…</p>

  {:else if view === 'signed-out'}
    <p>Please log in to find a mentor.</p>
    <div class="actions">
      <a class="primary-button" href="/">Log in</a>
      <a class="centred" href="/signup">Create an account</a>
    </div>

  {:else if view === 'is-mentor'}
    <p>This page is for students.</p>
    <p class="muted">You’ve signed up as a mentor, so the coordinator will match students with you.</p>

  {:else if view === 'no-mentors'}
    <p>There are no mentors available yet. Please check back soon.</p>
    <p class="muted">Nothing has been saved, so you can answer the questions once mentors are available.</p>

  {:else if view === 'has-record' && savedMatch}
    {#if savedMatch.status === 'matched'}
      <p>You’ve already been matched with {savedMatch.mentorName ?? 'a mentor'}.</p>
    {:else}
      <p>We’re already finding you a mentor, and we’ll let you know soon.</p>
    {/if}
    <a class="primary-button" href="/mentor">See your mentor page</a>

  {:else if view === 'matched'}
    <div class="card">
      <h2>You’ve been matched with {mentorName}</h2>
      {#if reasons.length}
        <p>Why we matched you:</p>
        <ul>
          {#each reasons as reason (reason)}
            <li>{reason}</li>
          {/each}
        </ul>
      {/if}
      <p>Your coordinator will introduce you.</p>
    </div>
    <a class="primary-button" href="/mentor">See your mentor page</a>

  {:else if view === 'coordinator'}
    <p>We’ll find you a mentor ourselves and let you know soon.</p>
    <a class="primary-button" href="/mentor">See your mentor page</a>

  {:else if view === 'gemini-failed'}
    <p role="alert">We can’t match you automatically right now. Please try again in a minute.</p>
    <div class="actions">
      <button class="primary-button" onclick={findMentor}>Try again</button>
      <button class="secondary-button" onclick={askCoordinatorNow}>Ask the coordinator to match me</button>
    </div>
    <p class="muted">If you ask the coordinator, they’ll read your answers and find you a mentor themselves.</p>

  {:else if view === 'error'}
    <p class="error" role="alert">{errorMessage}</p>
    {#if errorDetail}
      <p class="muted">{errorDetail}</p>
    {/if}
    <button class="primary-button" onclick={retry}>Try again</button>

  {:else}
    <!-- 'form', and 'busy' while matching (the same form, disabled) -->
    <p>
      Answer six short questions so we can match you with a student mentor who shares your interests
      and the way you like to do things.
    </p>
    <p class="muted">
      Google’s Gemini AI summarises your answers to find your match, and they’re only used for
      matching. Your mentor won’t see them. If we can’t find a good match automatically, the mentoring
      coordinator may read them to match you themselves.
    </p>

    <form
      onsubmit={(event) => {
        event.preventDefault();
        findMentor();
      }}
    >
      <fieldset disabled={view === 'busy'}>
        {#each questions as question, i (question)}
          <label for={`q${i + 1}`}>{question}</label>
          <textarea id={`q${i + 1}`} class="field" rows="3" bind:value={answers[i]} required></textarea>
        {/each}

        <label for="frequency">How often would you like to meet?</label>
        <select id="frequency" class="field" bind:value={meetingFrequency}>
          {#each MEETING_FREQUENCIES as frequency (frequency)}
            <option value={frequency}>{capitalise(frequency)}</option>
          {/each}
        </select>

        <label for="availability">When are you usually free?</label>
        <input
          id="availability"
          class="field"
          placeholder="For example, weekday afternoons"
          maxlength={MAX_AVAILABILITY_LENGTH}
          bind:value={availability}
          required
        />

        {#if formError}
          <p class="error" role="alert">{formError}</p>
        {/if}

        <button class="primary-button" type="submit">
          {view === 'busy' ? 'Please wait…' : 'Find my mentor'}
        </button>
      </fieldset>
    </form>

    {#if view === 'busy'}
      <p class="muted" role="status">{busyMessage}</p>
    {/if}
  {/if}
</main>

<style>
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }

  label {
    display: block;
    font-weight: bold;
  }

  .actions {
    display: grid;
    gap: 12px;
    margin: 16px 0;
  }

  .centred {
    text-align: center;
  }
</style>
