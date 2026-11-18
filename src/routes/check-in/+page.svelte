
<script>
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { currentUid, signedInUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { loadChecklist, loadMyRecord, saveChange } from '#lib/checklist/store.js';
  import { applyChange, makeTick } from '#lib/checklist/tasks.js';
  import { createChecklistTalk, QUICK } from '#lib/checkin/checklist-talk.js';
  import { firstDoneNote } from '#lib/checkin/chat-turns.js';
  import Ask4HelpLink from '#lib/components/Ask4HelpLink.svelte';
  import GpFinderCard from '#lib/components/GpFinderCard.svelte';
  import KeyContactsCard from '#lib/components/KeyContactsCard.svelte';
  import CalendarCard from '#lib/components/CalendarCard.svelte';
  import Burst from '#lib/components/Burst.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { arrive, buzz, playedOnce } from '#lib/motion.js';
  import { onMount } from 'svelte';
  import { createChecklistEdits } from '#lib/checkin/checklist-edits.js';
  import { afterReply, createNoteActions } from '#lib/checkin/run-actions.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { buildOpener } from '#lib/checkin/opener.js';
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
   * Whether this message ticked a task off (going through the checklist, or asked for from any
   * message), so it can celebrate. Undo's own change for a tick is the untick.
   * @param {import('#lib/checkin/chat-session.svelte.js').Message} item
   */
  const tickedOff = (item) => Boolean(item.ticked) || (item.undo?.checklist?.type === 'tick' && item.undo.checklist.done === false);

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
      // Straight from being matched on the Find a mentor page: the first message celebrates.
      celebrate: i === 0 && justSignedUp && match?.status === 'matched' ? true : undefined,
      // Closed until the checklist talk has loaded, so a tap can't arrive before it's listening.
      quick: opener.asks && i === opener.messages.length - 1 ? { options: QUICK.yesNo, open: false } : undefined
    }));

    // Gemini is told the same facts and first messages, but without the mentor's name. The facts are
    // kept, so Gemini can be told again when they change here (a mentor found in the chat, say).
    const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
    const facts = { match, tasks, checklistSaved, profile, isMentor, today };
    setChatFacts(facts);
    setGeminiChat(startCheckinChat(facts, buildOpener({ match: withoutName, tasks, checklistSaved, justSignedUp, isMentor, forGemini: true }).messages));
    chatSession.started = true;
    // The first message asked about the first task still to do: the checklist talk waits for the answer.
    if (opener.asks) {
      await checklistTalk().start({ asked: true });
      const question = chatSession.messages[opener.messages.length - 1];
      if (chatSession.conversation === conversation && question?.quick && chatSession.flow?.kind === 'checklist' && chatSession.flow.step === 'asking') question.quick.open = true;
    }

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
          if (message.ticked) buzz();
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

  /**
   * The changes the chat makes when asked, from any message: checklist edits (checklist-edits.js:
   * tick, untick, add, remove, rename, through the checklist's own change, as the checklist page
   * does) and remembering or forgetting (run-actions.js, through the same notes as the Remember card
   * and the About you page), each confirmed in one line with Undo, and Gemini told what changed.
   * Made the first time they're needed in this conversation.
   */
  function changes() {
    let made = chatChanges();
    if (!made) {
      const conversation = chatSession.conversation;
      /** @param {import('#lib/checkin/run-actions.js').ActionMessage} message */
      const post = (message) => {
        if (chatSession.conversation !== conversation) return;
        if (message.quick) closeQuickReplies();
        if (message.undo?.type === 'tick' && message.undo.done === false) buzz();
        chatSession.messages.push({
          role: 'assistant',
          text: message.text,
          quick: message.quick ? { options: message.quick, open: true } : undefined,
          undo: message.undo || message.noteUndo ? { checklist: message.undo, notes: message.noteUndo, done: false } : undefined
        });
        showLatest();
      };
      /** @param {string | null} student @param {string} text */
      const record = (student, text) => {
        if (chatSession.conversation === conversation) geminiChat()?.note(student, text);
      };
      const edits = createChecklistEdits({
        load: loadChecklist,
        save: async (change, list) => {
          const onScreen = applyChange(list, change);
          const result = await saveChange(change, onScreen);
          const now = result.status === 'saved' ? result.list : onScreen;
          if (chatSession.conversation === conversation) tellGemini({ tasks: now, checklistSaved: true });
          return now;
        },
        post,
        record
      });
      const notes = createNoteActions({
        load: () => loadMyNotes(db, signedInUid()),
        remember: (text) => rememberNote(db, signedInUid(), text),
        forget: (note) => forgetNote(db, signedInUid(), note),
        forgetAll: () => forgetAllNotes(db, signedInUid()),
        changed: noteSaved,
        post,
        record
      });
      made = { edits, notes };
      setChatChanges(made);
    }
    return made;
  }

  /** Undo on a line confirming a change the chat made. @param {import('#lib/checkin/chat-session.svelte.js').Message} message */
  function undoChange(message) {
    if (!message.undo || message.undo.done) return;
    message.undo.done = true;
    closeQuickReplies();
    if (message.undo.checklist) void changes().edits.undo(message.undo.checklist);
    else if (message.undo.notes) void changes().notes.undo(message.undo.notes);
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
    // The answer to the chat's own question about a change ("Which one?", "Have you done it?", or
    // "done" after "tell me when you've done it"): read here, without Gemini.
    const edits = chatChanges()?.edits;
    if (edits?.takes(text)) {
      chatSession.messages.push({ role: 'user', text });
      if (typed === undefined) chatSession.draft = '';
      closeQuickReplies();
      await showLatest();
      await edits.reply(text);
      await showLatest();
      return;
    }
    edits?.clear();
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
    // What they asked for, done straight away (a checklist edit, remembering or forgetting), and
    // waiting for "done" after how to do a task outside the app.
    if (reply.kind === 'reply') await afterReply(reply, { ...changes(), tasks: loadChecklist });
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
    // Gemini's first reply in this conversation gets a little sparkle.
    const first = reply.kind === 'reply' && reply.text.trim() !== '' && !chatSession.replied;
    if (first) chatSession.replied = true;
    chatSession.messages.push({
      role: 'assistant',
      text: reply.text,
      first: first || undefined,
      kind: reply.kind === 'reply' || reply.kind === 'skip' ? undefined : reply.kind,
      links:
        reply.kind === 'safety' || reply.kind === 'unavailable'
          ? [{ label: 'Need help now', href: '/need-help' }]
          : // Suggested societies and NSU services, shown as cards under the reply.
            reply.links,
      // A reminder it suggested (they didn't ask for it): a card with Add and No thanks.
      task: reply.tasks?.[0] ? { title: reply.tasks[0], state: 'offered' } : undefined,
      // One of the chat's own actions it offered (finding a mentor): a card with Start and Not now.
      offer: action && action.shows !== 'card' ? { action: action.id, state: 'offered' } : undefined,
      // Their mentor, or the form for a different one: read and sent here, never through Gemini.
      appCard: action?.shows === 'card' ? /** @type {'your-mentor' | 'change-mentor'} */ (action.id) : undefined,
      // Something it offered to remember (they didn't ask): a card with Remember and Not now.
      note: reply.notes?.[0] ? { text: reply.notes[0], state: 'offered' } : undefined,
      // What the app shows for what they asked, from any message: the GP finder, a dentist search,
      // the key contacts, Ask4Help, or a calendar card.
      tool: reply.tool,
      ask4help: reply.ask4help,
      calendar: reply.calendar
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

  {#if !signedIn || chatSession.messages.length === 0}
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
        {#if item.ticked}
          <div class="ticked" use:arrive={{ ready }}>
            {#if item.ticked.undone}
              <span class="muted">Unticked.</span>
            {:else}
              <button class="secondary-button undo" type="button" disabled={flowBusy || chatSession.waiting} onclick={() => undoTick(item)} aria-label={`Undo: untick ${item.ticked.title}`}><Icon name="undo" size={16} /> Undo</button>
            {/if}
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
        placeholder={flowTakesAll || talking ? 'Your answer, or “stop”' : chatSession.unavailable ? 'The chat isn’t available right now' : 'Type your message...'}
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
