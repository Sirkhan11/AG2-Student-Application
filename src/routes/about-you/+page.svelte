<script>
  import BackLink from '#lib/components/BackLink.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { signedInUid, watchSignedIn } from '#lib/firebase/auth.js';
  import { db } from '#lib/firebase/client.js';
  import { loadMyRecord } from '#lib/checklist/store.js';
  import { loadMyMatch } from '#lib/matching/matches.js';
  import { hasMentorProfile } from '#lib/matching/mentor-account.js';
  import { forgetAllNotes, forgetNote, loadMyNotes } from '#lib/checkin/chat-notes.js';
  import { aboutYou, dateInWords, MAX_NOTES, stylesInWords, TELL_CHAT_STUDENT_TYPE } from '#lib/checkin/about-you.js';
  import { studentTypeInWords } from '#lib/students/student-type.js';
  import { notesChanged } from '#lib/checkin/chat-session.svelte.js';

  // "What the chat knows about you": everything the check-in chat is told about the student (the
  // about-you record, about-you.js, plus their mentor and checklist, as describeForGemini puts them),
  // in their words, and the things they asked it to remember, which they can delete one at a time or
  // all at once. Linked from More and from the note at the top of the chat.

  /** @typedef {import('#lib/checkin/remember-notes.js').SavedNote} SavedNote */

  let view = $state(/** @type {'loading' | 'ready' | 'error'} */ ('loading'));
  let about = $state(/** @type {import('#lib/checkin/about-you.js').AboutYou | null} */ (null));
  let mentor = $state('');
  /** Whether they have a match record, so the page can say why there's no summary. */
  let matched = $state(false);
  let checklist = $state('');
  let notes = $state(/** @type {SavedNote[]} */ ([]));
  let confirmingAll = $state(false);
  let busy = $state(false);
  let problem = $state('');
  let done = $state('');

  $effect(() =>
    watchSignedIn((signedIn) => {
      if (signedIn) load();
      // Logged out: the root layout sends them to log in (see account-gate.js).
    })
  );

  async function load() {
    view = 'loading';
    try {
      const [record, match, isMentor, saved] = await Promise.all([loadMyRecord(), loadMyMatch(), hasMentorProfile().catch(() => false), loadMyNotes(db, signedInUid())]);
      about = aboutYou(record);
      notes = saved;
      mentor = mentorInWords(match, isMentor);
      matched = match !== null;
      const tasks = record.checklist.tasks;
      checklist = `${tasks.filter((task) => task.done).length} of ${tasks.length} done.`;
      view = 'ready';
    } catch (err) {
      console.error('Loading what the chat knows failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      view = 'error';
    }
  }

  /**
   * @param {import('#lib/matching/matches.js').Match | null} match
   * @param {boolean} isMentor
   */
  function mentorInWords(match, isMentor) {
    if (isMentor) return 'You’re a mentor yourself, so it doesn’t offer to find you one. It’s never told your email address, even if you share it with the students matched with you: you choose that, and can stop, on Your mentor.';
    const often = match?.meetingFrequency ? ` You asked to meet ${match.meetingFrequency}.` : '';
    if (match?.status === 'matched') return `You have one. It’s told why you were matched (as on the Your Mentor page), but not your mentor’s name or how to reach them.${often} Your mentor isn’t shown anything about you; if they chose to share their email address with you, it’s on Home and Your mentor.`;
    if (match?.status === 'coordinator') return `The mentoring coordinator is finding you one.${often}`;
    return 'You haven’t got one yet.';
  }

  /** @param {SavedNote} note */
  async function remove(note) {
    busy = true;
    problem = '';
    done = '';
    try {
      await forgetNote(db, signedInUid(), note);
      notes = await loadMyNotes(db, signedInUid());
      notesChanged(notes.map((saved) => saved.text));
      done = 'Deleted.';
    } catch (err) {
      console.error('Deleting a note failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      problem = 'We couldn’t delete it just now. Please try again.';
    } finally {
      busy = false;
    }
  }

  async function removeAll() {
    busy = true;
    problem = '';
    done = '';
    try {
      await forgetAllNotes(db, signedInUid());
      notes = [];
      notesChanged([]);
      confirmingAll = false;
      done = 'Everything it remembered has been deleted.';
    } catch (err) {
      console.error('Deleting the notes failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      problem = 'We couldn’t delete them just now. Please try again.';
    } finally {
      busy = false;
    }
  }
</script>

<main class="page">
  <BackLink />

  <h1>What the chat knows about you</h1>
  <p class="muted">
    Each time the check-in chat starts, Google’s Gemini AI is told these things, so it can help without
    asking again. It’s never told your full name, your email, your mentor’s name or email address, or when
    you’re free to meet, and what you say in the chat isn’t saved.
  </p>

  {#if view === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if view === 'error'}
    <p class="error" role="alert">We couldn’t load this. Please check your connection.</p>
    <button class="primary-button" type="button" onclick={load}>Try again</button>
  {:else if about}
    <section class="card" aria-labelledby="account-title">
      <h2 id="account-title">From your account</h2>
      <dl>
        <dt>First name</dt>
        <dd>{about.firstName ?? 'Not given'}</dd>
        <dt>Course</dt>
        <dd>{about.course ?? 'Not given'}</dd>
        <dt>Home or international</dt>
        <dd>
          {#if !TELL_CHAT_STUDENT_TYPE}
            The chat isn’t told this.
          {:else if about.studentType}
            You said you’re {studentTypeInWords(about.studentType)}, so it gives you that version of things like registering with a GP.
          {:else}
            Not given
          {/if}
        </dd>
        <dt>Interests</dt>
        <dd>{about.interests.length ? about.interests.join(', ') : 'None given'}</dd>
        <dt>Arrival date</dt>
        <dd>{dateInWords(about.arrivalDate) ?? 'Not given'}</dd>
        <dt>Your mentor</dt>
        <dd>{mentor}</dd>
        <dt>From your answers when finding a mentor</dt>
        <dd>
          {#if about.summary}
            {@const styles = stylesInWords(about.summary.styles, 'your')}
            {#if about.summary.likes.length}<span class="line">Into: {about.summary.likes.join(', ')}</span>{/if}
            {#if about.summary.avoids.length}<span class="line">Would rather avoid: {about.summary.avoids.join(', ')}</span>{/if}
            {#if styles.length}<span class="line">How you like to do things: {styles.join(', ')}</span>{/if}
          {:else if matched}
            None: you found your mentor before the chat kept a summary.
          {:else}
            Nothing yet: a short summary is added when you find a mentor.
          {/if}
        </dd>
        <dt>Your checklist</dt>
        <dd>
          {checklist} It’s told which of the standard tasks you’ve done, and how many of your own are left,
          but not what yours say.
        </dd>
      </dl>
      <p class="muted">Your name, course, interests, arrival date and the rest of what you gave at sign-up: <a href="/signup">change them</a>.</p>
    </section>

    <section class="card" aria-labelledby="notes-title">
      <h2 id="notes-title">Things you asked it to remember</h2>
      {#if notes.length}
        <p class="muted">{notes.length} of {MAX_NOTES}. Delete any you’d rather it didn’t know.</p>
        <ul class="notes">
          {#each notes as note (`${note.text}-${note.savedAt?.seconds ?? ''}`)}
            <li>
              <span>{note.text}</span>
              <button class="secondary-button" type="button" onclick={() => remove(note)} disabled={busy} aria-label={`Delete: ${note.text}`}>Delete</button>
            </li>
          {/each}
        </ul>
        {#if confirmingAll}
          <p>Delete all {notes.length}? The chat won’t know them any more.</p>
          <div class="actions">
            <button class="primary-button" type="button" onclick={removeAll} disabled={busy}>{busy ? 'Deleting…' : 'Delete all'}</button>
            <button class="secondary-button" type="button" onclick={() => (confirmingAll = false)} disabled={busy}>Cancel</button>
          </div>
        {:else}
          <button class="secondary-button" type="button" onclick={() => (confirmingAll = true)} disabled={busy}>Delete all</button>
        {/if}
      {:else}
        <p class="muted">
          Nothing yet. When you tell the chat about a plan, or how you like to do things, it may offer to
          remember it for later chats. It only keeps what you choose, up to {MAX_NOTES} things, and never
          anything about your health, money, worries or safety, other people, or contact details.
        </p>
      {/if}
      {#if problem}
        <p class="error" role="alert">{problem}</p>
      {/if}
      <p class="muted" role="status">{done}</p>
    </section>
  {/if}

  <BottomNav />
</main>

<style>
  dl {
    margin: 0;
  }

  dt {
    font-weight: bold;
    margin-top: 12px;
  }

  dt:first-child {
    margin-top: 0;
  }

  dd {
    margin: 2px 0 0;
  }

  .line {
    display: block;
  }

  .notes {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }

  .notes li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }

  .notes button {
    flex: none;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .actions button {
    flex: 1;
  }

  .error {
    color: var(--danger-ink);
  }
</style>
