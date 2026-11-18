<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { getFirebaseAuth } from '#lib/firebase/client.js';
  import { checkVerified, SENT_EVENT, sendVerification, sentThisVisit } from '#lib/firebase/verify.js';
  import { wordingFor } from '#lib/access.js';
  import LogoutButton from '#lib/components/LogoutButton.svelte';
  import Icon from '#lib/components/Icon.svelte';

  /**
   * The check-your-inbox screen. The root layout shows it instead of the app while the signed-in
   * account's email isn't verified (see account-gate.js). "I've clicked it" checks with Firebase; once
   * it's verified, the layout takes over (it saves any sign-up that waited, then opens the app). The
   * wording follows the access switch (access.js): "uni inbox" and "Northumbria email" only while it's
   * on (uniOnly true, or null while it's being read).
   *
   * It says a link was sent only when this tab sent one (sentThisVisit in verify.js; signing up sends
   * it). An account that logs in unverified, such as one made before verification existed, is told
   * plainly that its address isn't verified yet and offered the link: on 18 November Thomas searched
   * his inbox and Spam for a link this screen said it had sent, when nothing had been.
   * @type {{ email: string, uniOnly?: boolean | null }}
   */
  let { email, uniOnly = null } = $props();
  let words = $derived(wordingFor(uniOnly));

  /** Seconds before the link can be sent again, so a student can't trip Firebase's limit by accident. */
  const RESEND_WAIT = 60;

  /** When this tab sent them a link, or null: none yet, so the screen offers to send one. */
  let sentAt = $state(sentThisVisit(getFirebaseAuth().currentUser?.uid));
  let sent = $derived(sentAt !== null);
  let checking = $state(false);
  let sending = $state(false);
  let message = $state('');
  let wait = $state(0);
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  /** The two buttons' box. @type {HTMLDivElement | undefined} */
  let actions = $state();

  /**
   * Runs one of the buttons' jobs. The buttons are switched off while it runs, which takes the focus
   * off them, so the button that had it gets it back afterwards: a keyboard or screen reader user
   * stays where they were (the same two buttons show in both states).
   * @param {() => Promise<void>} job
   */
  async function keepingFocus(job) {
    const had = actions?.contains(document.activeElement) ? /** @type {HTMLElement} */ (document.activeElement) : null;
    try {
      await job();
    } finally {
      if (had) {
        await tick();
        had.focus();
      }
    }
  }

  /** Counts down until the link can be sent again. @param {number} seconds */
  function startWait(seconds) {
    wait = Math.max(0, Math.min(RESEND_WAIT, Math.ceil(seconds)));
    clearInterval(timer);
    if (wait === 0) return;
    timer = setInterval(() => {
      wait -= 1;
      if (wait <= 0) clearInterval(timer);
    }, 1000);
  }
  /** What's left of the wait after a link sent at this time (it carries on after a reload). @param {number} at */
  const waitAfter = (at) => RESEND_WAIT - (Date.now() - at) / 1000;

  onMount(() => {
    if (sentAt !== null) startWait(waitAfter(sentAt));
    // Signing up sends the link while this screen is already showing: it hears when it's gone.
    /** @param {Event} event */
    const heard = (event) => {
      const detail = /** @type {CustomEvent<{ uid: string, at: number }>} */ (event).detail;
      if (!detail || detail.uid !== getFirebaseAuth().currentUser?.uid) return;
      sentAt = detail.at;
      startWait(waitAfter(detail.at));
    };
    window.addEventListener(SENT_EVENT, heard);
    return () => window.removeEventListener(SENT_EVENT, heard);
  });
  onDestroy(() => clearInterval(timer));

  async function clicked() {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    checking = true;
    message = '';
    try {
      if (!(await checkVerified(user))) {
        message = sent ? 'It isn’t verified yet. Check your Junk folder, or send the email again.' : 'It isn’t verified yet. Tap “Send the link” to get one.';
      }
    } catch (err) {
      console.error('Checking the email failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      message = 'We couldn’t check just now. Please try again.';
    } finally {
      checking = false;
    }
  }

  async function send() {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    const again = sent;
    sending = true;
    message = '';
    try {
      await sendVerification(user);
      message = again ? 'Sent again. It can take a few minutes, so check Junk too.' : 'Sent. It can take a few minutes, so check Junk too.';
      startWait(RESEND_WAIT);
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err)?.code;
      console.error('Sending the email failed:', code ?? err);
      message =
        code === 'auth/too-many-requests'
          ? 'We’ve sent a few already. Please wait a few minutes, then try again.'
          : 'We couldn’t send it just now. Please try again.';
      if (code === 'auth/too-many-requests') startWait(RESEND_WAIT);
    } finally {
      sending = false;
    }
  }
</script>

<main class="page">
  <span class="mail"><Icon name="mail" size={28} /></span>
  {#if sent}
    <h1>{words.inboxHeading}</h1>
    <p>
      We’ve sent a link to <strong>{email}</strong>. Click it to verify your address, then come back here
      and tap “I’ve clicked it”.
    </p>
    <p class="muted">It can take a few minutes. If it isn’t in your inbox, look in your Junk folder.</p>
  {:else}
    <h1>Verify your email address</h1>
    <p>
      Your address, <strong>{email}</strong>, isn’t verified yet. Send yourself the link, click it in the
      email, then come back here and tap “I’ve clicked it”.
    </p>
    <p class="muted">If you already have a link from us, you can use that one instead.</p>
  {/if}

  <!-- The same two buttons either way, so the focus stays put when the link goes: before it's sent,
       Send the link comes first; after, I've clicked it does. -->
  <div class="actions" bind:this={actions}>
    <button class="primary-button" type="button" onclick={() => keepingFocus(sent ? clicked : send)} disabled={checking || sending || (!sent && wait > 0)}>
      {#if sent}{checking ? 'Checking…' : 'I’ve clicked it'}{:else}{sending ? 'Sending…' : wait > 0 ? `Send the link (${wait}s)` : 'Send the link'}{/if}
    </button>
    <button class="secondary-button" type="button" onclick={() => keepingFocus(sent ? send : clicked)} disabled={checking || sending || (sent && wait > 0)}>
      {#if sent}{sending ? 'Sending…' : wait > 0 ? `Resend (${wait}s)` : 'Resend the email'}{:else}{checking ? 'Checking…' : 'I’ve clicked it'}{/if}
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
