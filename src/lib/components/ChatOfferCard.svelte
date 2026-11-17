<script>
  import { chatAction } from '#lib/checkin/chat-actions.js';

  /**
   * One of the chat's own actions that Gemini offered (chat-actions.js), under its reply, with Start
   * and Not now. Nothing starts until they tap Start. offer is bound to the chat's message, so what
   * they chose stays the same when they come back to the chat.
   * @type {{ offer: import('#lib/checkin/chat-session.svelte.js').Offer, onstart: () => void, ondecline: () => void, disabled?: boolean }}
   */
  let { offer = $bindable(), onstart, ondecline, disabled = false } = $props();
  let words = $derived(chatAction(offer.action)?.card ?? null);
</script>

{#if words}
  <div class="offer-card" role="group" aria-label={words.title}>
    {#if offer.state === 'offered'}
      <p class="title">{words.title}</p>
      <p class="muted">{words.text}</p>
      <div class="actions">
        <button class="primary-button" type="button" {disabled} onclick={() => ((offer.state = 'started'), onstart())}>Start</button>
        <button class="secondary-button" type="button" onclick={() => ((offer.state = 'declined'), ondecline())}>Not now</button>
      </div>
    {:else if offer.state === 'started'}
      <p class="muted">{words.title.replace(/\?$/, '')}: started below.</p>
    {:else}
      <p class="muted">Not now.</p>
    {/if}
  </div>
{/if}

<style>
  .offer-card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  .offer-card p {
    margin: 0 0 6px;
  }

  .title {
    font-weight: bold;
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
