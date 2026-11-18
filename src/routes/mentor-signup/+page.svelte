<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { mentorQuestions } from '#lib/matching/questions.js';
  import { findBlankAnswer, registerMentor, NOTHING_TO_MATCH } from '#lib/matching/mentors.js';
  import { SUMMARISE_FAILED } from '#lib/matching/summarise.js';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { isAllowedEmail, wordingFor } from '#lib/access.js';
  import { access, loadAccess } from '#lib/access.svelte.js';
  import { NOT_UNI_EMAIL, UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';

  let name = $state('');
  let displayName = $state('');
  let email = $state('');
  let password = $state('');
  let course = $state('');
  let answers = $state(mentorQuestions.map(() => ''));
  let meetingFrequency = $state('every two weeks');
  let availability = $state('');
  let maxStudents = $state(2);
  let over18 = $state(false);

  let status = $state('');
  let error = $state('');
  let done = $state(false);
  // The email box's label and placeholder follow the access switch (access.js).
  let words = $derived(wordingFor(access.uniOnly));
  // Already signed in with a verified Northumbria account (their waiting profile was lost, say, by
  // closing the tab before verifying): the profile goes on that account, with no new login.
  let signedIn = $state(false);
  onMount(() => watchAccount((account) => (signedIn = account?.verified === true)));
  // The app comes back here with ?done once the profile that waited for verification is saved.
  let thanks = $derived(done || page.url.searchParams.has('done'));

  async function register() {
    error = '';
    // Checked before anything slow happens, so the mentor finds out straight away.
    const blank = findBlankAnswer(answers);
    if (blank !== -1) {
      error = `Please write an answer for question ${blank + 1}.`;
      return;
    }
    // AG2 is for Northumbria students: checked before Gemini runs, so nothing is spent on it, unless
    // the access switch is off (access.js), which is read before deciding.
    const uniOnly = await loadAccess();
    if (!signedIn && !isAllowedEmail(email, uniOnly)) {
      error = UNI_EMAIL_MESSAGE;
      return;
    }
    try {
      status = 'Setting up your profile (the first time can take a moment)...';
      await registerMentor(
        {
          displayName,
          name,
          course,
          answers,
          meetingFrequency,
          availability,
          maxStudents: Number(maxStudents)
        },
        signedIn ? null : { email, password, uniOnly }
      );
      // A new account sees the check-your-inbox screen now (the app shows it); this page shows the
      // thanks once the profile is saved, straight away when they were already signed in.
      done = signedIn;
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err).code;
      // Gemini runs before the account is made, so for its errors nothing has been saved yet.
      if (code === NOT_UNI_EMAIL) {
        error = UNI_EMAIL_MESSAGE;
      } else if (code === 'auth/email-already-in-use') {
        error = "We couldn't create an account with that email. If you already have one, log in instead.";
      } else if (code === SUMMARISE_FAILED && /** @type {{ outOfCredit?: boolean }} */ (err).outOfCredit) {
        // Gemini's credit has run out: trying again won't help until it's topped up.
        error = "Sorry, mentor sign-up isn't available right now, so your account hasn't been created.";
      } else if (code === SUMMARISE_FAILED) {
        error = "We couldn't process your answers just now, so your account hasn't been created. Please try again in a minute.";
      } else if (code === NOTHING_TO_MATCH) {
        error = "We couldn't find anything to match you on. Please say a bit more about what you enjoy or could help with.";
      } else {
        error = 'Something went wrong. Please try again.';
      }
    } finally {
      status = '';
    }
  }
</script>

<main class="page">
  {#if thanks}
    <h1>Thanks for signing up</h1>
    <p>The mentoring coordinator will check your profile, and we'll match you with students once it's approved.</p>
    <p><a href="/home">Go to Home</a></p>
  {:else}
    <p><a href="/">← Back to log in</a></p>
    <h1>Become a mentor</h1>
    <p class="muted">
      Your answers are only used to match you with students who'd get on with you. Google's Gemini
      AI summarises them to find a match. Students will see the name you choose to show them and a
      short reason for the match, such as a shared interest, but not your answers or other details.
      The coordinator checks every profile first.
    </p>

    <form onsubmit={(event) => {
      event.preventDefault();
      register();
    }}>
      <label for="name">Full name</label>
      <input id="name" class="field" bind:value={name} required />

      <label for="displayName">Name to show students (for example, your first name)</label>
      <input id="displayName" class="field" bind:value={displayName} required />

      {#if signedIn}
        <p class="muted">You’re logged in, so your mentor profile will be added to this account.</p>
      {:else}
        <label for="email">{words.emailLabel}</label>
        <input id="email" class="field" type="email" placeholder={words.emailPlaceholder} bind:value={email} required />

        <label for="password">Password</label>
        <input id="password" class="field" type="password" minlength="8" bind:value={password} required />
      {/if}

      <label for="course">Course</label>
      <input id="course" class="field" bind:value={course} required />

      {#each mentorQuestions as question, i}
        <label for={`q${i + 1}`}>{question}</label>
        <textarea id={`q${i + 1}`} class="field" rows="3" bind:value={answers[i]} required></textarea>
      {/each}

      <label for="frequency">How often would you like to meet?</label>
      <select id="frequency" class="field" bind:value={meetingFrequency}>
        <option value="weekly">Weekly</option>
        <option value="every two weeks">Every two weeks</option>
        <option value="monthly">Monthly</option>
      </select>

      <label for="availability">When are you usually free?</label>
      <input id="availability" class="field" placeholder="e.g. weekday afternoons"
        bind:value={availability} required />

      <label for="max">How many students could you mentor?</label>
      <input id="max" class="field" type="number" min="1" max="5" bind:value={maxStudents} required />

      <label>
        <input type="checkbox" bind:checked={over18} required />
        I'm 18 or over
      </label>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <button class="primary-button" type="submit" disabled={status !== ''}>
        {status || 'Sign up as a mentor'}
      </button>
    </form>
    <p class="muted">What AG2 keeps about you, and what Google’s Gemini AI is told: <a href="/privacy">Privacy</a>.</p>
  {/if}
</main>
