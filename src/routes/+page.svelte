
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { safeNextPath } from '#lib/next-path.js';
  import { logIn } from '#lib/firebase/auth.js';
  import { isUniEmail, UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';
  import Icon from '#lib/components/Icon.svelte';

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
    // AG2 is for Northumbria students: other addresses are turned away before anything is sent.
    if (!isUniEmail(email)) {
      error = UNI_EMAIL_MESSAGE;
      return;
    }
    loggingIn = true;
    try {
      // A real Firebase login, so pages that need a signed-in user (like /find-mentor) work.
      await logIn(email, password);
      // Back to the page that sent them here (?next=), but only if it's on our own site.
      goto(safeNextPath(page.url.searchParams.get('next')) ?? '/home');
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
  <header class="hello">
    <span class="mark" aria-hidden="true">AG2</span>
    <h1>Welcome back</h1>
    <p class="muted">
      Log in to your AG2 student support account.
    </p>
  </header>

  <form class="card" onsubmit={(event) => {
    event.preventDefault();
    handleLogin();
  }}>
    <label for="email">Northumbria email address</label>
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
    <Icon name="help" size={20} /> Need help now?
  </a>
</main>

<style>
  .hello {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin: 8px 0 6px;
  }

  /* The app's mark, as on a phone's home screen. */
  .mark {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin: 16px 0 14px;
    border-radius: 16px;
    color: white;
    background: var(--violet);
    font-weight: 700;
    font-size: 20px;
    letter-spacing: -0.02em;
  }

  .hello h1 {
    font-size: 28px;
    margin: 0 0 4px;
  }

  .hello p {
    margin: 0;
    font-size: 16px;
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 24px;
    text-align: center;
  }

  .help-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 40px;
    padding: 14px;
    border: 1px solid var(--danger-line);
    border-radius: var(--radius-m);
    background: var(--danger-soft);
    color: var(--danger-ink);
    text-align: center;
    font-weight: 600;
  }
</style>
