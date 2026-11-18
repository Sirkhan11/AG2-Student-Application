
<script>
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { currentUid, signedInUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { loadChecklist, loadMyRecord, saveChange } from '#lib/checklist/store.js';
  import { applyChange } from '#lib/checklist/tasks.js';
  import Ask4HelpLink from '#lib/components/Ask4HelpLink.svelte';
  import GpFinderCard from '#lib/components/GpFinderCard.svelte';
  import KeyContactsCard from '#lib/components/KeyContactsCard.svelte';
  import CalendarCard from '#lib/components/CalendarCard.svelte';
  import Burst from '#lib/components/Burst.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { arrive, buzz, playedOnce } from '#lib/motion.js';
  import { onMount } from 'svelte';
  import { createChatDo } from '#lib/checkin/chat-do.js';
  import { afterMentorNote, openNote } from '#lib/checkin/chat-prompt.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { matchLine } from '#lib/checkin/opener.js';
  import { startCheckinChat } from '#lib/checkin/chat.js';
  import {
    chatChanges,
    chatFlow,
    chatFlowFor,
    runChatFlow,
    chatSession,
    clearChat,
    clearChatOnSignOut,
    geminiChat,
    notesChanged,
    chatFacts,
    setChatChanges,
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
  import { forgetAllNotes, forgetNote, loadMyNotes, rememberNote } from '#lib/checkin/chat-notes.js';
  import { db } from '#lib/firebase/client.js';
  import { isoDate } from '#lib/checkin/about-you.js';
  import { clubBySlug } from '#lib/sport/clubs.js';
  import { serviceById } from '#lib/nsu/services.js';
  import { societyById } from '#lib/societies/societies.js';

  // The conversation (messages, cards, what they've typed, and Gemini's side) lives in
  // chat-session.svelte.js rather than here, so it's still there after visiting another page.

  // null while Firebase checks for a saved login.
  let signedIn = $state(/** @type {boolean | null} */ (null));
  // What's already in the chat when the page opens stays still; what arrives after springs in.
  let appeared = false;
  onMount(() => {
    requestAnimationFrame(() => (appeared = true));
  });
  const ready = () => appeared;

  /**
   * Whether this line confirms a task ticked off, so it can celebrate. Undo's own change for a tick
   * is the untick.
   * @param {import('#lib/checkin/chat-session.svelte.js').Message} item
   */
  const tickedOff = (item) => {
    const change = item.undo?.change;
    return Boolean(change && 'checklist' in change && change.checklist.type === 'tick' && change.checklist.done === false);
  };

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
   * Shows the conversation kept from earlier, if it's theirs. Otherwise starts a new conversation,
   * telling Gemini about them: the about-you record (their first name, course, interests, arrival
   * date, the summary from finding a mentor and what they asked it to remember), their match and
   * their checklist (see describeForGemini in opener.js), and Gemini writes the first message.
   * Straight from finding a mentor on the Find a mentor page, the app says first how it went (with
   * the mentor's name, which Gemini is never told), then Gemini writes the next message itself.
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

    // Gemini is told what the app knows, but never the mentor's name.
    const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
    const facts = { match: withoutName, tasks, checklistSaved, profile, isMentor, today };
    setChatFacts(facts);
    setGeminiChat(startCheckinChat(facts, changes()));
    chatSession.started = true;

    const outcome = match?.status;
    if (justSignedUp && (outcome === 'matched' || outcome === 'coordinator')) {
      // How finding a mentor went, in the app's words, with the mentor's name.
      chatSession.messages.push({
        role: 'assistant',
        text: /** @type {string} */ (matchLine(match)),
        // Matched: the first message celebrates.
        celebrate: outcome === 'matched' ? true : undefined
      });
      // Straight from finding a mentor on the Find a mentor page: Gemini writes the next message itself.
      if (justSignedUp && record?.matchingSummary && (outcome === 'matched' || outcome === 'coordinator')) await followUpAfterMentor(outcome);
      return;
    }
    await askGemini(null);
  }

  // ---------- The chat's own action: finding a mentor (mentor-flow.js) ----------

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
          chatSession.messages.push({ role: message.role, text: message.text, flow: message.card, celebrate: message.celebrate });
          if (message.celebrate) buzz([14, 70, 24]);
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
            // then writes the next message itself (followUpAfterMentor). Never the mentor's name.
            const found = result.match ?? (await loadMyMatch().catch(() => undefined));
            const match = found?.status === 'matched' ? { ...found, mentorName: null } : found;
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
   * The changes the chat makes for Gemini's tools (chat-do.js): their checklist, through the
   * checklist's own change (as the checklist page does), and what it remembers (as the Remember card
   * and the About you page do). Made the first time they're needed in this conversation.
   */
  function changes() {
    let made = chatChanges();
    if (!made) {
      made = createChatDo({
        loadTasks: loadChecklist,
        saveChange: async (change, list) => {
          const onScreen = applyChange(list, change);
          const result = await saveChange(change, onScreen);
          return result.status === 'saved' ? result.list : onScreen;
        },
        loadNotes: () => loadMyNotes(db, signedInUid()),
        remember: (text) => rememberNote(db, signedInUid(), text),
        forget: (note) => forgetNote(db, signedInUid(), note),
        forgetAll: () => forgetAllNotes(db, signedInUid())
      });
      setChatChanges(made);
    }
    return made;
  }

  /** Undo on a line confirming a change the chat made: put back, and Gemini told with the next message. @param {import('#lib/checkin/chat-session.svelte.js').Message} message */
  async function undoChange(message) {
    if (!message.undo || message.undo.done) return;
    message.undo.done = true;
    closeQuickReplies();
    const conversation = chatSession.conversation;
    const result = await changes().undo(message.undo.change);
    if (chatSession.conversation !== conversation) return;
    if (!result) {
      message.undo.done = false;
      chatSession.messages.push({ role: 'assistant', text: 'Sorry, I couldn’t put that back just now. Please try again in a minute.', kind: 'error' });
    } else {
      chatSession.messages.push({ role: 'assistant', text: result.text });
      if (result.tasks) tellGemini({ tasks: result.tasks, checklistSaved: true });
      if (result.notes) notesChanged(result.notes);
      geminiChat()?.tell(result.forGemini);
    }
    await showLatest();
  }

  /** Quick replies only work under the newest question: older ones close. */
  function closeQuickReplies() {
    for (const message of chatSession.messages) if (message.quick?.open) message.quick.open = false;
  }

  /**
   * Starts one of the chat's own actions: from an offer card's Start, or straight after a reply
   * (Gemini's mentor tool with "find").
   * @param {string} action
   */
  function startAction(action) {
    if (chatSession.flow?.active) return;
    closeQuickReplies();
    if (action === 'mentor') mentorFlow().start();
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

  /** @param {string} [typed] what to send: what's in the message box, a quick reply, or a card's question */
  async function sendMessage(typed) {
    const text = (typed ?? chatSession.draft).trim();
    if (!text) return;
    // While finding a mentor, what they type is its answer: it goes to the action, never to Gemini.
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
   * Sends what they said (already shown) to Gemini, or with null asks Gemini for the first message,
   * and shows the reply, with Typing… meanwhile.
   * @param {string | null} text
   */
  async function askGemini(text) {
    const chat = geminiChat();
    if (!chat || chatSession.unavailable) return;
    const conversation = chatSession.conversation;
    chatSession.waiting = true;
    await showLatest();

    // Carries on if they move to another page meanwhile: the reply is there when they come back.
    const reply = text === null ? await chat.prompt(openNote()) : await chat.send(text);
    // Logged out while waiting: the reply belongs to a conversation that's gone.
    if (chatSession.conversation !== conversation) return;
    // The first message: if Gemini can't write it, a plain hello rather than an error.
    if (text === null && reply.kind === 'error') showReply({ kind: 'reply', text: 'Hi, how’s it going? Ask me anything, or tell me how you’re settling in.' });
    else showReply(reply);
    // Gemini's credit has run out: the message box is switched off, as trying again won't help.
    if (reply.kind === 'unavailable') chatSession.unavailable = true;
    chatSession.waiting = false;
    await showLatest();
    // Gemini asked to start finding a mentor: the six questions start here, after its reply.
    if (reply.start === 'mentor') startAction('mentor');
  }

  /**
   * Shows one of Gemini's replies (or the fixed support, error or unavailable message): first the
   * lines confirming the changes the app made, each with Undo, then the reply with its cards.
   * @param {import('#lib/checkin/chat-turns.js').ChatReply} reply
   */
  function showReply(reply) {
    for (const change of reply.changes ?? []) {
      chatSession.messages.push({ role: 'assistant', text: change.text, undo: { change: change.undo, done: false } });
      if ('checklist' in change.undo && change.undo.checklist.type === 'tick' && change.undo.checklist.done === false) buzz();
    }
    // One of the chat's own actions it chose: an offer with Start and Not now, or (shows: 'card') a
    // card shown straight away, such as their mentor.
    const action = reply.offers?.[0] ? chatAction(reply.offers[0]) : null;
    // Gemini's first reply in this conversation gets a little sparkle.
    const first = reply.kind === 'reply' && reply.text.trim() !== '' && !chatSession.replied;
    if (first) chatSession.replied = true;
    if (reply.quick?.length) closeQuickReplies();
    chatSession.messages.push({
      role: 'assistant',
      text: reply.text,
      first: first || undefined,
      kind: reply.kind === 'reply' ? undefined : reply.kind,
      links:
        reply.kind === 'safety' || reply.kind === 'unavailable'
          ? [{ label: 'Need help now', href: '/need-help' }]
          : // The societies, clubs and services it named, as cards, and any buttons.
            reply.links,
      // A reminder it suggested (they didn't ask for it): a card with Add and No thanks.
      task: reply.tasks?.[0] ? { title: reply.tasks[0], state: 'offered' } : undefined,
      // One of the chat's own actions it offered (finding a mentor): a card with Start and Not now.
      offer: action && action.shows !== 'card' ? { action: action.id, state: 'offered' } : undefined,
      // Their mentor, or the form for a different one: read and sent here, never through Gemini.
      appCard: action?.shows === 'card' ? /** @type {'your-mentor' | 'change-mentor'} */ (action.id) : undefined,
      // Something it offered to remember (they didn't ask): a card with Remember and Not now.
      note: reply.notes?.[0] ? { text: reply.notes[0], state: 'offered' } : undefined,
      // What the app shows with the reply: the GP finder, a dentist search, the key contacts, Ask4Help, or a calendar card.
      tool: reply.tool,
      ask4help: reply.ask4help,
      calendar: reply.calendar,
      // Quick replies under it, open until one is used.
      quick: reply.quick?.length ? { options: reply.quick, open: true } : undefined
    });
  }

  /**
   * Straight after they find a mentor (here in the chat, or on the Find a mentor page), Gemini writes
   * the next message itself, from the summary of their answers (afterMentorNote in chat-prompt.js).
   * Not after the support message has been shown in this conversation, if they've seemed worried or
   * upset, or when the chat isn't available. If it fails, nothing is shown: it's extra.
   * @param {'matched' | 'coordinator'} outcome
   */
  async function followUpAfterMentor(outcome) {
    const chat = geminiChat();
    if (!chat || chatSession.unavailable || chatSession.messages.some((message) => message.kind === 'safety') || chat.seemedWorried()) return;
    const conversation = chatSession.conversation;
    chatSession.waiting = true;
    await showLatest();
    const reply = await chat.prompt(afterMentorNote(outcome));
    if (chatSession.conversation !== conversation) return;
    if (reply.kind === 'reply' || reply.kind === 'safety') showReply(reply);
    chatSession.waiting = false;
    await showLatest();
    if (reply.start === 'mentor') startAction('mentor');
  }

  /**
   * Scrolls so the newest message and the message box are in view (handy on a phone). After one of
   * the app's questions, the focus goes to the message box, so they can type the answer straight away
   * (the question itself is read out, as the messages are a live region).
   * @param {boolean} [question]
   */
  async function showLatest(question = false) {
    await tick();
    // To the end of the conversation: the box stays at the bottom, above the bar, so the newest
    // message shows just above it. A jump rather than a glide with Reduce Motion on.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: still ? 'auto' : 'smooth' });
    if (question) /** @type {HTMLInputElement | null} */ (document.getElementById('chat-message'))?.focus();
  }
</script>

<main class="page chat-page">
  <header class="chat-head">
    <span class="avatar"><Icon name="sparkle" size={22} /></span>
    <div>
      <h1>Check-in Chat</h1>
      <p class="muted">
        A place to check in and find student support.
        This is not a medical or emergency service.
        <a class="need-help" href="/need-help">Need help now?</a>
      </p>
    </div>
  </header>

  {#if !signedIn || !chatSession.started}
    <p class="muted" role="status">Loading…</p>
  {:else}
    <!-- What Gemini is told and what's kept: one tap away, the same words. -->
    <details class="about-chat">
      <summary><Icon name="lock" size={17} /> How your chat is used</summary>
      <p class="muted">
        Replies are written by Google’s Gemini AI. To help, Gemini is told your first name; the course,
        interests and arrival date you gave when you signed up; whether you have a mentor, why you were
        matched and how often you asked to meet; a short summary of your answers from finding a mentor;
        your checklist progress; and anything you’ve asked it to remember. It’s never told your full name
        or email, or your mentor’s name. <a href="/about-you">See what the chat knows about you</a>.
      </p>
      <p class="muted">
        This chat isn’t saved: it stays while the app is open in this tab, until you log out, and nothing
        you say is passed on to the university or your mentor. When you ask it to change your checklist,
        or to remember or forget something, the app does it and shows a line with Undo. If it suggests a reminder and you tap Add,
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
    </details>

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
          class:done={tickedOff(item)}
          class:matched={Boolean(item.celebrate)}
          use:arrive={{ ready }}
        >
          {#if item.first}
            <!-- Gemini's first reply: a sparkle pops at its corner (only as it arrives). -->
            <span class="sparkle"><Icon name="sparkle" size={20} /></span>
          {/if}
          {#if item.celebrate}
            <!-- Just matched: confetti, once (after the chat has opened, if it's the first message). -->
            <span class="match-burst" use:playedOnce={() => (item.celebrate = false)}><Burst count={26} spread={130} delay={ready() ? 0 : 560} /></span>
          {/if}
          {#if tickedOff(item)}
            <!-- Something ticked off: a little celebration. -->
            <span class="tick-mark"><Icon name="check" size={16} stroke={3} /><Burst /></span>
          {/if}
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
          <div class="cards" aria-live="off" use:arrive={{ ready }}>
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
          <div class="cards" use:arrive={{ ready }}>
            <TaskSuggestionCard bind:task={item.task} />
          </div>
        {/if}
        {#if item.note}
          <div class="cards" use:arrive={{ ready }}>
            <RememberCard bind:note={item.note} onsaved={noteSaved} />
          </div>
        {/if}
        {#if item.offer}
          <div class="cards" use:arrive={{ ready }}>
            <ChatOfferCard
              bind:offer={item.offer}
              disabled={flowTakesAll || flowBusy}
              onstart={() => startAction(/** @type {NonNullable<typeof item.offer>} */ (item.offer).action)}
              ondecline={() => declineAction(/** @type {NonNullable<typeof item.offer>} */ (item.offer).action)}
            />
          </div>
        {/if}
        {#if item.appCard}
          <div class="cards" use:arrive={{ ready }}>
            <YourMentorCard change={item.appCard === 'change-mentor'} />
          </div>
        {/if}
        {#if item.flow}
          <div class="cards" use:arrive={{ ready }}>
            <ChatFlowCard card={item.flow} live={flowActive && chatSession.flow?.kind === 'mentor' && chatSession.flow.live === item.flow.id && !flowBusy} flow={chatFlow()} />
          </div>
        {/if}
        {#if item.tool === 'gp-finder' || item.tool === 'dentist-finder'}
          <div class="cards" use:arrive={{ ready }}>
            <GpFinderCard kind={item.tool === 'gp-finder' ? 'gp' : 'dentist'} />
          </div>
        {:else if item.tool === 'contacts'}
          <div class="cards" use:arrive={{ ready }}>
            <KeyContactsCard />
          </div>
        {/if}
        {#if item.ask4help}
          <div class="cards" use:arrive={{ ready }}>
            <div class="ask4help-card">
              <Ask4HelpLink />
            </div>
          </div>
        {/if}
        {#if item.undo}
          <div class="ticked" use:arrive={{ ready }}>
            {#if item.undo.done}
              <span class="muted">Undone.</span>
            {:else}
              <button class="secondary-button undo" type="button" disabled={flowBusy || chatSession.waiting} onclick={() => undoChange(item)}><Icon name="undo" size={16} /> Undo</button>
            {/if}
          </div>
        {/if}
        {#if item.calendar}
          <div class="cards" use:arrive={{ ready }}>
            <CalendarCard title={item.calendar.title} />
          </div>
        {/if}
        {#if item.quick?.open}
          <div class="quick" role="group" aria-label="Quick replies">
            {#each item.quick.options as option (option.value)}
              <!-- Not while something saves or Gemini is asked. -->
              <button class="secondary-button chip" type="button" use:arrive={{ ready }} disabled={flowBusy || chatSession.waiting} onclick={() => sendMessage(option.value)}>{option.label}</button>
            {/each}
          </div>
        {/if}
      {/each}
      {#if chatSession.waiting}
        <div class="bubble typing" use:arrive={{ ready }}>
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="visually-hidden">Typing…</span>
        </div>
      {/if}
    </div>

    <form class="composer" onsubmit={(event) => {
      event.preventDefault();
      sendMessage();
    }}>
      <label class="visually-hidden" for="chat-message">Your message</label>

      <input
        id="chat-message"
        class="field"
        placeholder={flowTakesAll ? 'Your answer, or “stop”' : chatSession.unavailable ? 'The chat isn’t available right now' : 'Type your message...'}
        autocomplete="off"
        disabled={flowTakesAll ? flowBusy : flowBusy || chatSession.waiting || chatSession.unavailable}
        bind:value={chatSession.draft}
      />

      <button class="send" type="submit" disabled={flowTakesAll ? flowBusy : flowBusy || chatSession.waiting || chatSession.unavailable}>
        <Icon name="send" size={20} />
        <span class="visually-hidden">{flowTakesAll ? 'Send answer' : chatSession.waiting ? 'Waiting for a reply…' : chatSession.unavailable ? 'Chat unavailable' : 'Send'}</span>
      </button>
      {#if flowActive && !flowBusy}
        <!-- Ends finding a mentor before Find my mentor (nothing saved), or going through the checklist. -->
        <button class="secondary-button stop" type="button" onclick={() => chatFlow()?.stop()}>Stop</button>
      {/if}
    </form>
  {/if}

  <BottomNav />
</main>

<style>
  /* The conversation fills the screen, and its box sits at the bottom, just above the bar. */
  .chat-page {
    display: flex;
    flex-direction: column;
    padding-bottom: calc(var(--nav-height) + 10px + env(safe-area-inset-bottom));
  }

  .chat-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
  }

  .chat-head h1 {
    font-size: 22px;
    margin: 0;
  }

  .chat-head p {
    margin: 2px 0 0;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: white;
    background: var(--violet);
    flex: none;
  }

  .about-chat {
    margin: 10px 0 4px;
    padding: 10px 14px;
    border-radius: var(--radius-m);
    background: white;
    border: 1px solid var(--line);
  }

  .about-chat summary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--ink-2);
    cursor: pointer;
    list-style: none;
  }

  .about-chat summary::-webkit-details-marker {
    display: none;
  }

  .about-chat summary::after {
    content: '▾';
    margin-left: auto;
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .about-chat[open] summary::after {
    transform: rotate(180deg);
  }

  .messages {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 18px 0;
  }

  .bubble {
    position: relative;
    align-self: flex-start;
    max-width: 86%;
    padding: 10px 14px;
    border-radius: 18px 18px 18px 6px;
    background: white;
    border: 1px solid var(--line);
    color: var(--ink);
    transform-origin: 0% 100%;
  }

  .bubble.user {
    align-self: flex-end;
    border-color: var(--violet);
    border-radius: 18px 18px 6px 18px;
    color: white;
    background: var(--violet);
    transform-origin: 100% 100%;
  }

  .bubble.safety {
    background: var(--danger-soft);
    border-color: var(--danger-line);
  }

  .bubble.failed {
    color: var(--ink-3);
    background: #f6f3fa;
  }

  .bubble.done {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--mint-soft);
    border-color: #bfe9cf;
    color: var(--mint-ink);
    font-weight: 600;
  }

  /* Confetti only for a tick that's just happened, not one they scroll back to. */
  .bubble:not(:global(.arrive)) .tick-mark :global(.burst) {
    display: none;
  }

  .tick-mark {
    position: relative;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--mint);
    color: white;
    flex: none;
  }

  .bubble.matched {
    background: var(--violet-soft);
    border-color: #d9dcfb;
  }

  /* A sparkle on Gemini's first reply, only as it arrives: it pops, twirls and fades. */
  .sparkle {
    position: absolute;
    right: -8px;
    top: -10px;
    color: var(--sun);
    filter: drop-shadow(0 1px 1px rgb(176 120 0 / 0.35));
    opacity: 0;
    pointer-events: none;
  }

  .match-burst {
    position: absolute;
    left: 28px;
    top: 18px;
  }

  /* Typing: three dots bouncing in turn (still, with Reduce Motion on). */
  .bubble.typing {
    padding: 14px 16px;
  }

  .dots {
    display: inline-flex;
    gap: 5px;
  }

  .dots i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--violet);
    opacity: 0.55;
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

  .chip {
    border-color: #d9dcfb;
    border-radius: var(--radius-pill);
    color: var(--violet-ink);
    background: white;
  }

  .undo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 14px;
  }

  .ask4help-card {
    padding: 4px 12px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    background: #fff;
  }

  /* The message box stays at the bottom, above the bar, while the conversation scrolls. */
  .composer {
    position: sticky;
    bottom: calc(var(--nav-height) + 10px + env(safe-area-inset-bottom));
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border-radius: var(--radius-pill);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-2);
  }

  .composer :global(.field) {
    flex: 1;
    min-width: 0;
    margin: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    padding: 10px 8px;
  }

  .composer :global(.field:focus) {
    box-shadow: none;
  }

  .send {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    color: white;
    background: var(--violet);
    flex: none;
    transition: transform var(--dur-2) var(--ease-bounce);
  }

  .send:active:not(:disabled) {
    transform: scale(0.9);
    transition-duration: var(--dur-tap);
  }

  .send:disabled {
    opacity: 0.4;
  }

  .stop {
    padding: 8px 12px;
    font-size: 14px;
    flex: none;
  }

  .need-help {
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: no-preference) {
    /* New messages and cards spring in, one after another; the typing dots bounce. */
    :global(.chat-page .arrive) {
      animation: chat-arrive var(--dur-3) var(--ease-spring) var(--arrive-delay, 0ms) both;
    }

    :global(.chat-page .chip.arrive) {
      animation-name: chip-pop;
      animation-timing-function: var(--ease-bounce);
    }

    .dots i {
      animation: dot 1.1s ease-in-out infinite;
    }

    .dots i:nth-child(2) {
      animation-delay: 0.15s;
    }

    .dots i:nth-child(3) {
      animation-delay: 0.3s;
    }

    .bubble:global(.arrive) .sparkle {
      animation: sparkle 1.4s var(--ease-out) var(--arrive-delay, 0ms) both;
    }

    .bubble.done:global(.arrive) .tick-mark {
      animation: tick-pop var(--dur-3) var(--ease-bounce) both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.chat-page .arrive) {
      animation: chat-fade var(--dur-1) ease var(--arrive-delay, 0ms) both;
    }
  }

  @keyframes chat-arrive {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.9);
    }
  }

  @keyframes chip-pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }

  @keyframes chat-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes dot {
    0%,
    80%,
    100% {
      transform: translateY(0);
      opacity: 0.55;
    }
    40% {
      transform: translateY(-6px);
      opacity: 1;
    }
  }

  @keyframes sparkle {
    0% {
      opacity: 0;
      transform: scale(0.2) rotate(-60deg);
    }
    25% {
      opacity: 1;
      transform: scale(1.25) rotate(10deg);
    }
    60% {
      opacity: 1;
      transform: scale(1) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: scale(0.9) rotate(20deg);
    }
  }

  @keyframes tick-pop {
    from {
      transform: scale(0.2) rotate(-30deg);
    }
  }
</style>
