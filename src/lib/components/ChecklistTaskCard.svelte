<script>
  import Ask4HelpLink from '#lib/components/Ask4HelpLink.svelte';
  import { isOutside } from '#lib/checklist/how-to.js';

  /**
   * One task while going through the checklist in the chat (checklist-flow.js): its how-to (the
   * steps, a link, and something the chat can do for it, if anything), then Done, which ticks it
   * through the checklist's own change, Not yet, and Ask4Help. For one of their own tasks, there's no
   * how-to. Done and Not yet only work while it's the live card; the links always work.
   * @type {{ card: import('#lib/checkin/checklist-flow.js').TaskCard & { id: number }, live: boolean,
   *   flow: { done: () => void, notYet: () => void } | null, onask?: (text: string) => void }}
   */
  let { card, live, flow, onask } = $props();
</script>

<div class="task-card" role="group" aria-label={`Task ${card.position} of ${card.count}: ${card.title}`}>
  {#if card.howTo}
    <ol>
      {#each card.howTo.steps as step, i (i)}
        <li>{step}</li>
      {/each}
    </ol>
    <div class="links">
      {#if card.howTo.chat}
        <button class="secondary-button" type="button" disabled={!live} onclick={() => onask?.(/** @type {{ ask: string }} */ (card.howTo?.chat).ask)}>{card.howTo.chat.label}</button>
      {/if}
      {#if isOutside(card.howTo.link)}
        <a class="secondary-button" href={card.howTo.link.href} target="_blank" rel="noopener noreferrer" aria-label={`${card.howTo.link.label} (opens in a new tab)`}>{card.howTo.link.label} ↗</a>
      {:else}
        <a class="secondary-button" href={card.howTo.link.href}>{card.howTo.link.label}</a>
      {/if}
    </div>
  {:else}
    <p class="muted">One of your own tasks.</p>
  {/if}
  <div class="actions">
    <button class="primary-button" type="button" disabled={!live} onclick={() => flow?.done()}>Done</button>
    <button class="secondary-button" type="button" disabled={!live} onclick={() => flow?.notYet()}>Not yet</button>
  </div>
  <Ask4HelpLink about={card.title} />
</div>

<style>
  .task-card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  ol {
    margin: 0 0 10px;
    padding-left: 20px;
  }

  li + li {
    margin-top: 6px;
  }

  .links,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }

  .actions button {
    flex: 1;
  }
</style>
