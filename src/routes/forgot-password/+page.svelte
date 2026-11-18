<script>
  import { onMount } from 'svelte';
  import { sendPasswordResetEmail } from 'firebase/auth';
  import { getFirebaseAuth } from '#lib/firebase/client';
  import { isAllowedEmail, wordingFor } from '#lib/access.js';
  import { access, loadAccess } from '#lib/access.svelte.js';
  import { UNI_EMAIL_MESSAGE } from '#lib/uni-email.js';

  let email = $state('');
  let message = $state('');
  let loading = $state(false);
  // What the email box is called follows the access switch (access.js), read as the page opens.
  let words = $derived(wordingFor(access.uniOnly));
  onMount(() => void loadAccess());

  async function resetPassword(event) {
    event.preventDefault();
    message = '';
    // Only Northumbria accounts can use AG2, so only their addresses are sent a reset link, unless
    // the access switch is off (access.js), which is read before deciding.
    const uniOnly = await loadAccess();
    if (!isAllowedEmail(email, uniOnly)) {
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
    <label for="email">{words.emailLabel}</label>

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
