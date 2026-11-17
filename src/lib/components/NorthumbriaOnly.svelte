<script>
  import LogoutButton from '#lib/components/LogoutButton.svelte';

  /**
   * Shown instead of the app to a signed-in account that isn't a Northumbria one (see
   * account-gate.js). firestore.rules refuse such an account everything anyway; this says why.
   * @type {{ email: string }}
   */
  let { email } = $props();
</script>

<main class="page">
  <h1>AG2 is for Northumbria students</h1>
  <p>
    You’re signed in as <strong>{email}</strong>, which isn’t a Northumbria address. Log out, then log
    in or sign up with your Northumbria email (ending @northumbria.ac.uk).
  </p>
  <LogoutButton />
  <p><a href="/need-help">Need help now</a></p>
</main>
