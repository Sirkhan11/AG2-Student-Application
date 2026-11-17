<script>
  import BlackboardSection from '#lib/components/BlackboardSection.svelte';

  // Development only (see +page.js): the checklist's Blackboard section with made-up modules, and its
  // other states, to check the layout on a phone without signing in, a server or Blackboard.

  const now = Date.now();
  const DAY = 86_400_000;
  const at = (/** @type {number} */ days, hour = 14) => {
    const date = new Date(now + days * DAY);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  /** @type {import('#lib/blackboard/shapes.js').Module[]} */
  const modules = [
    {
      id: 'm1', code: 'MADE-UP101', name: 'Made-Up Programming', url: '#made-up', partial: [],
      tasks: [
        { id: 't1', title: 'Assignment 1: Portfolio', due: at(-2), url: null },
        { id: 't2', title: 'Quiz 3', due: at(2, 12), url: null },
        { id: 't3', title: 'Assignment 2: Project', due: at(30), url: null }
      ],
      events: [{ id: 'e1', title: 'In-class test', start: at(5, 10), end: at(5, 11) }],
      content: [
        { id: 'c1', title: 'Week 8: Objects', created: at(-1, 9), kind: 'folder', url: '#made-up' },
        { id: 'c2', title: 'Lecture slides: Objects', created: at(-1, 9), kind: 'item', url: '#made-up' },
        { id: 'c3', title: 'Week 7: Testing your code', created: at(-8, 9), kind: 'folder', url: '#made-up' }
      ],
      announcements: [{ id: 'a1', title: 'This week’s lab has moved', text: 'This week’s lab is in a different room. See you there!', posted: at(-1, 11) }]
    },
    {
      id: 'm2', code: 'MADE-UP102', name: 'Made-Up Academic Writing', url: '#made-up', partial: ['tasks'],
      tasks: [{ id: 't4', title: 'Reflective log', due: at(16), url: null }],
      events: [],
      content: [{ id: 'c4', title: 'Week 6: Editing your work', created: at(-15, 9), kind: 'folder', url: '#made-up' }],
      announcements: []
    },
    {
      id: 'm3', code: 'MADE-UP103', name: 'Made-Up Team Project', url: '#made-up', partial: [],
      tasks: [],
      events: [{ id: 'e2', title: 'Guest lecture: working in teams', start: at(12, 14), end: at(12, 15) }],
      content: [{ id: 'c5', title: 'Week 2: Working agreements', created: at(-20, 9), kind: 'folder', url: '#made-up' }],
      announcements: [{ id: 'a2', title: 'Teams are up', text: 'Your project teams are on the module page.', posted: at(-2, 11) }]
    }
  ];

  /** @type {Record<string, import('#lib/blackboard/shapes.js').BlackboardView>} */
  const STATES = {
    connected: { connected: true, modules, readAt: new Date(now).toISOString(), mock: true },
    'not connected': { connected: false, reason: 'not-connected' },
    reconnect: { connected: false, reason: 'reconnect' },
    'not answering': { connected: true, error: 'unavailable' },
    'no modules': { connected: true, modules: [], readAt: new Date(now).toISOString(), mock: false }
  };
  let state = $state('connected');
</script>

<main class="page">
  <h1>Blackboard section preview</h1>
  <p class="muted">Development only. Made-up modules; nothing is sent anywhere.</p>
  <div class="states">
    {#each Object.keys(STATES) as name (name)}
      <button class:active={state === name} type="button" onclick={() => (state = name)}>{name}</button>
    {/each}
  </div>
  {#key state}
    <BlackboardSection preview={{ view: STATES[state], uid: `preview-${state}`, now }} />
  {/key}
</main>

<style>
  .states {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .states button {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: #fff;
  }

  .states .active {
    background: var(--primary);
    color: #fff;
  }
</style>
