<script>
  import { page } from '$app/state';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import Icon from '#lib/components/Icon.svelte';

  // Shown for an address the app doesn't have (404), or if a page fails to load. Logged-out visitors
  // are sent to log in first by the root layout, so whoever sees this is signed in: the way back is
  // Home, and the bottom bar.
</script>

<main class="page not-found">
  <span class="badge"><Icon name={page.status === 404 ? 'search' : 'help'} size={28} /></span>
  {#if page.status === 404}
    <h1>We can’t find that page</h1>
    <p class="muted">The link may be out of date, or the address mistyped.</p>
  {:else}
    <h1>Something went wrong</h1>
    <p class="muted">This page didn’t load. Please try again in a moment.</p>
  {/if}
  <a class="primary-button" href="/home">Go to Home</a>
  <p class="help"><a href="/need-help">Need help now?</a></p>
  <BottomNav />
</main>

<style>
  .not-found {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding-top: 64px;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    border-radius: 50%;
    color: var(--violet);
    background: var(--violet-soft);
  }

  .not-found p {
    margin: 0 0 20px;
  }

  .not-found .primary-button {
    max-width: 280px;
  }

  .not-found .help {
    margin-top: 16px;
  }
</style>
