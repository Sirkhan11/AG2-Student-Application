<script>
  import { SAFETY_MESSAGE } from '#lib/checkin/safety.js';

  /**
   * The chat's support message (safety.js), on a page: shown when something typed into a form suggests
   * the student may be at risk, in the same words and with the same way to Need help now. Each form
   * says what happened to what they typed (note), which is usually that it wasn't sent (agent1.md A13).
   * @type {{ note?: string }}
   */
  let { note = '' } = $props();
</script>

<div class="safety-note" role="alert">
  <p>{SAFETY_MESSAGE}</p>
  {#if note}<p class="muted">{note}</p>{/if}
  <a class="primary-button" href="/need-help">Need help now</a>
</div>

<style>
  .safety-note {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 12px 0;
    padding: 14px 16px;
    border: 1px solid var(--danger-line);
    border-radius: var(--radius-m);
    background: var(--danger-soft);
    color: var(--ink);
  }

  .safety-note p {
    margin: 0;
  }
</style>
