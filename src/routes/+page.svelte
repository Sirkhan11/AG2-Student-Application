
<script>
  import { goto } from '$app/navigation';
  import { logIn } from '#lib/firebase/auth.js';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loggingIn = $state(false);

  async function handleLogin() {
    if (!email || !password) {
      alert('Please enter your email and password.');
      return;
    }

    error = '';
    loggingIn = true;
    try {
      // A real Firebase login, so pages that need a signed-in user (like /find-mentor) work.
      await logIn(email, password);
      goto('/home');
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err).code;
      error =
        code === 'auth/invalid-credential'
          ? "That email and password don't match an account."
          : 'Something went wrong. Please try again.';
    } finally {
      loggingIn = false;
    }
  }
</script>

<main class="page">
  <h1>Welcome back</h1>
  <p class="muted">
    Log in to your AG2 student support account.
  </p>

  <form onsubmit={(event) => {
    event.preventDefault();
    handleLogin();
  }}>
    <label for="email">Email address</label>
    <input
      id="email"
      class="field"
      type="email"
      bind:value={email}
      required
    />

    <label for="password">Password</label>
    <input
      id="password"
      class="field"
      type="password"
      bind:value={password}
      required
    />

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button class="primary-button" type="submit" disabled={loggingIn}>
      {loggingIn ? 'Logging in…' : 'Log in'}
    </button>
  </form>

  <div class="links">
    <a href="/signup">Create an account</a>
    <a href="/mentor-signup">Become a mentor</a>
    <a href="/forgot-password">Forgot password?</a>
  </div>

  <a class="help-link" href="/need-help">
    Need help now?
  </a>
</main>

<style>
  .links {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 24px;
    text-align: center;
  }

  .help-link {
    display: block;
    margin-top: 50px;
    padding: 14px;
    border: 1px solid #e8b6b1;
    border-radius: 10px;
    color: #c93d35;
    text-align: center;
    font-weight: bold;
  }
</style>
