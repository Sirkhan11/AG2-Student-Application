<script>
  import { onDestroy } from 'svelte';
  import { getFirebaseAuth } from '#lib/firebase/client.js';
  import { checkVerified, sendVerification } from '#lib/firebase/verify.js';
  import { wordingFor } from '#lib/access.js';
  import LogoutButton from '#lib/components/LogoutButton.svelte';
  import Icon from '#lib/components/Icon.svelte';

  /**
   * The check-your-inbox screen. The root layout shows it instead of the app while the signed-in
   * account's email isn't verified (see account-gate.js). "I've clicked it" checks with Firebase; once
   * it's verified, the layout takes over (it saves any sign-up that waited, then opens the app). The
   * wording follows the access switch (access.js): "uni inbox" and "Northumbria email" only while it's
   * on (uniOnly true, or null while it's being read).
   * @type {{ email: string, uniOnly?: boolean | null }}
   */
  let { email, uniOnly = null } = $props();
  let words = $derived(wordingFor(uniOnly));

  /** Seconds before Resend can be pressed again, so a student can't trip Firebase's limit by accident. */
  const RESEND_WAIT = 60;

  let checking = $state(false);
  let sending = $state(false);
  let message = $state('');
  let wait = $state(0);
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;

  function startWait() {
    wait = RESEND_WAIT;
    clearInterval(timer);
    timer = setInterval(() => {
      wait -= 1;
      if (wait <= 0) clearInterval(timer);
    }, 1000);
  }
  onDestroy(() => clearInterval(timer));

  async function clicked() {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    checking = true;
    message = '';
    try {
      if (!(await checkVerified(user))) {
        message = 'It isn’t verified yet. Check your Junk folder, or send the email again.';
      }
    } catch (err) {
      console.error('Checking the email failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      message = 'We couldn’t check just now. Please try again.';
    } finally {
      checking = false;
    }
  }

  async function resend() {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    sending = true;
    message = '';
    try {
      await sendVerification(user);
      message = 'Sent again. It can take a few minutes, so check Junk too.';
      startWait();
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err)?.code;
      console.error('Resending the email failed:', code ?? err);
      message =
        code === 'auth/too-many-requests'
          ? 'We’ve sent a few already. Please wait a few minutes, then try again.'
          : 'We couldn’t send it just now. Please try again.';
      if (code === 'auth/too-many-requests') startWait();
    } finally {
      sending = false;
    }
  }
</script>

<main class="page">
  <span class="mail"><Icon name="mail" size={28} /></span>
  <h1>{words.inboxHeading}</h1>
  <p>
    We’ve sent a link to <strong>{email}</strong>. Click it to verify your address, then come back here
    and tap “I’ve clicked it”.
  </p>
  <p class="muted">It can take a few minutes. If it isn’t in your inbox, look in your Junk folder.</p>

  <div class="actions">
    <button class="primary-button" type="button" onclick={clicked} disabled={checking || sending}>
      {checking ? 'Checking…' : 'I’ve clicked it'}
    </button>
    <button class="secondary-button" type="button" onclick={resend} disabled={checking || sending || wait > 0}>
      {sending ? 'Sending…' : wait > 0 ? `Resend (${wait}s)` : 'Resend the email'}
    </button>
  </div>
  {#if message}
    <p role="status">{message}</p>
  {/if}

  <p class="muted">{words.wrongAddress}</p>
  <div class="logout-slot"><LogoutButton /></div>
  <p><a href="/need-help">Need help now</a></p>
</main>

<style>
  .mail {
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    margin: 8px 0 12px;
    border-radius: 50%;
    color: var(--violet);
    background: var(--violet-soft);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0;
  }
</style>
