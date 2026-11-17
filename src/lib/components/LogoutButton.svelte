<script>
  import { goto } from '$app/navigation';
  import { signOut } from 'firebase/auth';
  import { getFirebaseAuth } from '#lib/firebase/client';
  import { disconnectBlackboard } from '#lib/blackboard/api.js';
  import { waitingSignUp } from '#lib/signup/waiting.js';

  let loading = $state(false);
  let errorMessage = $state('');

  async function logout() {
    loading = true;
    errorMessage = '';

    try {
      // Forget the Blackboard connection on this device first, so a shared computer keeps nothing.
      await disconnectBlackboard().catch((err) => console.error('Blackboard disconnect on logout failed:', err?.message));
      // And a sign-up still waiting for its email to be verified.
      waitingSignUp().clear();
      await signOut(getFirebaseAuth());
      await goto('/');
    } catch (err) {
      console.error('Logout failed:', err.code);
      errorMessage = 'Unable to log out. Please try again.';
    } finally {
      loading = false;
    }
  }
</script>

<button onclick={logout} disabled={loading}>
  {loading ? 'Logging out...' : 'Log out'}
</button>

{#if errorMessage}
  <p role="alert">{errorMessage}</p>
{/if}
