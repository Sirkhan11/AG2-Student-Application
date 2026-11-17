<script>
  import { goto } from '$app/navigation';
  import { getFirebaseAuth } from '#lib/firebase/client.js';
  import { signUpStudent } from '#lib/students/signup.js';
  import { waitingSignUp } from '#lib/signup/waiting.js';
  import { isUniEmail, NOT_UNI_EMAIL, UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let course = $state('');
  let interests = $state('');
  let arrivalDate = $state('');
  let error = $state('');
  let loading = $state(false);

  async function register() {
    error = '';
    // AG2 is for Northumbria students: other addresses are turned away before an account is made.
    if (!isUniEmail(email)) {
      error = UNI_EMAIL_MESSAGE;
      return;
    }
    loading = true;

    try {
      // Makes the account and sends the verification email. The record waits in this tab until the
      // link is clicked (see signup.js); meanwhile the app shows the check-your-inbox screen.
      await signUpStudent(
        { auth: getFirebaseAuth(), waiting: waitingSignUp() },
        { name, email, password, course, interests, arrivalDate }
      );

      await goto('/home');
    } catch (err) {
      const { code, message } = /** @type {{ code?: string, message?: string }} */ (err);
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
  <p><a href="/">← Back to log in</a></p>
  <h1>Create your account</h1>
  <p class="muted">
    Tell us a little about yourself.
  </p>

  <form onsubmit={(event) => {
    event.preventDefault();
    register();
  }}>
    <label for="name">Full name</label>
    <input id="name" class="field"
      bind:value={name} required />

    <label for="email">Northumbria email address</label>
    <input id="email" class="field" type="email"
      placeholder="ending @northumbria.ac.uk"
      bind:value={email} required />

    <label for="password">Password</label>
    <input id="password" class="field" type="password"
      minlength="6" bind:value={password} required />

    <label for="course">Course</label>
    <input id="course" class="field"
      bind:value={course} required />

    <label for="interests">Interests</label>
    <input id="interests" class="field"
      placeholder="Music, football, gaming"
      bind:value={interests} />

    <label for="arrival">Arrival date</label>
    <input id="arrival" class="field" type="date"
      bind:value={arrivalDate} />

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button class="primary-button"
      type="submit" disabled={loading}>
      {loading ? 'Creating account...' : 'Sign up'}
    </button>
  </form>

  <p><a href="/">Already have an account?</a></p>
</main>
