<script>
  import { SAYS } from '#lib/matching/find-mentor-steps.js';
  import ChecklistTaskCard from '#lib/components/ChecklistTaskCard.svelte';

  /**
   * A card from an action the app is running in the chat: finding a mentor (mentor-flow.js: the
   * meeting choices, the answers to check with Change and Find my mentor, what to do when Gemini
   * can't help) or going through the checklist (checklist-flow.js: a task), and Try again or a link
   * for either. Its buttons only work while it's the live card, so an old card can't restart a step.
   * flow is the action running; onask asks the chat something for a task (its in-chat action).
   * @type {{ card: (import('#lib/checkin/mentor-flow.js').FlowCard | import('#lib/checkin/checklist-flow.js').ChecklistCard) & { id: number },
   *   live: boolean, flow: any, onask?: (text: string) => void }}
   */
  let { card, live, flow, onask } = $props();
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
{:else if card.kind === 'checklist-task'}
  <ChecklistTaskCard {card} {live} {flow} {onask} />
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
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  .item {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .item p {
    margin: 0 0 4px;
  }

  .label {
    color: #647780;
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
