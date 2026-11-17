<script>
  import { rememberNote } from '#lib/checkin/chat-notes.js';
  import { signedInUid } from '#lib/firebase/auth.js';
  import { db } from '#lib/firebase/client.js';
  import { MAX_NOTES } from '#lib/checkin/remember-notes.js';

  /**
   * Something the check-in chat offered to remember for later chats, under its reply, with Remember
   * and Not now. Nothing is saved without the student's tap (see remember-notes.js and chat-notes.js).
   * Once it's saved, onsaved tells the chat page, which tells Gemini. note is bound to the chat's
   * message, so what happened stays the same when they come back.
   * @type {{ note: import('#lib/checkin/chat-session.svelte.js').OfferedNote, onsaved?: () => void }}
   */
  let { note = $bindable(), onsaved } = $props();

  let busy = $state(false);
  let problem = $state('');

  // The only place a note is saved: the student's tap on Remember.
  async function remember() {
    busy = true;
    problem = '';
    try {
      const result = await rememberNote(db, signedInUid(), note.text);
      note.state = result === 'saved' || result === 'exists' || result === 'full' ? result : 'refused';
      if (result === 'saved') onsaved?.();
    } catch (err) {
      console.error('Remembering a note failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      problem = 'We couldn’t save it just now. Please try again.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="note-card" role="group" aria-label="Remember this for later chats">
  {#if note.state === 'offered'}
    <p class="label">Remember this for later chats?</p>
    <p class="text">{note.text}</p>
    <p class="small">It’s only saved if you tap Remember, and you can delete it any time.</p>
    {#if problem}
      <p class="problem" role="alert">{problem}</p>
    {/if}
    <div class="actions">
      <button class="primary-button" type="button" onclick={remember} disabled={busy}>{busy ? 'Saving…' : 'Remember'}</button>
      <button class="secondary-button" type="button" onclick={() => (note.state = 'declined')} disabled={busy}>Not now</button>
    </div>
  {:else if note.state === 'saved'}
    <p role="status">✓ Remembered: <strong>{note.text}</strong></p>
    <a href="/about-you">See what the chat knows about you</a>
  {:else if note.state === 'exists'}
    <p>The chat already remembers that.</p>
    <a href="/about-you">See what the chat knows about you</a>
  {:else if note.state === 'full'}
    <p>The chat already remembers {MAX_NOTES} things, so this wasn’t saved. Delete one to make room.</p>
    <a href="/about-you">See what the chat knows about you</a>
  {:else if note.state === 'refused'}
    <p class="muted">Not saved: the chat doesn’t keep things like that.</p>
  {:else}
    <p class="muted">Not saved.</p>
  {/if}
</div>

<style>
  .note-card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  .note-card p {
    margin: 0 0 6px;
  }

  .label,
  .small {
    color: #647780;
    font-size: 14px;
  }

  .text {
    font-weight: bold;
  }

  .problem {
    color: #8a1c13;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .actions button {
    flex: 1;
  }
</style>
