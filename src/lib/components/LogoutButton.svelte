<script>
  import { goto } from '$app/navigation';
  import { signOut } from 'firebase/auth';
  import { getFirebaseAuth } from '#lib/firebase/client.js';
  import { disconnectBlackboard } from '#lib/blackboard/api.js';
  import { forgetAllDeadlines } from '#lib/deadlines/store.js';
  import { LIVE } from '#lib/live.js';
  import { waitingSignUp } from '#lib/signup/waiting.js';

  let loading = $state(false);
  let errorMessage = $state('');

  async function logout() {
    loading = true;
    errorMessage = '';

    try {
      // Forget the Blackboard connection on this device first, so a shared computer keeps nothing.
      // The live site has no Blackboard yet (no server routes), so there's nothing to forget there.
      if (!LIVE) {
        await disconnectBlackboard().catch((err) => console.error('Blackboard disconnect on logout failed:', err?.message));
      }
      // The Blackboard calendar link and the deadlines it gave, kept on this phone (deadlines/store.js):
      // the link is a key to that calendar, so nobody else on this browser gets it.
      forgetAllDeadlines();
      // And a sign-up still waiting for its email to be verified.
      waitingSignUp().clear();
      await signOut(getFirebaseAuth());
      await goto('/');
    } catch (err) {
      console.error('Logout failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
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
