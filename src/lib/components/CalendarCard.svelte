<script>
  import { downloadIcs } from '#lib/calendar/ics.js';
  import { outlookWebUrl } from '#lib/calendar/outlook.js';

  /**
   * For a student who'd rather keep things in their own calendar: one task as a calendar item, in
   * Outlook on the web (their university account, filled in, as the Blackboard dates do) or as a
   * calendar file (.ics) for any other calendar app. They choose the name, day and time here; both
   * are made on the phone, and the app keeps nothing: they save it in their own calendar.
   * @type {{ title?: string }}
   */
  let { title = '' } = $props();

  const htmlId = $props.id();
  /** The date as an input wants it: 2026-11-19. @param {Date} date */
  const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // The task it was opened for, to start with: they can change it here.
  // svelte-ignore state_referenced_locally
  let name = $state(title);
  let day = $state(isoDay(tomorrow));
  let time = $state('09:00');

  /** The calendar item: half an hour from the day and time chosen, here on the phone. */
  let entry = $derived.by(() => {
    const start = new Date(`${day}T${time || '09:00'}`);
    const valid = !Number.isNaN(start.getTime());
    const from = valid ? start.getTime() : tomorrow.getTime();
    return {
      id: `ag2-task-${from}`,
      title: name.trim() || 'Settling-in task',
      start: from,
      end: from + 30 * 60 * 1000,
      description: 'From your AG2 checklist.'
    };
  });
</script>

<div class="calendar-card" role="group" aria-label="Add to your calendar">
  <p class="label">Add to your calendar</p>
  <label for={`${htmlId}-name`}>What</label>
  <input id={`${htmlId}-name`} class="field" bind:value={name} maxlength="100" />
  <div class="row">
    <div>
      <label for={`${htmlId}-day`}>Day</label>
      <input id={`${htmlId}-day`} class="field" type="date" bind:value={day} />
    </div>
    <div>
      <label for={`${htmlId}-time`}>Time</label>
      <input id={`${htmlId}-time`} class="field" type="time" bind:value={time} />
    </div>
  </div>
  <div class="actions">
    <a class="primary-button" href={outlookWebUrl(entry)} target="_blank" rel="noopener noreferrer" aria-label={`Add “${entry.title}” in Outlook on the web (opens in a new tab)`}>Add to Outlook ↗</a>
    <button class="secondary-button" type="button" onclick={() => downloadIcs(entry)}>Calendar file (.ics)</button>
  </div>
  <p class="muted small">You save it in your own calendar: the app keeps nothing.</p>
</div>

<style>
  .calendar-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-1);
    background: #fff;
    color: var(--ink);
  }

  .calendar-card p {
    margin: 0;
  }

  .label {
    font-weight: bold;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row > div {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .small {
    font-size: 14px;
  }
</style>
