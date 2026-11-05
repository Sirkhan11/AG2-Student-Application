<script>
  import { goto } from '$app/navigation';
  import { signOut } from 'firebase/auth';
  import { getFirebaseAuth } from '#lib/firebase/client';

  let loading = $state(false);
  let errorMessage = $state('');

  async function logout() {
    loading = true;
    errorMessage = '';

    try {
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
