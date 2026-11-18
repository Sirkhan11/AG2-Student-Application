<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { db, getFirebaseAuth } from '#lib/firebase/client.js';
  import {
    aboutYouProblem,
    accountProblem,
    INTEREST_CHOICES,
    loadStudentDetails,
    MAX_INTEREST_LENGTH,
    MAX_INTERESTS,
    PASSWORD_MIN_LENGTH,
    saveStudentDetails,
    signUpStudent
  } from '#lib/students/signup.js';
  import { waitingSignUp } from '#lib/signup/waiting.js';
  import { isAllowedEmail, wordingFor } from '#lib/access.js';
  import { access, loadAccess } from '#lib/access.svelte.js';
  import { NOT_UNI_EMAIL, UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';
  import SafetyNote from '#lib/components/SafetyNote.svelte';
  import { crisisIn } from '#lib/checkin/safety.js';

  // Signing up in two steps, as the group's wireframe: step 1, the account (email, password and
  // confirm password); step 2, about you (name, home or international, arrival date, course,
  // interests to pick, and whether they'd like a mentor). Nothing is made until Finish: the account
  // is created then, and the record waits in this tab until the address is verified (signup.js).
  // Already logged in (their details were lost before they verified, or their account is from before
  // these questions, and Home sent them here): only step 2, filled in with what's known, saved
  // straight to the account.

  /** Which step is showing. A signed-in account only ever sees step 2. */
  let step = $state(1);

  // Step 1: the account.
  let email = $state('');
  let password = $state('');
  let confirm = $state('');

  // Step 2: about you.
  let name = $state('');
  let studentType = $state('');
  let arrivalDate = $state('');
  let course = $state('');
  let interests = $state(/** @type {string[]} */ ([]));
  let ownInterest = $state('');
  let wantsMentor = $state(false);

  let error = $state('');
  // Their name, course or an interest of their own suggests they may be at risk: the support message,
  // and it isn't kept or saved, as the chat would tell Gemini them (safety.js; agent1.md A13).
  let safety = $state(false);
  let loading = $state(false);
  // The email box's label and placeholder, and the testing line, follow the access switch (access.js),
  // read as the page opens.
  let words = $derived(wordingFor(access.uniOnly));
  onMount(() => void loadAccess());

  /** @type {{ uid: string, email: string } | null} */
  let account = $state(null);
  let filledIn = false;
  onMount(() =>
    watchAccount(async (signedIn) => {
      account = signedIn?.verified ? { uid: signedIn.uid, email: signedIn.email } : null;
      if (!account || filledIn) return;
      // Logged in: straight to step 2, with what their record already has.
      filledIn = true;
      step = 2;
      try {
        const known = await loadStudentDetails(db, account.uid);
        name = known.name;
        studentType = known.studentType;
        course = known.course;
        interests = known.interests;
        arrivalDate = known.arrivalDate;
        wantsMentor = known.wantsMentor;
      } catch (err) {
        console.error('Loading the details failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
      }
    })
  );

  /** The interests to pick from: the standard ones, then any of their own they've added. */
  let choices = $derived([...INTEREST_CHOICES, ...interests.filter((word) => !INTEREST_CHOICES.includes(word))]);
  let full = $derived(interests.length >= MAX_INTERESTS);

  /** @param {string} word */
  function toggleInterest(word) {
    interests = interests.includes(word) ? interests.filter((known) => known !== word) : full ? interests : [...interests, word];
  }

  function addOwnInterest() {
    const word = ownInterest.trim().slice(0, MAX_INTEREST_LENGTH).trim();
    ownInterest = '';
    safety = crisisIn(word);
    if (safety || !word || full || interests.some((known) => known.toLowerCase() === word.toLowerCase())) return;
    interests = [...interests, word];
  }

  /** Step 1's Continue: the address against the access switch, then the password rule. */
  async function next() {
    error = '';
    // AG2 is for Northumbria students: other addresses are turned away before an account is made,
    // unless the access switch is off (access.js), which is read before deciding.
    const uniOnly = await loadAccess();
    if (!isAllowedEmail(email, uniOnly)) {
      error = UNI_EMAIL_MESSAGE;
      return;
    }
    const problem = accountProblem({ password, confirm });
    if (problem) {
      error = problem;
      return;
    }
    step = 2;
  }

  /** Step 2's Finish (or Save, when logged in). */
  async function finish() {
    error = '';
    safety = crisisIn(name, course, ...interests);
    if (safety) return;
    const problem = aboutYouProblem({ name, studentType, course, interests });
    if (problem) {
      error = problem;
      return;
    }
    loading = true;
    try {
      if (account) {
        await saveStudentDetails(db, account.uid, account.email, { name, studentType, course, interests, arrivalDate, wantsMentor });
        await goto('/home');
        return;
      }
      // Makes the account and sends the verification email. The record waits in this tab until the
      // link is clicked (see signup.js); meanwhile the app shows the check-your-inbox screen.
      const uniOnly = await loadAccess();
      await signUpStudent(
        { auth: getFirebaseAuth(), waiting: waitingSignUp(), uniOnly },
        { name, email, password, studentType, course, interests, arrivalDate, wantsMentor }
      );
      await goto('/home');
    } catch (err) {
      const { code, message } = /** @type {{ code?: string, message?: string }} */ (err);
      if (account) {
        console.error('Saving the details failed:', code ?? 'error');
        error = 'We couldn’t save your details just now. Please try again.';
        return;
      }
      // Problems with the account itself take them back to step 1, where the address is.
      if (code === NOT_UNI_EMAIL || code === 'auth/email-already-in-use') step = 1;
      error =
        code === NOT_UNI_EMAIL
          ? UNI_EMAIL_MESSAGE
          : code === 'auth/email-already-in-use'
            ? 'There’s already an account with that email. Log in instead.'
            : (message ?? 'Something went wrong. Please try again.');
    } finally {
      loading = false;
    }
  }
</script>

<main class="page">
  {#if account}
    <p><a href="/home">← Back to Home</a></p>
    <h1>About you</h1>
    <p class="muted">You’re logged in, so these are saved to your account.</p>
  {:else if step === 1}
    <p><a href="/">← Back to log in</a></p>
    <h1>Create your account</h1>
    <p class="muted step-label">Step 1 of 2</p>
    <div class="bars" aria-hidden="true"><span class="bar on"></span><span class="bar"></span></div>
    {#if words.testingNote}
      <p class="muted">{words.testingNote}</p>
    {/if}
  {:else}
    <p><button class="back" type="button" onclick={() => (step = 1)}>← Back</button></p>
    <h1>About you</h1>
    <p class="muted step-label">Step 2 of 2</p>
    <div class="bars" aria-hidden="true"><span class="bar on"></span><span class="bar on"></span></div>
  {/if}

  <form onsubmit={(event) => {
    event.preventDefault();
    if (step === 1) next();
    else finish();
  }}>
    {#if step === 1}
      <label for="email">{words.emailLabel}</label>
      <input id="email" class="field" type="email" placeholder={words.emailPlaceholder} autocomplete="email" bind:value={email} required />

      <label for="password">Password</label>
      <p class="muted hint" id="password-rule">At least {PASSWORD_MIN_LENGTH} characters.</p>
      <input id="password" class="field" type="password" minlength={PASSWORD_MIN_LENGTH} autocomplete="new-password" aria-describedby="password-rule" bind:value={password} required />

      <label for="confirm">Confirm password</label>
      <input id="confirm" class="field" type="password" minlength={PASSWORD_MIN_LENGTH} autocomplete="new-password" bind:value={confirm} required />

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <button class="primary-button" type="submit">Continue</button>
      <p class="centre"><a href="/">Already have an account? Log in</a></p>
      <p class="note">We only ask for what the app needs. No date of birth or health questions.</p>
    {:else}
      <label for="name">Your name</label>
      <input id="name" class="field" autocomplete="name" bind:value={name} required />

      <fieldset class="group">
        <legend>Are you a home or international student?</legend>
        <div class="options">
          <label class="option" class:picked={studentType === 'home'}>
            <input type="radio" name="studentType" value="home" bind:group={studentType} required />
            Home
          </label>
          <label class="option" class:picked={studentType === 'international'}>
            <input type="radio" name="studentType" value="international" bind:group={studentType} />
            International
          </label>
        </div>
      </fieldset>

      <label for="arrival">When do you arrive?</label>
      <input id="arrival" class="field" type="date" bind:value={arrivalDate} />

      <label for="course">Your course</label>
      <input id="course" class="field" bind:value={course} required />

      <fieldset class="group">
        <legend>What are you into? Pick a few</legend>
        <div class="chips">
          {#each choices as word (word)}
            <label class="chip" class:picked={interests.includes(word)}>
              <input type="checkbox" checked={interests.includes(word)} onchange={() => toggleInterest(word)} disabled={full && !interests.includes(word)} />
              {word}
            </label>
          {/each}
        </div>
        <div class="add">
          <label for="own-interest" class="visually-hidden">Something else you’re into</label>
          <input id="own-interest" class="field" placeholder="Something else?" maxlength={MAX_INTEREST_LENGTH} bind:value={ownInterest} disabled={full}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addOwnInterest();
              }
            }} />
          <button class="secondary-button" type="button" onclick={addOwnInterest} disabled={full}>Add</button>
        </div>
        <p class="muted hint">{full ? `That’s ${MAX_INTERESTS}, the most it keeps.` : `Up to ${MAX_INTERESTS}.`}</p>
      </fieldset>

      <label class="tick">
        <input type="checkbox" bind:checked={wantsMentor} />
        Match me with a second- or third-year mentor (optional)
      </label>

      {#if safety}
        <SafetyNote note="Nothing you typed here has been saved or sent." />
      {/if}
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <button class="primary-button" type="submit" disabled={loading}>
        {#if account}
          {loading ? 'Saving…' : 'Save'}
        {:else}
          {loading ? 'Creating your account…' : 'Finish'}
        {/if}
      </button>
      <p class="muted hint">
        Why we ask: this sets up your checklist and mentor match. You can change it later, on What the
        chat knows about you.
      </p>
    {/if}
  </form>

  <p class="muted">What AG2 keeps about you, and what Google’s Gemini AI is told: <a href="/privacy">Privacy</a>.</p>
</main>

<style>
  .step-label {
    margin: 0 0 6px;
  }

  /* One bar per step, filled as far as they've got. */
  .bars {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0 0 18px;
  }

  .bar {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--line);
  }

  .bar.on {
    background: var(--violet);
  }

  .back {
    padding: 0;
    border: 0;
    background: none;
    color: var(--violet);
    font: inherit;
    cursor: pointer;
  }

  .hint {
    margin: 2px 0 8px;
    font-size: 14px;
  }

  .centre {
    text-align: center;
  }

  /* The wireframe's note: what the app doesn't ask. */
  .note {
    margin: 16px 0 0;
    padding: 10px 12px;
    border-radius: var(--radius-m);
    background: var(--mint-soft);
    color: var(--mint-ink);
    font-size: 14px;
  }

  .group {
    margin: 0 0 14px;
    padding: 0;
    border: 0;
  }

  .group legend {
    margin-bottom: 8px;
    padding: 0;
    font-weight: 600;
  }

  /* Two buttons, one of which is picked, for home or international. */
  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .option,
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    background: var(--card);
    font-weight: 600;
    cursor: pointer;
  }

  .option input,
  .chip input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
  }

  .option.picked,
  .chip.picked {
    border-color: var(--violet);
    background: var(--violet-soft);
    color: var(--violet-ink);
  }

  .option:focus-within,
  .chip:focus-within {
    outline: 2px solid var(--violet);
    outline-offset: 2px;
  }

  /* Interests to tap. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip {
    min-height: 40px;
    padding: 6px 14px;
    border-radius: var(--radius-pill);
    font-weight: 500;
  }

  .chip:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-top: 10px;
  }

  .add .field {
    margin: 0;
  }

  .tick {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 4px 0 16px;
  }

  .tick input {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    flex: none;
  }
</style>
