
<script>
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { currentUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { loadChecklist, loadMyRecord, saveChange } from '#lib/checklist/store.js';
  import { applyChange, makeTick } from '#lib/checklist/tasks.js';
  import { createChecklistTalk, QUICK } from '#lib/checkin/checklist-talk.js';
  import { firstDoneNote } from '#lib/checkin/chat-turns.js';
  import Ask4HelpLink from '#lib/components/Ask4HelpLink.svelte';
  import GpFinderCard from '#lib/components/GpFinderCard.svelte';
  import KeyContactsCard from '#lib/components/KeyContactsCard.svelte';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { buildOpener } from '#lib/checkin/opener.js';
  import { startCheckinChat } from '#lib/checkin/chat.js';
  import {
    chatFlow,
    chatFlowFor,
    runChatFlow,
    chatSession,
    clearChat,
    clearChatOnSignOut,
    geminiChat,
    notesChanged,
    chatFacts,
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
  import YourMentorCard from '#lib/components/YourMentorCard.svelte';
  import { chatAction } from '#lib/checkin/chat-actions.js';
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
      // The buttons go under the first message; Yes and Not yet under the checklist question (the last).
      links: i === 0 ? opener.links : undefined,
      quick: opener.asks && i === opener.messages.length - 1 ? { options: QUICK.yesNo, open: true } : undefined
    }));

    // Gemini is told the same facts and first messages, but without the mentor's name. The facts are
    // kept, so Gemini can be told again when they change here (a mentor found in the chat, say).
    const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
    const facts = { match, tasks, checklistSaved, profile, isMentor, today };
    setChatFacts(facts);
    setGeminiChat(startCheckinChat(facts, buildOpener({ match: withoutName, tasks, checklistSaved, justSignedUp, isMentor, forGemini: true }).messages));
    chatSession.started = true;
    // The first message asked about the first task still to do: the checklist talk waits for the answer.
    if (opener.asks) await checklistTalk().start({ asked: true });

    // Straight from finding a mentor on the Find a mentor page: Gemini writes the next message itself.
    const outcome = match?.status;
    if (justSignedUp && record?.matchingSummary && (outcome === 'matched' || outcome === 'coordinator')) await followUpAfterMentor(outcome);
  }

  // ---------- The chat's own actions (chat-actions.js): for now, finding a mentor ----------


  /** The mentor flow for this conversation, made the first time it's started. */
  function mentorFlow() {
    let flow = chatFlowFor('mentor');
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
          else {
            // Matched, or with the coordinator: Gemini is told, with the summary of their answers, and
            // then writes the next message itself (followUpAfterMentor).
            const match = result.match ?? (await loadMyMatch().catch(() => undefined));
            const profile = chatFacts()?.profile;
            tellGemini({ match, mentorNote: null, ...(result.summary ? { profile: { ...profile, matchingSummary: result.summary } } : {}) });
            if (result.summary && (result.outcome === 'matched' || result.outcome === 'coordinator')) await followUpAfterMentor(result.outcome);
          }
        }
      });
      setChatFlow('mentor', flow);
    }
    runChatFlow('mentor');
    return flow;
  }

  /**
   * Going through their checklist here as a conversation (checklist-talk.js), made the first time it's
   * needed. Yes ticks a task through the checklist's own change, as the checklist page does, and
   * Gemini is told the checklist as it is now; what's said is kept on Gemini's side of the
   * conversation too (note), so the ordinary chat knows. Gemini reads typed answers and helps with a
   * task only in the checklist's own modes, and is never told the words of one of their own tasks.
   */
  function checklistTalk() {
    let talk = chatFlowFor('checklist');
    if (!talk) {
      const conversation = chatSession.conversation;
      const chat = () => /** @type {NonNullable<ReturnType<typeof geminiChat>>} */ (geminiChat());
      /** Asks Gemini something for the talk, with Typing… meanwhile. @template T @param {() => Promise<T>} asking */
      const withTyping = async (asking) => {
        chatSession.waiting = true;
        await showLatest();
        try {
          return await asking();
        } finally {
          if (chatSession.conversation === conversation) chatSession.waiting = false;
        }
      };
      talk = createChecklistTalk({
        load: loadChecklist,
        tick: async (id, done, list) => {
          const change = makeTick(id, done);
          const onScreen = applyChange(list, change);
          const result = await saveChange(change, onScreen);
          const now = result.status === 'saved' ? result.list : onScreen;
          if (chatSession.conversation === conversation) tellGemini({ tasks: now, checklistSaved: true });
          return now;
        },
        post: (message) => {
          if (chatSession.conversation !== conversation) return;
          if (message.quick) closeQuickReplies();
          chatSession.messages.push({
            role: 'assistant',
            text: message.text,
            kind: message.kind,
            links: message.links?.length ? message.links : undefined,
            quick: message.quick ? { options: message.quick, open: true } : undefined,
            ticked: message.ticked ? { ...message.ticked, undone: false } : undefined,
            tool: message.tool,
            ask4help: message.ask4help
          });
          if (message.kind === 'unavailable') chatSession.unavailable = true;
          showLatest();
        },
        record: (student, text) => {
          if (chatSession.conversation === conversation) geminiChat()?.note(student, text);
        },
        answer: (text, task, question) => withTyping(() => chat().checklistAnswer(text, task, question)),
        help: (text, task, first, fromApp) => withTyping(() => chat().checklistHelp(text, task, first, fromApp)),
        firstDone: (first, then) => firstDoneNote(first.title, then.title),
        changed: (state) => {
          if (chatSession.conversation !== conversation) return;
          chatSession.flow = { ...state, kind: 'checklist' };
          // Once it's over, its quick replies go (Stop, or a change of subject).
          if (!state.active) closeQuickReplies();
        },
        finished: async (result) => {
          if (chatSession.conversation !== conversation) return;
          // Gemini's told the checklist as it is now, and not to start it again unless asked.
          tellGemini({
            tasks: result.tasks,
            checklistSaved: true,
            ...(result.outcome === 'stopped' || result.outcome === 'declined' ? { checklistNote: result.outcome } : {})
          });
          // They changed the subject: the ordinary chat answers what they typed.
          if (result.outcome === 'other' && result.text) await askGemini(result.text);
        }
      });
      setChatFlow('checklist', talk);
    }
    runChatFlow('checklist');
    return talk;
  }

  /** Quick replies only work under the newest question: older ones close. */
  function closeQuickReplies() {
    for (const message of chatSession.messages) if (message.quick?.open) message.quick.open = false;
  }

  /** Undo on a "Ticked" line. @param {import('#lib/checkin/chat-session.svelte.js').Message} message */
  function undoTick(message) {
    if (!message.ticked || message.ticked.undone) return;
    message.ticked.undone = true;
    closeQuickReplies();
    void checklistTalk().undo(message.ticked.id);
  }

  /**
   * Starts one of the chat's own actions: from an offer card's Start, or a first-message button.
   * Finding a mentor while going through the checklist ends the checklist quietly (a change of subject).
   * @param {string} action
   */
  function startAction(action) {
    if (chatSession.flow?.active && chatSession.flow.kind === 'checklist') chatFlowFor('checklist')?.stop({ quietly: true });
    if (chatSession.flow?.active) return;
    closeQuickReplies();
    if (action === 'mentor') mentorFlow().start();
    else if (action === 'checklist') void checklistTalk().start();
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

  /** True while the app is running an action in the chat. */
  let flowActive = $derived(chatSession.flow?.active === true);
  let flowBusy = $derived(chatSession.flow?.step === 'busy' || chatSession.flow?.step === 'checking');
  /** Finding a mentor takes everything they type, as its answers. */
  let flowTakesAll = $derived(flowActive && chatSession.flow?.kind === 'mentor');
  /** Going through the checklist: what they type is an answer, read by the talk (which passes a change of subject on). */
  let talking = $derived(flowActive && chatSession.flow?.kind === 'checklist');

  /** @param {string} [typed] what to send: what's in the message box, a quick reply, or a card's question */
  async function sendMessage(typed) {
    const text = (typed ?? chatSession.draft).trim();
    if (!text) return;
    // While finding a mentor, what they type is its answer: it goes to the action, never to Gemini.
    // While going through the checklist, it's an answer for the talk, which reads it (and passes a
    // change of subject on to the ordinary chat).
    const flow = chatFlow();
    if (flowActive && flow?.takes(text)) {
      chatSession.messages.push({ role: 'user', text });
      if (typed === undefined) chatSession.draft = '';
      closeQuickReplies();
      await showLatest();
      await flow.reply(text);
      await showLatest();
      return;
    }
    if (chatSession.waiting || chatSession.unavailable || !geminiChat()) return;
    chatSession.messages.push({ role: 'user', text });
    if (typed === undefined) chatSession.draft = '';
    closeQuickReplies();
    await askGemini(text);
  }

  /**
   * Sends what they said (already shown) to the ordinary chat, and shows the reply.
   * @param {string} text
   */
  async function askGemini(text) {
    const chat = geminiChat();
    if (!chat || chatSession.unavailable) return;
    const conversation = chatSession.conversation;
    chatSession.waiting = true;
    await showLatest();

    // Carries on if they move to another page meanwhile: the reply is there when they come back.
    const reply = await chat.send(text);
    // Logged out while waiting: the reply belongs to a conversation that's gone.
    if (chatSession.conversation !== conversation) return;
    showReply(reply);
    // Gemini's credit has run out: the message box is switched off, as trying again won't help.
    if (reply.kind === 'unavailable') chatSession.unavailable = true;
    chatSession.waiting = false;
    await showLatest();
    // Going through the checklist: straight away when they asked, or a one-line offer.
    if (reply.offers?.[0] === 'checklist') await checklistTalk().start({ from: reply.startAt });
    else if (reply.offers?.[0] === 'checklist-offer') checklistTalk().offer();
  }

  /**
   * Shows one of Gemini's replies (or the fixed support, error or unavailable message) with its cards.
   * @param {import('#lib/checkin/chat-turns.js').ChatReply} reply
   */
  function showReply(reply) {
    // One of the chat's own actions it chose: an offer with Start and Not now, or (shows: 'card') a
    // card shown straight away, such as their mentor. Going through the checklist has no card: it
    // starts, or is offered in one line, after this reply (askGemini).
    const action = reply.offers?.[0] ? chatAction(reply.offers[0]) : null;
    chatSession.messages.push({
      role: 'assistant',
      text: reply.text,
      kind: reply.kind === 'reply' || reply.kind === 'skip' ? undefined : reply.kind,
      links:
        reply.kind === 'safety' || reply.kind === 'unavailable'
          ? [{ label: 'Need help now', href: '/need-help' }]
          : // Suggested societies and NSU services, shown as cards under the reply.
            reply.links,
      // A checklist task it suggested: a card with Add and No thanks. Nothing is added without a tap.
      task: reply.tasks?.[0] ? { title: reply.tasks[0], state: 'offered' } : undefined,
      // One of the chat's own actions it offered (finding a mentor): a card with Start and Not now.
      offer: action && action.shows !== 'card' ? { action: action.id, state: 'offered' } : undefined,
      // Their mentor, or the form for a different one: read and sent here, never through Gemini.
      appCard: action?.shows === 'card' ? /** @type {'your-mentor' | 'change-mentor'} */ (action.id) : undefined,
      // Something it offered to remember: a card with Remember and Not now. Nothing is saved without a tap.
      note: reply.notes?.[0] ? { text: reply.notes[0], state: 'offered' } : undefined
    });
  }

  /**
   * Straight after they find a mentor (here in the chat, or on the Find a mentor page), Gemini writes
   * the next message itself: up to 3 clubs, societies or services from the summary of their answers,
   * and one gentle question (afterMatchRequest in chat-prompt.js). Not after the support message has
   * been shown in this conversation, or when the chat isn't available; and Gemini says nothing (skip)
   * if they've seemed worried or upset. If it fails, nothing is shown: it's extra.
   * @param {'matched' | 'coordinator'} outcome
   */
  async function followUpAfterMentor(outcome) {
    const chat = geminiChat();
    if (!chat || chatSession.unavailable || chatSession.messages.some((message) => message.kind === 'safety')) return;
    const conversation = chatSession.conversation;
    chatSession.waiting = true;
    await showLatest();
    const reply = await chat.afterMatch(outcome);
    if (chatSession.conversation !== conversation) return;
    if (reply.kind === 'reply' || reply.kind === 'safety') showReply(reply);
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
      you say is passed on to the university or your mentor. If you go through your checklist here,
      answering yes ticks that task on it (Undo unticks it). If it suggests a reminder and you tap Add,
      that task is saved to your checklist, and if it offers to remember something and you tap
      Remember, that’s kept for later chats until you delete it. If you find a mentor here, your answers
      are saved when you choose Find my mentor, as on the Find a mentor page; they’re never sent to
      Gemini as chat messages, though it’s told the short summary, and straight after, it suggests a few
      things that might suit you. Google doesn’t use the chat to improve its
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
                  <!-- Works while going through the checklist too: starting it ends that quietly. -->
                  <button class="secondary-button" type="button" disabled={flowTakesAll || flowBusy} onclick={() => startAction(/** @type {string} */ (link.action))}>{link.label}</button>
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
              disabled={flowTakesAll || flowBusy}
              onstart={() => startAction(/** @type {NonNullable<typeof item.offer>} */ (item.offer).action)}
              ondecline={() => declineAction(/** @type {NonNullable<typeof item.offer>} */ (item.offer).action)}
            />
          </div>
        {/if}
        {#if item.appCard}
          <div class="cards">
            <YourMentorCard change={item.appCard === 'change-mentor'} />
          </div>
        {/if}
        {#if item.flow}
          <div class="cards">
            <ChatFlowCard card={item.flow} live={flowActive && chatSession.flow?.kind === 'mentor' && chatSession.flow.live === item.flow.id && !flowBusy} flow={chatFlow()} />
          </div>
        {/if}
        {#if item.ticked}
          <div class="ticked">
            {#if item.ticked.undone}
              <span class="muted">Unticked.</span>
            {:else}
              <button class="secondary-button" type="button" disabled={flowBusy || chatSession.waiting} onclick={() => undoTick(item)} aria-label={`Undo: untick ${item.ticked.title}`}>Undo</button>
            {/if}
          </div>
        {/if}
        {#if item.tool === 'gp-finder' || item.tool === 'dentist-finder'}
          <div class="cards">
            <GpFinderCard kind={item.tool === 'gp-finder' ? 'gp' : 'dentist'} />
          </div>
        {:else if item.tool === 'contacts'}
          <div class="cards">
            <KeyContactsCard />
          </div>
        {/if}
        {#if item.ask4help}
          <div class="cards">
            <div class="ask4help-card">
              <Ask4HelpLink />
            </div>
          </div>
        {/if}
        {#if item.quick?.open}
          <div class="quick" role="group" aria-label="Quick replies">
            {#each item.quick.options as option (option.value)}
              <!-- Only while going through the checklist (not before it has loaded), and not while it saves or asks Gemini. -->
              <button class="secondary-button" type="button" disabled={!talking || flowBusy || chatSession.waiting} onclick={() => sendMessage(option.value)}>{option.label}</button>
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
        placeholder={flowTakesAll || talking ? 'Type your answer, or stop to stop' : chatSession.unavailable ? 'The chat isn’t available right now' : 'Type your message...'}
        autocomplete="off"
        disabled={flowTakesAll ? flowBusy : flowBusy || chatSession.waiting || chatSession.unavailable}
        bind:value={chatSession.draft}
      />

      <button class="primary-button" type="submit" disabled={flowTakesAll ? flowBusy : flowBusy || chatSession.waiting || chatSession.unavailable}>
        {flowTakesAll ? 'Send answer' : chatSession.waiting ? 'Waiting for a reply…' : chatSession.unavailable ? 'Chat unavailable' : 'Send'}
      </button>
      {#if flowActive && !flowBusy}
        <!-- Ends finding a mentor before Find my mentor (nothing saved), or going through the checklist. -->
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

  /* Quick replies and Undo: buttons under the chat's question, or its "Ticked" line. */
  .quick,
  .ticked {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .ask4help-card {
    padding: 4px 12px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
  }

</style>
