<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { afterNavigate, goto, onNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { chatShown, opensChatFromHome } from '#lib/page-transitions.js';
  import { gateFor } from '#lib/account-gate.js';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { db, getFirebaseAuth } from '#lib/firebase/client.js';
  import { sendToLogin } from '#lib/login-redirect.js';
  import { trail } from '#lib/back.js';
  import { finishSignUp } from '#lib/signup/finish.js';
  import { waitingSignUp } from '#lib/signup/waiting.js';
  import { isUniEmail } from '#lib/uni-email.js';
  import NorthumbriaOnly from '#lib/components/NorthumbriaOnly.svelte';
  import VerifyEmail from '#lib/components/VerifyEmail.svelte';

  let { children } = $props();

  /** @type {{ uid: string, email: string, verified: boolean } | null | undefined} undefined until Firebase has checked */
  let account = $state(undefined);
  let finishing = $state(false);
  let finishProblem = $state('');
  // Which screen, for every page (see account-gate.js): the app, nothing yet while Firebase checks,
  // off to log in, or (for a signed-in account) check-your-inbox or Northumbria-only.
  let screen = $derived(gateFor(account, page.url.pathname, finishing, page.data?.publicPage === true));

  // A logged-out visitor on a page that needs an account goes to log in, which brings them back
  // here. Only once Firebase says nobody is signed in: the moment after logging in, before that's
  // reported, currentUser is already set, so they're never sent back to log in.
  $effect(() => {
    if (screen === 'login' && !getFirebaseAuth().currentUser) sendToLogin();
  });

  // Every navigation goes on this tab's trail, so "← Back" knows the page they came from (back.js).
  afterNavigate((navigation) =>
    trail.record({
      type: navigation.type,
      delta: navigation.type === 'popstate' ? navigation.delta : null,
      to: navigation.to ? navigation.to.url.pathname + navigation.to.url.search : '/'
    })
  );

  /** Each page's tab title; every other page is just "AG2". */
  const TITLES = /** @type {Record<string, string>} */ ({ '/nhs-guide': 'NHS Guide', '/gp-finder': 'Find a GP', '/late-arrivals': 'Arriving late', '/about-you': 'What the chat knows' });
  let title = $derived(TITLES[page.url.pathname] ? `${TITLES[page.url.pathname]} · AG2` : 'AG2');

  onMount(() =>
    watchAccount((next) => {
      account = next;
      if (next?.verified) finish();
    })
  );

  // After logging in, or coming back still logged in: a student without a mentor downloads the
  // matching model in the background once the page has settled, so Find my mentor doesn't wait for
  // it (model-download.js). Its code only loads now, and it says nothing if it fails.
  $effect(() => {
    const uid = account?.verified && isUniEmail(account.email) ? account.uid : null;
    if (uid) import('#lib/matching/model-download-browser.js').then((model) => model.downloadAfterLogin(uid), () => {});
  });

  /**
   * Saves the sign-up that waited for this account's email to be verified (signup/waiting.js), if
   * there is one, then opens the app: a new mentor sees the thanks page, a new student goes Home.
   */
  async function finish() {
    const entry = waitingSignUp().load();
    if (!account || entry?.uid !== account.uid || (finishing && !finishProblem)) return;
    finishing = true;
    finishProblem = '';
    try {
      const saved = await finishSignUp(db, account.uid, waitingSignUp());
      finishing = false;
      if (saved === 'mentor') await goto('/mentor-signup?done');
      else if (saved === 'student' && page.url.pathname === '/signup') await goto('/home');
    } catch (err) {
      console.error('Saving the sign-up failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      finishProblem = 'We couldn’t finish setting up your account just now. Please try again.';
    }
  }

  // Opening the chat from Home slides the chat down over Home (see page-transitions.js and app.css),
  // where the browser has View Transitions and the phone isn't set to reduce motion.
  onNavigate((navigation) => {
    if (!opensChatFromHome(navigation.from?.url.pathname, navigation.to?.url.pathname)) return;
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    return new Promise((resolve) => {
      root.dataset.pageTransition = 'chat-open';
      const transition = document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
        await chatShown();
      });
      transition.finished.finally(() => delete root.dataset.pageTransition);
    });
  });
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if screen === 'checking' || screen === 'login'}
  <!-- Nothing yet: Firebase is checking for a saved login, or a logged-out visitor is on the way to log in. -->
{:else if screen === 'northumbria-only' && account}
  <NorthumbriaOnly email={account.email} />
{:else if screen === 'verify' && account}
  <VerifyEmail email={account.email} />
{:else if screen === 'finishing'}
  <main class="page">
    <h1>Setting up your account…</h1>
    {#if finishProblem}
      <p role="alert">{finishProblem}</p>
      <button class="primary-button" type="button" onclick={finish}>Try again</button>
      <p><button class="secondary-button" type="button" onclick={() => (finishing = false)}>Carry on without it for now</button></p>
    {/if}
  </main>
{:else}
  {@render children()}
{/if}
