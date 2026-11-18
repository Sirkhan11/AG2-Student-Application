<script>
  import { ASK4HELP } from '#lib/checklist/how-to.js';

  /**
   * "Stuck? Contact Ask4Help", with Ask4Help Online (a new tab) and its number to call. Under each
   * checklist task and on the checklist page; the chat's task cards use it too.
   * @type {{ about?: string }} about: what they're stuck on, for screen readers (the task's name)
   */
  let { about = '' } = $props();
</script>

<p class="ask4help">
  Stuck? Contact Ask4Help:
  <a
    href={ASK4HELP.online.href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`Ask4Help Online${about ? `, for help with ${about}` : ''} (opens in a new tab)`}>{ASK4HELP.online.label} ↗</a>
  or call <a href={ASK4HELP.tel}>{ASK4HELP.phone}</a>.
</p>

<style>
  .ask4help {
    margin: 8px 0 0;
    font-size: 14px;
    color: var(--ink-3);
  }
</style>
