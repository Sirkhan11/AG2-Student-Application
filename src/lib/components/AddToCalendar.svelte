<script>
  import { downloadIcs } from '#lib/calendar/ics.js';
  import { outlookWebUrl } from '#lib/calendar/outlook.js';

  /**
   * One "Add to calendar" button for a Blackboard date, offering both ways in: Outlook on the web
   * (the university account, with the item filled in) or a calendar file (.ics) for any other
   * calendar app. Both are made on the phone; nothing goes to the app's server.
   * @type {{ entry: import('#lib/calendar/ics.js').CalendarEntry, label?: string }}
   */
  let { entry, label = 'Add to calendar' } = $props();

  let open = $state(false);
</script>

<span class="add">
  <button class="link" type="button" aria-expanded={open ? 'true' : 'false'} onclick={() => (open = !open)}>
    {label}
  </button>
  {#if open}
    <span class="choices">
      <a href={outlookWebUrl(entry)} target="_blank" rel="noopener noreferrer" aria-label={`Add “${entry.title}” in Outlook on the web (opens in a new tab)`}>
        Outlook (university account) ↗
      </a>
      <button class="link" type="button" onclick={() => downloadIcs(entry)}>Calendar file (.ics), for other apps</button>
    </span>
  {/if}
</span>

<style>
  .add {
    display: block;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0 6px 12px;
    padding-left: 10px;
    border-left: 2px solid var(--border);
  }

  .choices a {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
  }

  .link {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--primary);
    font-size: 14px;
    text-align: left;
    text-decoration: underline;
  }
</style>
