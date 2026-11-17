<script>
  import { mentorQuestions } from '#lib/matching/questions.js';
  import { findBlankAnswer, registerMentor, NOTHING_TO_MATCH } from '#lib/matching/mentors.js';
  import { SUMMARISE_FAILED } from '#lib/matching/summarise.js';

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

  async function register() {
    error = '';
    // Checked before anything slow happens, so the mentor finds out straight away.
    const blank = findBlankAnswer(answers);
    if (blank !== -1) {
      error = `Please write an answer for question ${blank + 1}.`;
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
        { email, password }
      );
      done = true;
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err).code;
      // Gemini runs before the account is made, so for its errors nothing has been saved yet.
      if (code === 'auth/email-already-in-use') {
        error = "We couldn't create an account with that email. If you already have one, log in instead.";
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
  {#if done}
    <h1>Thanks for signing up</h1>
    <p>The mentoring coordinator will check your profile, and we'll match you with students once it's approved.</p>
    <p><a href="/">Back to log in</a></p>
  {:else}
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

      <label for="email">Email</label>
      <input id="email" class="field" type="email" bind:value={email} required />

      <label for="password">Password</label>
      <input id="password" class="field" type="password" minlength="8" bind:value={password} required />

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
  {/if}
</main>
