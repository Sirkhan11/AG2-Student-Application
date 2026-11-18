<script>
  import { sendPasswordResetEmail } from 'firebase/auth';
  import { getFirebaseAuth } from '#lib/firebase/client';
  import { isUniEmail, UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';

  let email = $state('');
  let message = $state('');
  let loading = $state(false);

  async function resetPassword(event) {
    event.preventDefault();
    message = '';
    // Only Northumbria accounts can use AG2, so only their addresses are sent a reset link.
    if (!isUniEmail(email)) {
      message = UNI_EMAIL_MESSAGE;
      return;
    }
    loading = true;

    try {
      await sendPasswordResetEmail(
        getFirebaseAuth(),
        email.trim()
      );

      message =
        'If an account exists for this email, a password reset link will be sent.';
    } catch (err) {
      console.error('Password reset failed:', err.code);

      message =
        'Unable to process the request. Please try again later.';
    } finally {
      loading = false;
    }
  }
</script>

<main class="page">
  <h1>Reset your password</h1>

  <p>
    Enter your email address to request a password reset.
  </p>

  <form onsubmit={resetPassword}>
    <label for="email">Northumbria email address</label>

    <input
      id="email"
      class="field"
      type="email"
      bind:value={email}
      required
    />

    <button class="primary-button" type="submit" disabled={loading}>
      {loading ? 'Sending...' : 'Send reset email'}
    </button>
  </form>

  {#if message}
    <p role="status">{message}</p>
  {/if}

  <p class="back"><a href="/">Back to login</a></p>
</main>

<style>
  .back {
    margin-top: 24px;
    text-align: center;
  }
</style>
