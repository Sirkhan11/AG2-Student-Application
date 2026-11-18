<script>
  import { onMount } from 'svelte';
  import ChangeMentorRequest from '#lib/components/ChangeMentorRequest.svelte';
  import { loadMyMatch } from '#lib/matching/matches.js';

  /**
   * Their mentor, in the check-in chat ({{your-mentor}}, and {{change-mentor}} with change set: see
   * chat-actions.js): the mentor's name, how to get in touch and how often they asked to meet, read
   * here from their own match record, so Gemini never sees them; and asking the mentoring coordinator
   * for a different mentor (ChangeMentorRequest), which goes only to the coordinator. Only with a
   * mentor: otherwise it says where they are.
   * @type {{ change?: boolean }} change: they asked for a different mentor, so the form opens straight away
   */
  let { change = false } = $props();

  let view = $state(/** @type {'loading' | 'error' | 'ready'} */ ('loading'));
  let match = $state(/** @type {import('#lib/matching/matches.js').Match | null} */ (null));
  let changing = $state(false);

  onMount(async () => {
    try {
      match = await loadMyMatch();
      changing = change && match?.status === 'matched';
      view = 'ready';
    } catch (err) {
      console.error('Loading their mentor for the chat failed:', /** @type {{ code?: string }} */ (err)?.code ?? err);
      view = 'error';
    }
  });
</script>

<div class="mentor-card" role="group" aria-label="Your mentor">
  {#if view === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if view === 'error'}
    <p>We couldn’t load your mentor just now.</p>
    <a href="/mentor">Your mentor page</a>
  {:else if match?.status === 'matched'}
    <p class="label">Your mentor</p>
    <p class="name">{match.mentorName ?? 'Your mentor'}</p>
    <!-- The same as the Your Mentor page: the coordinator introduces them. -->
    <p><strong>Getting in touch:</strong> your coordinator will introduce you.</p>
    {#if match.meetingFrequency}
      <p><strong>How often:</strong> you asked to meet {match.meetingFrequency}.</p>
    {/if}
    {#if !changing}
      <button class="secondary-button" type="button" onclick={() => (changing = true)}>Ask for a different mentor</button>
    {/if}
  {:else if match?.status === 'coordinator'}
    <p>We’re finding you a mentor, and we’ll let you know soon.</p>
  {:else}
    <p>You haven’t got a mentor yet.</p>
  {/if}
</div>
{#if changing}
  <ChangeMentorRequest open />
{/if}

<style>
  .mentor-card {
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-1);
    background: #fff;
    color: var(--ink);
  }

  .mentor-card p {
    margin: 0 0 6px;
  }

  .label {
    color: var(--ink-3);
    font-size: 14px;
  }

  .name {
    font-weight: bold;
    font-size: 18px;
  }
</style>
