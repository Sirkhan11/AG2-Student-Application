
<script>
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { currentUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { loadMyRecord } from '#lib/checklist/store.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
  import { startCheckinChat } from '#lib/checkin/chat.js';
  import {
    chatFlow,
    chatSession,
    clearChat,
    clearChatOnSignOut,
    geminiChat,
    notesChanged,
    setChatFacts,
    setChatFlow,
    setGeminiChat,
    tellGemini
  } from '#lib/checkin/chat-session.svelte.js';
  import { createMentorFlow } from '#lib/checkin/mentor-flow.js';
  import { hasMentorProfile } from '#lib/matching/mentor-account.js';
  import { getReadyForMatching, modelReady } from '#lib/matching/model-download-browser.js';
  import ChatFlowCard from '#lib/components/ChatFlowCard.svelte';
  import ChatOfferCard from '#lib/components/ChatOfferCard.svelte';
  import { startsAfresh } from '#lib/checkin/keep-chat.js';
  import SocietyCard from '#lib/components/SocietyCard.svelte';
  import ServiceCard from '#lib/components/ServiceCard.svelte';
  import ClubCard from '#lib/components/ClubCard.svelte';
  import TaskSuggestionCard from '#lib/components/TaskSuggestionCard.svelte';
  import RememberCard from '#lib/components/RememberCard.svelte';
  import { loadMyNotes } from '#lib/checkin/chat-notes.js';
  import { db } from '#lib/firebase/client.js';
  import { isoDate } from '#lib/checkin/about-you.js';
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
      // Logged out: the root layout sends them to log in (see account-gate.js).
    });
  });

  /**
   * Shows the conversation kept from earlier, if it's theirs. Otherwise builds the first messages
   * from the student's match and checklist, and starts a new conversation, telling Gemini about
   * them: the about-you record (their first name, course, interests, arrival date, the summary from
   * finding a mentor and what they asked it to remember), their match and their checklist (see
   * describeForGemini in opener.js).
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
    const [match, record, isMentor, notes] = await Promise.all([
      loadMyMatch().catch((err) => (console.error(err), undefined)),
      loadMyRecord().catch((err) => (console.error(err), null)),
      hasMentorProfile().catch(() => false),
      (uid ? loadMyNotes(db, uid) : Promise.resolve([])).catch((err) => (console.error(err), []))
    ]);
    const tasks = record?.checklist.tasks ?? null;
    const checklistSaved = record?.checklist.saved ?? false;
    // Only the first name comes from the record (loadMyRecord): never their full name or email.
    const profile = { ...record, checklist: undefined, notes: notes.map((note) => note.text) };
    const today = isoDate(new Date());
    // Logged out, or started again, while those were loading.
    if (chatSession.conversation !== conversation) return;

    const opener = buildOpener({ match, tasks, checklistSaved, justSignedUp, isMentor });
    chatSession.messages = opener.messages.map((text, i) => ({
      role: 'assistant',
      text,
      // The buttons go under the last of the first messages.
      links: i === opener.messages.length - 1 ? opener.links : undefined
    }));

    // Gemini is told the same facts and first messages, but without the mentor's name. The facts are
    // kept, so Gemini can be told again when they change here (a mentor found in the chat, say).
    const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
    setChatFacts({ match, tasks, checklistSaved, profile, isMentor, today });
    setGeminiChat(
      startCheckinChat(
        describeForGemini({ match, tasks, checklistSaved, profile, isMentor, today }),
        buildOpener({ match: withoutName, tasks, checklistSaved, justSignedUp, isMentor }).messages
      )
    );
    chatSession.started = true;
  }

  // ---------- The chat's own actions (chat-actions.js): for now, finding a mentor ----------


  /** The mentor flow for this conversation, made the first time it's started. */
  function mentorFlow() {
    let flow = chatFlow();
    if (!flow) {
      const conversation = chatSession.conversation;
      flow = createMentorFlow({
        // The matching code loads only when a student starts this, and its model when the questions start.
        check: async () => (await import('#lib/matching/find-match.js')).checkBeforeMatching(),
        steps: {
          prepareStudent: async (answers) => (await import('#lib/matching/find-match.js')).prepareStudent(answers),
          matchAndSave: async (prepared, preferences) => (await import('#lib/matching/find-match.js')).matchAndSave(prepared, preferences),
          askCoordinator: async (answers, preferences) => (await import('#lib/matching/find-match.js')).askCoordinator(answers, preferences),
          getReady: getReadyForMatching,
          modelReady
        },
        post: (message) => {
          if (chatSession.conversation !== conversation) return;
          chatSession.messages.push({ role: message.role, text: message.text, flow: message.card });
          showLatest(message.question);
        },
        changed: (state) => {
          if (chatSession.conversation === conversation) chatSession.flow = state;
        },
        finished: async (result) => {
          if (chatSession.conversation !== conversation) return;
          // So Gemini knows how it ended, and doesn't offer it again.
          if (result.outcome === 'stopped' || result.outcome === 'no-mentors') tellGemini({ mentorNote: result.outcome });
          else if (result.outcome === 'is-mentor') tellGemini({ isMentor: true });
          else tellGemini({ match: result.match ?? (await loadMyMatch().catch(() => undefined)), mentorNote: null });
        }
      });
      setChatFlow(flow);
    }
    return flow;
  }

  /** Starts one of the chat's own actions: from an offer card's Start, or a first-message button. @param {string} action */
  function startAction(action) {
    if (action === 'mentor' && !chatSession.flow?.active) mentorFlow().start();
  }

  /** A note was saved from a Remember card: Gemini is told what it now remembers. */
  async function noteSaved() {
    const uid = currentUid();
    const notes = uid ? await loadMyNotes(db, uid).catch(() => null) : null;
    if (notes) notesChanged(notes.map((note) => note.text));
  }

  /** They tapped Not now on an offer: Gemini is told, so it doesn't offer again unless they ask. @param {string} action */
  function declineAction(action) {
    if (action === 'mentor') tellGemini({ mentorNote: 'declined' });
  }

  /** True while the app is running an action in the chat: what they type goes to it, not to Gemini. */
  let flowActive = $derived(chatSession.flow?.active === true);
  let flowBusy = $derived(chatSession.flow?.step === 'busy' || chatSession.flow?.step === 'checking');

  async function sendMessage() {
    const text = chatSession.draft.trim();
    // While the app is running an action (finding a mentor), what they type is its answer: it goes to
    // the action, never to Gemini.
    const flow = chatFlow();
    if (text && flowActive && flow) {
      chatSession.messages.push({ role: 'user', text });
      chatSession.draft = '';
      flow.reply(text);
      await showLatest();
      return;
    }
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
            reply.links,
      // A checklist task it suggested: a card with Add and No thanks. Nothing is added without a tap.
      task: reply.tasks?.[0] ? { title: reply.tasks[0], state: 'offered' } : undefined,
      // One of the chat's own actions it offered (finding a mentor): a card with Start and Not now.
      offer: reply.offers?.[0] ? { action: reply.offers[0], state: 'offered' } : undefined,
      // Something it offered to remember: a card with Remember and Not now. Nothing is saved without a tap.
      note: reply.notes?.[0] ? { text: reply.notes[0], state: 'offered' } : undefined
    });
    // Gemini's credit has run out: the message box is switched off, as trying again won't help.
    if (reply.kind === 'unavailable') chatSession.unavailable = true;
    chatSession.waiting = false;
    await showLatest();
  }

  /**
   * Scrolls so the newest message and the message box are in view (handy on a phone). After one of
   * the app's questions, the focus goes to the message box, so they can type the answer straight away
   * (the question itself is read out, as the messages are a live region).
   * @param {boolean} [question]
   */
  async function showLatest(question = false) {
    await tick();
    form?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (question) /** @type {HTMLInputElement | null} */ (document.getElementById('chat-message'))?.focus();
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
      Replies are written by Google’s Gemini AI. To help, Gemini is told your first name; the course,
      interests and arrival date you gave when you signed up; whether you have a mentor, why you were
      matched and how often you asked to meet; a short summary of your answers from finding a mentor;
      your checklist progress; and anything you’ve asked it to remember. It’s never told your full name
      or email, or your mentor’s name. <a href="/about-you">See what the chat knows about you</a>.
    </p>
    <p class="muted">
      This chat isn’t saved: it stays while the app is open in this tab, until you log out, and nothing
      you say is passed on to the university or your mentor. If it suggests a reminder and you tap Add,
      that task is saved to your checklist, and if it offers to remember something and you tap
      Remember, that’s kept for later chats until you delete it. If you find a mentor here, your answers
      are saved when you choose Find my mentor, as on the Find a mentor page; they’re never sent to
      Gemini as chat messages, though it’s told the short summary. Google doesn’t use the chat to improve its
      products, but keeps messages for a limited time, only to detect misuse, keep its services safe
      and secure, and meet legal requirements, and they may be stored or cached in any country
      (<a
        href="https://ai.google.dev/gemini-api/terms"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Gemini API terms (opens in a new tab)">Gemini API terms ↗</a>).
      So please leave out names, contact details and anything you’d want kept private.
    </p>

    <!-- data-chat-ready: the slide from Home waits for this, so the whole chat slides in. -->
    <div class="messages" aria-live="polite" data-chat-ready>
      {#each chatSession.messages as item, i (i)}
        {@const buttons = (item.links ?? []).filter((link) => !link.kind)}
        {@const cards = (item.links ?? []).filter((link) => link.kind)}
        <!-- A reply that's only an offer (its card says it all) has no bubble of its own. -->
        <div
          class="bubble"
          hidden={item.text.trim() === '' && !buttons.length}
          class:user={item.role === 'user'}
          class:safety={item.kind === 'safety'}
          class:failed={item.kind === 'error' || item.kind === 'unavailable'}
        >
          {item.text}
          {#if buttons.length}
            <div class="links">
              {#each buttons as link (link.href + link.label)}
                {#if link.action}
                  <!-- One of the chat's own actions: it starts right here, rather than opening a page. -->
                  <button class="secondary-button" type="button" disabled={flowActive} onclick={() => startAction(/** @type {string} */ (link.action))}>{link.label}</button>
                {:else if link.external}
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
        {#if item.task}
          <div class="cards">
            <TaskSuggestionCard bind:task={item.task} />
          </div>
        {/if}
        {#if item.note}
          <div class="cards">
            <RememberCard bind:note={item.note} onsaved={noteSaved} />
          </div>
        {/if}
        {#if item.offer}
          <div class="cards">
            <ChatOfferCard
              bind:offer={item.offer}
              disabled={flowActive}
              onstart={() => startAction(/** @type {NonNullable<typeof item.offer>} */ (item.offer).action)}
              ondecline={() => declineAction(/** @type {NonNullable<typeof item.offer>} */ (item.offer).action)}
            />
          </div>
        {/if}
        {#if item.flow}
          <div class="cards">
            <ChatFlowCard card={item.flow} live={flowActive && chatSession.flow?.live === item.flow.id && !flowBusy} flow={chatFlow()} />
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
        placeholder={flowActive ? 'Type your answer, or stop to stop' : chatSession.unavailable ? 'The chat isn’t available right now' : 'Type your message...'}
        autocomplete="off"
        disabled={flowActive ? flowBusy : chatSession.waiting || chatSession.unavailable}
        bind:value={chatSession.draft}
      />

      <button class="primary-button" type="submit" disabled={flowActive ? flowBusy : chatSession.waiting || chatSession.unavailable}>
        {flowActive ? 'Send answer' : chatSession.waiting ? 'Waiting for a reply…' : chatSession.unavailable ? 'Chat unavailable' : 'Send'}
      </button>
      {#if flowActive && !flowBusy}
        <!-- Ends finding a mentor at any point before Find my mentor, with nothing saved. -->
        <button class="secondary-button" type="button" onclick={() => chatFlow()?.stop()}>Stop</button>
      {/if}
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
