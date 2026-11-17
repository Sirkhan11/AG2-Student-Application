
<script>
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { currentUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { sendToLogin } from '#lib/login-redirect.js';
  import { loadMyRecord } from '#lib/checklist/store.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
  import { startCheckinChat } from '#lib/checkin/chat.js';
  import { chatSession, clearChat, clearChatOnSignOut, geminiChat, setGeminiChat } from '#lib/checkin/chat-session.svelte.js';
  import { startsAfresh } from '#lib/checkin/keep-chat.js';
  import SocietyCard from '#lib/components/SocietyCard.svelte';
  import ServiceCard from '#lib/components/ServiceCard.svelte';
  import ClubCard from '#lib/components/ClubCard.svelte';
  import { clubBySlug } from '#lib/sport/clubs.js';
  import { serviceById } from '#lib/nsu/services.js';
  import { societyById } from '#lib/societies/societies.js';

  // The conversation (messages, cards, what they've typed, and Gemini's side) lives in
  // chat-session.svelte.js rather than here, so it's still there after visiting another page.

  // null while Firebase checks for a saved login.
  let signedIn = $state(/** @type {boolean | null} */ (null));
  /** @type {HTMLFormElement | undefined} */
  let form = $state();

  // Logged-out visitors go to login, which brings them back here afterwards. Logging out on any
  // page clears the conversation.
  $effect(() => {
    clearChatOnSignOut();
    return watchSignedIn((value) => {
      signedIn = value;
      if (value) start();
      else sendToLogin();
    });
  });

  /**
   * Shows the conversation kept from earlier, if it's theirs. Otherwise builds the first messages
   * from the student's match and checklist, and starts a new conversation, telling Gemini about
   * their match, checklist, course and interests (see describeForGemini in opener.js).
   */
  async function start() {
    const uid = currentUid();
    const justSignedUp = page.url.searchParams.get('from') === 'find-mentor';
    // So coming back to this page later (or going back to it) keeps the conversation.
    if (justSignedUp) replaceState('/check-in', {});
    if (!startsAfresh({ keptUid: chatSession.uid, started: chatSession.started, uid, fromFindMentor: justSignedUp })) {
      await showLatest();
      return;
    }

    clearChat(uid);
    const conversation = chatSession.conversation;
    // If either can't be loaded, the chat still starts; it just says less.
    // The checklist comes through the same loader as the checklist page, so the two always agree.
    const [match, record] = await Promise.all([
      loadMyMatch().catch((err) => (console.error(err), undefined)),
      loadMyRecord().catch((err) => (console.error(err), null))
    ]);
    const tasks = record?.checklist.tasks ?? null;
    const checklistSaved = record?.checklist.saved ?? false;
    const profile = { course: record?.course ?? null, interests: record?.interests ?? null };
    // Logged out, or started again, while those were loading.
    if (chatSession.conversation !== conversation) return;

    const opener = buildOpener({ match, tasks, checklistSaved, justSignedUp });
    chatSession.messages = opener.messages.map((text, i) => ({
      role: 'assistant',
      text,
      // The buttons go under the last of the first messages.
      links: i === opener.messages.length - 1 ? opener.links : undefined
    }));

    // Gemini is told the same facts and first messages, but without the mentor's name.
    const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
    setGeminiChat(
      startCheckinChat(
        describeForGemini({ match, tasks, checklistSaved, profile }),
        buildOpener({ match: withoutName, tasks, checklistSaved, justSignedUp }).messages
      )
    );
    chatSession.started = true;
  }

  async function sendMessage() {
    const text = chatSession.draft.trim();
    const chat = geminiChat();
    if (!text || chatSession.waiting || chatSession.unavailable || !chat) return;

    const conversation = chatSession.conversation;
    chatSession.messages.push({ role: 'user', text });
    chatSession.draft = '';
    chatSession.waiting = true;
    await showLatest();

    // Carries on if they move to another page meanwhile: the reply is there when they come back.
    const reply = await chat.send(text);
    // Logged out while waiting: the reply belongs to a conversation that's gone.
    if (chatSession.conversation !== conversation) return;
    chatSession.messages.push({
      role: 'assistant',
      text: reply.text,
      kind: reply.kind === 'reply' ? undefined : reply.kind,
      links:
        reply.kind === 'safety' || reply.kind === 'unavailable'
          ? [{ label: 'Need help now', href: '/need-help' }]
          : // Suggested societies and NSU services, shown as cards under the reply.
            reply.links
    });
    // Gemini's credit has run out: the message box is switched off, as trying again won't help.
    if (reply.kind === 'unavailable') chatSession.unavailable = true;
    chatSession.waiting = false;
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

  {#if !signedIn || chatSession.messages.length === 0}
    <p class="muted" role="status">Loading…</p>
  {:else}
    <p class="muted">
      Replies are written by Google’s Gemini AI. To help, Gemini is told whether you have a mentor and
      why you were matched, how often you asked to meet, your checklist progress, and the course and
      interests you gave when you signed up. It’s never told your name or email, or your mentor’s.
    </p>
    <p class="muted">
      This chat isn’t saved: it stays while the app is open in this tab, until you log out, and nothing
      you say is passed on to the university or your mentor. Google doesn’t use it to improve its
      products, but keeps messages for a limited time, only to detect misuse, keep its services safe
      and secure, and meet legal requirements, and they may be stored or cached in any country
      (<a
        href="https://ai.google.dev/gemini-api/terms"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Gemini API terms (opens in a new tab)">Gemini API terms ↗</a>).
      So please leave out names, contact details and anything you’d want kept private.
    </p>

    <div class="messages" aria-live="polite">
      {#each chatSession.messages as item, i (i)}
        {@const buttons = (item.links ?? []).filter((link) => !link.kind)}
        {@const cards = (item.links ?? []).filter((link) => link.kind)}
        <div
          class="bubble"
          class:user={item.role === 'user'}
          class:safety={item.kind === 'safety'}
          class:failed={item.kind === 'error' || item.kind === 'unavailable'}
        >
          {item.text}
          {#if buttons.length}
            <div class="links">
              {#each buttons as link (link.href + link.label)}
                {#if link.external}
                  <a
                    class="secondary-button"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${link.label} (opens in a new tab)`}
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
        {#if cards.length}
          <!-- Not read out as they arrive: the reply already names them, and screen reader users can move to them. -->
          <div class="cards" aria-live="off">
            {#each cards as link (link.href)}
              {@const society = link.kind === 'society' ? societyById(link.nsuId ?? -1) : null}
              {@const service = link.kind === 'service' ? serviceById(link.serviceId ?? '') : null}
              {@const club = link.kind === 'club' ? clubBySlug(link.slug ?? '') : null}
              {#if society}
                <SocietyCard {society} />
              {:else if club}
                <ClubCard {club} />
              {:else if service}
                <ServiceCard {service} />
              {/if}
            {/each}
          </div>
        {/if}
      {/each}
      {#if chatSession.waiting}
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
        placeholder={chatSession.unavailable ? 'The chat isn’t available right now' : 'Type your message...'}
        autocomplete="off"
        disabled={chatSession.waiting || chatSession.unavailable}
        bind:value={chatSession.draft}
      />

      <button class="primary-button" type="submit" disabled={chatSession.waiting || chatSession.unavailable}>
        {chatSession.waiting ? 'Waiting for a reply…' : chatSession.unavailable ? 'Chat unavailable' : 'Send'}
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

  /* Cards for suggested societies and services, the full width of the chat. */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

</style>
