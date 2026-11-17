
<script>
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { sendToLogin } from '#lib/login-redirect.js';
  import { loadSavedChecklist } from '#lib/checkin/saved-checklist.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
  import { startCheckinChat } from '#lib/checkin/chat.js';

  /**
   * One bubble. kind marks the fixed safety message or an error; links are buttons shown under it
   * (external ones, such as a society's NSU page, open in a new tab).
   * @typedef {{ role: 'assistant' | 'user', text: string, kind?: 'safety' | 'error',
   *   links?: { label: string, href: string, external?: boolean }[] }} Message
   */

  // null while Firebase checks for a saved login.
  let signedIn = $state(/** @type {boolean | null} */ (null));
  let messages = $state(/** @type {Message[]} */ ([]));
  let message = $state('');
  // True while waiting for a reply, so only one message is sent at a time.
  let waiting = $state(false);
  /** @type {HTMLFormElement | undefined} */
  let form = $state();

  // The Gemini conversation. Not $state, because the page never shows it directly.
  /** @type {ReturnType<typeof startCheckinChat> | null} */
  let chat = null;

  // Logged-out visitors go to login, which brings them back here afterwards.
  $effect(() =>
    watchSignedIn((value) => {
      signedIn = value;
      if (value) start();
      else sendToLogin();
    })
  );

  /** Builds the first messages from the student's match and checklist, then starts the chat. */
  async function start() {
    messages = [];
    // If either can't be loaded, the chat still starts; it just says less.
    const [match, tasks] = await Promise.all([
      loadMyMatch().catch((err) => (console.error(err), undefined)),
      loadSavedChecklist().catch((err) => (console.error(err), null))
    ]);
    const justSignedUp = page.url.searchParams.get('from') === 'find-mentor';

    const opener = buildOpener({ match, tasks, justSignedUp });
    messages = opener.messages.map((text, i) => ({
      role: 'assistant',
      text,
      // The buttons go under the last of the first messages.
      links: i === opener.messages.length - 1 ? opener.links : undefined
    }));

    // Gemini is told the same facts and first messages, but without the mentor's name.
    const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
    chat = startCheckinChat(
      describeForGemini({ match, tasks }),
      buildOpener({ match: withoutName, tasks, justSignedUp }).messages
    );
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text || waiting || !chat) return;

    messages.push({ role: 'user', text });
    message = '';
    waiting = true;
    await showLatest();

    const reply = await chat.send(text);
    messages.push({
      role: 'assistant',
      text: reply.text,
      kind: reply.kind === 'reply' ? undefined : reply.kind,
      links:
        reply.kind === 'safety'
          ? [{ label: 'Need help now', href: '/need-help' }]
          : // Suggested societies open their page in the app, which has the details and the NSU links.
            reply.societies?.map((society) => ({ label: society.name, href: `/societies/${society.nsuId}` }))
    });
    waiting = false;
    await showLatest();
  }

  /** Scrolls so the newest message and the message box are in view (handy on a phone). */
  async function showLatest() {
    await tick();
    form?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
</script>

<main class="page">
  <h1>Check-in Chat</h1>

  <p class="muted">
    A place to check in and find student support.
    This is not a medical or emergency service.
  </p>

  {#if !signedIn || messages.length === 0}
    <p class="muted" role="status">Loading…</p>
  {:else}
    <p class="muted">
      Replies are written by Google’s Gemini AI. This chat isn’t saved, and nothing you say is passed
      on to the university or your mentor. Google may use messages to improve its services, so please
      leave out names, contact details and anything you’d want kept private.
    </p>

    <div class="messages" aria-live="polite">
      {#each messages as item, i (i)}
        <div
          class="bubble"
          class:user={item.role === 'user'}
          class:safety={item.kind === 'safety'}
          class:failed={item.kind === 'error'}
        >
          {item.text}
          {#if item.links?.length}
            <div class="links">
              {#each item.links as link (link.href + link.label)}
                {#if link.external}
                  <a
                    class="secondary-button"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${link.label} on the NSU website (opens in a new tab)`}
                  >
                    {link.label} ↗
                  </a>
                {:else}
                  <a class="secondary-button" href={link.href}>{link.label}</a>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if waiting}
        <div class="bubble typing">Typing…</div>
      {/if}
    </div>

    <form bind:this={form} onsubmit={(event) => {
      event.preventDefault();
      sendMessage();
    }}>
      <label for="chat-message">Your message</label>

      <input
        id="chat-message"
        class="field"
        placeholder="Type your message..."
        autocomplete="off"
        disabled={waiting}
        bind:value={message}
      />

      <button class="primary-button" type="submit" disabled={waiting}>
        {waiting ? 'Waiting for a reply…' : 'Send'}
      </button>
    </form>
  {/if}

  <p><a href="/need-help">Need help now?</a></p>

  <BottomNav />
</main>

<style>
  .messages {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 280px;
    margin: 20px 0;
  }

  .bubble {
    align-self: flex-start;
    max-width: 85%;
    padding: 13px;
    border-radius: 14px;
    background: #eaf2f8;
  }

  .bubble.user {
    align-self: flex-end;
    background: #1764a1;
    color: white;
  }

  .bubble.safety {
    background: #fdecea;
    border: 1px solid #e8b6b1;
  }

  .bubble.failed,
  .bubble.typing {
    color: #647780;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

</style>
