<script>
  import { onMount } from 'svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import LogoutButton from '#lib/components/LogoutButton.svelte';
  import FinishDetailsCard from '#lib/components/FinishDetailsCard.svelte';
  import FindMentorCard from '#lib/components/FindMentorCard.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import ProgressRing from '#lib/components/ProgressRing.svelte';
  import { loadChecklist, loadMyName } from '#lib/checklist/store.js';
  import { watchAccount } from '#lib/firebase/auth.js';
  import { greetingFor } from '#lib/students/greeting.js';

  // "Hi Sam", from the name they gave at sign-up, or "Hi there". null until it's known: the heading
  // keeps its space but stays hidden, so a wrong name never flashes.
  let greeting = $state(/** @type {string | null} */ (null));
  /** Their checklist so far, for the ring: null until it's loaded (or if it can't be). */
  let progress = $state(/** @type {{ done: number, total: number, next: string | null } | null} */ (null));

  onMount(() =>
    watchAccount(async (account) => {
      if (!account?.verified) return;
      try {
        greeting = greetingFor(await loadMyName());
      } catch (err) {
        console.error('Loading the name failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
        greeting = greetingFor(null);
      }
      try {
        const tasks = await loadChecklist();
        progress = { done: tasks.filter((task) => task.done).length, total: tasks.length, next: tasks.find((task) => !task.done)?.title ?? null };
      } catch (err) {
        console.error('Loading the checklist for Home failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
      }
    })
  );

  /** The places to go. Need Help is red, so it's easy to find. */
  const features = /** @type {const} */ ([
    { title: 'GP Finder', icon: 'medical', href: '/gp-finder', tone: '' },
    { title: 'Societies', icon: 'people', href: '/societies', tone: '' },
    { title: 'Students’ Union', icon: 'star', href: '/students-union', tone: '' },
    { title: 'Your Mentor', icon: 'mentor', href: '/mentor', tone: '' },
    { title: 'Need Help', icon: 'help', href: '/need-help', tone: 'danger' },
    { title: 'More', icon: 'more', href: '/more', tone: '' }
  ]);
</script>

<main class="page">
  <header class="hero">
    <h1 class:waiting={greeting === null}>{greeting ?? 'Hi there'}</h1>
    <p class="lead">How can we help you today?</p>
  </header>

  <!-- Only if their sign-up details were lost before they verified their email. -->
  <FinishDetailsCard />
  <!-- Only if they asked for a mentor at sign-up and haven't found one yet. -->
  <FindMentorCard />

  <!-- The chat grows out of this when it's tapped (page-transitions.js). -->
  <a class="ask" href="/check-in">
    <span class="ask-icon"><Icon name="sparkle" size={22} /></span>
    <span class="ask-words">
      <strong>Ask me anything</strong>
      <span>Tasks, societies, help and more</span>
    </span>
    <span class="ask-go"><Icon name="arrow" size={20} /></span>
  </a>

  {#if progress}
    <a class="progress" href="/checklist">
      <ProgressRing done={progress.done} total={progress.total} />
      <span class="progress-words">
        <strong>{progress.done === progress.total ? 'Checklist all done!' : 'Your checklist'}</strong>
        <span>{progress.next ? `Next up: ${progress.next}` : 'Nice work: everything’s ticked.'}</span>
      </span>
      <Icon name="arrow" size={20} />
    </a>
  {/if}

  <div class="feature-grid">
    {#each features as feature (feature.href)}
      <a class="feature-card {feature.tone}" href={feature.href}>
        <span class="feature-icon"><Icon name={feature.icon} size={22} /></span>
        <strong>{feature.title}</strong>
      </a>
    {/each}
  </div>

  <div class="logout-container logout-slot">
    <LogoutButton />
  </div>

  <BottomNav />
</main>

<style>
  .waiting {
    visibility: hidden;
  }

  .hero {
    margin: 8px 0 18px;
  }

  .hero h1 {
    font-size: 30px;
    margin: 0 0 2px;
  }

  .lead {
    margin: 0;
    color: var(--ink-3);
  }

  /* The way into the chat: like a search box, so it reads as "ask here". */
  .ask {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius-l);
    color: var(--ink);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-2);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .ask-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    color: white;
    background: var(--violet);
    flex: none;
  }

  .ask-words {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .ask-words strong {
    font-size: 17px;
    font-weight: 600;
  }

  .ask-words span {
    color: var(--ink-3);
    font-size: 14px;
  }

  .ask-go {
    color: var(--ink-3);
    flex: none;
  }

  .ask:active,
  .progress:active,
  .feature-card:active {
    transform: scale(0.98);
    transition-duration: var(--dur-tap);
  }

  .progress {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 12px 0;
    padding: 14px;
    border-radius: var(--radius-l);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-1);
    color: var(--ink);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .progress-words {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .progress-words strong {
    font-size: 16px;
    font-weight: 600;
  }

  .progress-words span {
    color: var(--ink-3);
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress > :global(.icon) {
    color: var(--ink-3);
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-top: 12px;
  }

  .feature-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius-l);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-1);
    color: var(--ink);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .feature-card strong {
    font-size: 15px;
    font-weight: 600;
  }

  .feature-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--violet-soft);
    color: var(--violet);
  }

  .danger .feature-icon {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .logout-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 24px 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .ask,
    .progress,
    .feature-card {
      transition: none;
    }

    .ask:active,
    .progress:active,
    .feature-card:active {
      transform: none;
    }
  }
</style>
