<script>
  import { SAYS } from '#lib/matching/find-mentor-steps.js';

  /**
   * A card from finding a mentor in the chat (mentor-flow.js): the meeting choices, the answers to
   * check with Change and Find my mentor, what to do when Gemini can't help, and Try again or a link.
   * Its buttons only work while it's the live card, so an old card can't restart a step. flow is the
   * flow running.
   * @type {{ card: import('#lib/checkin/mentor-flow.js').FlowCard & { id: number }, live: boolean, flow: any }}
   */
  let { card, live, flow } = $props();
</script>

{#if card.kind === 'choices'}
  <div class="actions" role="group" aria-label="How often would you like to meet?">
    {#each card.choices as choice (choice.id)}
      <button class="secondary-button" type="button" disabled={!live} onclick={() => flow?.choose(choice.id)}>{choice.label}</button>
    {/each}
  </div>
{:else if card.kind === 'review'}
  <div class="review">
    {#each card.items as item (item.change)}
      <div class="item">
        <p class="label">{item.label}</p>
        <p class="answer">{item.answer}</p>
        <button class="secondary-button change" type="button" disabled={!live} aria-label={`Change: ${item.label}`} onclick={() => flow?.change(item.change)}>Change</button>
      </div>
    {/each}
    <button class="primary-button" type="button" disabled={!live} onclick={() => flow?.confirm()}>Find my mentor</button>
  </div>
{:else if card.kind === 'gemini-failed'}
  <div class="actions">
    <button class="primary-button" type="button" disabled={!live} onclick={() => flow?.tryAgain()}>Try again</button>
    <button class="secondary-button" type="button" disabled={!live} onclick={() => flow?.coordinator()}>{SAYS.askCoordinator}</button>
  </div>
{:else if card.kind === 'gemini-unavailable'}
  <div class="actions">
    <button class="primary-button" type="button" disabled={!live} onclick={() => flow?.coordinator()}>{SAYS.askCoordinator}</button>
  </div>
{:else if card.kind === 'retry'}
  <div class="actions">
    <button class="primary-button" type="button" disabled={!live} onclick={() => flow?.tryAgain()}>Try again</button>
  </div>
{:else if card.kind === 'link'}
  <div class="actions">
    <a class="secondary-button" href={card.href}>{card.label}</a>
  </div>
{/if}

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .review {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-1);
    background: #fff;
    color: var(--ink);
  }

  .item {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  .item p {
    margin: 0 0 4px;
  }

  .label {
    color: var(--ink-3);
    font-size: 14px;
  }

  .answer {
    white-space: pre-wrap;
  }

  .change {
    padding: 4px 10px;
    font-size: 14px;
  }
</style>
