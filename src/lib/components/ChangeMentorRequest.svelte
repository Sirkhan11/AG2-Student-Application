<script>
  import { onMount } from 'svelte';
  import { db, getFirebaseAuth } from '#lib/firebase/client.js';
  import { CHANGE_REASONS, MAX_DETAILS_LENGTH, URGENT_REASONS } from '#lib/matching/change-reasons.js';
  import { cancelChangeRequest, loadChangeRequest, sendChangeRequest } from '#lib/matching/change-request.js';

  /**
   * On the Your Mentor page, for a student with a mentor: ask the coordinator for a different one.
   * They pick a reason (and can add their own words); it goes only to the coordinator, never to the
   * mentor or the chat. One open request at a time: once sent, the page says so and lets them cancel.
   * The reason and their words are never logged.
   * @typedef {'loading' | 'error' | 'none' | 'form' | 'sent'} View
   */
  let view = $state(/** @type {View} */ ('loading'));
  let request = $state(/** @type {import('#lib/matching/change-request.js').ChangeRequest | null} */ (null));
  let reason = $state('');
  let details = $state('');
  let busy = $state(false);
  let problem = $state('');

  const uid = () => getFirebaseAuth().currentUser?.uid ?? null;

  async function load() {
    view = 'loading';
    const id = uid();
    if (!id) return;
    try {
      request = await loadChangeRequest(db, id);
      view = request ? 'sent' : 'none';
    } catch (err) {
      console.error('Loading the change request failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
      view = 'error';
    }
  }
  onMount(load);

  async function send() {
    const id = uid();
    if (!id) return;
    busy = true;
    problem = '';
    try {
      await sendChangeRequest(db, id, reason, details);
      reason = '';
      details = '';
      await load();
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err)?.code;
      if (!code) {
        problem = /** @type {Error} */ (err).message;
      } else {
        console.error('Sending the change request failed:', code);
        problem = 'We couldn’t send it just now. Please try again.';
        // It may already be open (sent from another device, say): show it if so.
        const open = await loadChangeRequest(db, id).catch(() => null);
        if (open) {
          request = open;
          view = 'sent';
        }
      }
    } finally {
      busy = false;
    }
  }

  async function cancel() {
    const id = uid();
    if (!id) return;
    busy = true;
    problem = '';
    try {
      await cancelChangeRequest(db, id);
      request = null;
      view = 'none';
    } catch (err) {
      console.error('Cancelling the change request failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
      problem = 'We couldn’t cancel it just now. Please try again.';
    } finally {
      busy = false;
    }
  }

  /** @param {Date | null} date */
  const sentOn = (date) => (date ? ` on ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : '');
</script>

<section class="card change" aria-labelledby="change-title">
  <h2 id="change-title">Want a different mentor?</h2>

  {#if view === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if view === 'error'}
    <p class="error" role="alert">We couldn’t check for a request just now.</p>
    <button class="secondary-button" type="button" onclick={load}>Try again</button>
  {:else if view === 'sent' && request}
    <p role="status">
      You’ve asked the mentoring coordinator for a different mentor{sentOn(request.sentAt)}. They’ll be in
      touch. Only the coordinator can see your reason.
    </p>
    {#if problem}
      <p class="error" role="alert">{problem}</p>
    {/if}
    <button class="secondary-button" type="button" onclick={cancel} disabled={busy}>
      {busy ? 'Cancelling…' : 'Cancel the request'}
    </button>
    <p class="muted small">If it’s urgent, or you feel unsafe, <a href="/need-help">get help now</a>.</p>
  {:else if view === 'none'}
    <p>If it isn’t working out, you can ask the mentoring coordinator to find you someone else.</p>
    <button class="secondary-button" type="button" onclick={() => (view = 'form')}>Ask for a different mentor</button>
  {:else}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <fieldset>
        <legend>Why would you like a different mentor?</legend>
        {#each CHANGE_REASONS as option (option.id)}
          <label class="reason">
            <input type="radio" name="change-reason" value={option.id} bind:group={reason} required />
            {option.label}
          </label>
        {/each}
      </fieldset>

      <label for="change-details">
        {reason === 'something-else' ? 'Tell us a little, in your own words' : 'Anything you’d like to add (optional)'}
      </label>
      <textarea
        id="change-details"
        class="field"
        rows="3"
        maxlength={MAX_DETAILS_LENGTH}
        required={reason === 'something-else'}
        bind:value={details}
      ></textarea>
      <p class="muted small">{details.length}/{MAX_DETAILS_LENGTH}</p>

      <p class="note">This goes only to the mentoring coordinator. Your mentor won’t see it, and the chat never reads it.</p>
      <p class={URGENT_REASONS.includes(reason) ? 'urgent' : 'muted small'}>
        If it’s urgent, or you feel unsafe, <a href="/need-help">get help now</a>.
      </p>

      {#if problem}
        <p class="error" role="alert">{problem}</p>
      {/if}
      <div class="actions">
        <button class="primary-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send to the coordinator'}</button>
        <button class="secondary-button" type="button" onclick={() => (view = 'none')} disabled={busy}>Not now</button>
      </div>
    </form>
  {/if}
</section>

<style>
  .change h2 {
    margin-top: 0;
  }

  fieldset {
    margin: 0 0 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .reason {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 0;
  }

  .small {
    font-size: 13px;
  }

  .note {
    padding: 10px 12px;
    border-radius: 10px;
    background: #eef6f9;
  }

  .urgent {
    padding: 10px 12px;
    border: 1px solid #e8b6b1;
    border-radius: 10px;
    color: #8a1c13;
    font-weight: bold;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
</style>
