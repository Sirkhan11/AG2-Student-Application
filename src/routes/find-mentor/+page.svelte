<script>
  import { goto } from '$app/navigation';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { askCoordinator, checkBeforeMatching, matchAndSave, prepareStudent } from '#lib/matching/find-match.js';
  import {
    alreadyHasText,
    ANSWERS_NOTE,
    ASKING_COORDINATOR_MESSAGE,
    capitalise,
    checkAnswers,
    createFinder,
    FINDING_MESSAGE,
    MAX_AVAILABILITY_LENGTH,
    MEETING_FREQUENCIES,
    questions,
    SAYS
  } from '#lib/matching/find-mentor-steps.js';

  /**
   * Which part of the page is showing (only one at a time):
   * - 'checking': working out what to show
   * - 'is-mentor', 'no-mentors', 'has-record': shown instead of the form
   * (Logged-out visitors are sent to login instead, which brings them back here.)
   * - 'form', then 'busy' while matching or saving (the form stays, disabled)
   * - 'gemini-failed': Gemini is down, so try again or ask the coordinator
   * - 'gemini-unavailable': Gemini's credit has run out, so trying again won't help: only the
   *   coordinator option
   * - 'error': anything else failed, so try that step again
   * Once the result is saved, the page goes to the check-in chat instead (see showOutcome).
   * The steps, wording and error handling are shared with the chat (find-mentor-steps.js).
   * @typedef {'checking' | 'is-mentor' | 'no-mentors' | 'has-record' | 'form' | 'busy'
   *   | 'gemini-failed' | 'gemini-unavailable' | 'error'} View
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

  // The match record they already had when the page opened ('has-record').
  let savedMatch = $state(/** @type {import('#lib/matching/matches.js').Match | null} */ (null));

  // Finding and saving, as the chat does it. It keeps what Gemini prepared, so trying again never
  // asks Gemini again.
  const finder = createFinder({ prepareStudent, matchAndSave, askCoordinator });

  // $effect only runs in the browser, where Firebase Auth runs. watchSignedIn's stop function is
  // returned, so Svelte stops listening when the student leaves the page.
  $effect(() =>
    watchSignedIn((signedIn) => {
      if (signedIn) start();
      // Logged out: the root layout sends them to log in (see account-gate.js).
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

  /** Gemini and embedding (once), then matching and saving. */
  async function findMentor() {
    formError = checkAnswers(answers, availability) ?? '';
    if (formError) return;
    busyMessage = FINDING_MESSAGE;
    view = 'busy';
    handle(await finder.find(answers, preferences()));
  }

  /** Saving again with what was prepared: Try again after the save failed. */
  async function saveAgain() {
    view = 'busy';
    handle(await finder.save(preferences()));
  }

  /** For when Gemini is down and the student would rather be matched by hand. */
  async function askCoordinatorNow() {
    busyMessage = ASKING_COORDINATOR_MESSAGE;
    view = 'busy';
    handle(await finder.askCoordinator(answers, preferences()));
  }

  /** @param {import('#lib/matching/find-mentor-steps.js').FindResult} result */
  function handle(result) {
    if (result.status === 'saved') showOutcome(result.outcome);
    else if (result.status === 'error') showError(result.message, result.step === 'prepare' ? findMentor : result.step === 'save' ? saveAgain : askCoordinatorNow, result.error);
    else view = result.status;
  }

  /** @param {import('#lib/matching/find-match.js').SaveOutcome} outcome */
  function showOutcome(outcome) {
    if (outcome.outcome === 'no-mentors') {
      view = 'no-mentors';
      return;
    }
    // Matched, passed to the coordinator, or already saved by an earlier try: on to the check-in chat.
    // Its first message says what happened ("You've been matched with…" or "We're finding you a
    // mentor"), and links to /mentor, which shows why they were matched.
    goto('/check-in?from=find-mentor');
  }
</script>

<main class="page">
  <h1>Find a mentor</h1>

  {#if view === 'checking'}
    <p class="muted" role="status">Loading…</p>

  {:else if view === 'is-mentor'}
    <p>This page is for students.</p>
    <p class="muted">{SAYS.isMentor}</p>

  {:else if view === 'no-mentors'}
    <p>{SAYS.noMentors}</p>
    <p class="muted">{SAYS.nothingSaved}</p>

  {:else if view === 'has-record' && savedMatch}
    <p>{alreadyHasText(savedMatch)}</p>
    <a class="primary-button" href="/mentor">See your mentor page</a>

  {:else if view === 'gemini-failed'}
    <p role="alert">{SAYS.geminiFailed}</p>
    <div class="actions">
      <button class="primary-button" onclick={findMentor}>Try again</button>
      <button class="secondary-button" onclick={askCoordinatorNow}>{SAYS.askCoordinator}</button>
    </div>
    <p class="muted">{SAYS.geminiFailedNote}</p>

  {:else if view === 'gemini-unavailable'}
    <p role="alert">{SAYS.geminiUnavailable}</p>
    <div class="actions">
      <button class="primary-button" onclick={askCoordinatorNow}>{SAYS.askCoordinator}</button>
    </div>
    <p class="muted">{SAYS.geminiUnavailableNote}</p>

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
    <p class="muted">{ANSWERS_NOTE}</p>

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

  <BottomNav />
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
</style>
