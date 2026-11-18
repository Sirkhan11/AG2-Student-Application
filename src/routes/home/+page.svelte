<script>
  import { onMount } from 'svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import LogoutButton from '#lib/components/LogoutButton.svelte';
  import FinishDetailsCard from '#lib/components/FinishDetailsCard.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Mascot from '#lib/components/Mascot.svelte';
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

  /** The places to go, each with its own colour. */
  const features = /** @type {const} */ ([
    { title: 'GP Finder', icon: 'medical', href: '/gp-finder', tone: 'coral' },
    { title: 'Societies', icon: 'people', href: '/societies', tone: 'violet' },
    { title: 'Students’ Union', icon: 'star', href: '/students-union', tone: 'sun' },
    { title: 'Your Mentor', icon: 'mentor', href: '/mentor', tone: 'sky' },
    { title: 'Need Help', icon: 'help', href: '/need-help', tone: 'danger' },
    { title: 'More', icon: 'more', href: '/more', tone: 'ink' }
  ]);
</script>

<main class="page">
  <header class="hero">
    <div>
      <h1 class:waiting={greeting === null}>{greeting ?? 'Hi there'}</h1>
      <p class="lead">How can we help you today?</p>
    </div>
    <Mascot mood="wave" size={96} />
  </header>

  <!-- Only if their sign-up details were lost before they verified their email. -->
  <FinishDetailsCard />

  <!-- The chat grows out of this when it's tapped (page-transitions.js). -->
  <a class="ask" href="/check-in">
    <span class="ask-icon"><Icon name="sparkle" size={26} /></span>
    <span class="ask-words">
      <strong>Ask me anything</strong>
      <span>Tick off tasks, find societies, get help</span>
    </span>
    <span class="ask-go"><Icon name="arrow" size={22} /></span>
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
        <span class="feature-icon"><Icon name={feature.icon} size={24} /></span>
        <strong>{feature.title}</strong>
      </a>
    {/each}
  </div>

  <div class="logout-container">
    <LogoutButton />
  </div>

  <BottomNav />
</main>

<style>
  .waiting {
    visibility: hidden;
  }

  .hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 6px 0 18px;
  }

  .hero h1 {
    font-size: 38px;
    margin: 0 0 4px;
  }

  .lead {
    margin: 0;
    color: var(--ink-2);
    font-weight: 600;
  }

  /* The way into the chat: bold, warm, and pressable. */
  .ask {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px;
    border-radius: var(--radius-l);
    color: white;
    background:
      radial-gradient(120% 140% at 0% 0%, #8f63ff 0%, rgb(143 99 255 / 0) 55%),
      linear-gradient(120deg, var(--violet) 0%, #7d3bea 55%, var(--coral) 140%);
    box-shadow:
      0 5px 0 var(--violet-press),
      0 16px 32px rgb(75 31 208 / 0.3);
    transition: transform var(--dur-2) var(--ease-bounce), box-shadow var(--dur-2) var(--ease-out);
  }

  .ask-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 16px;
    background: rgb(255 255 255 / 0.18);
    flex: none;
  }

  .ask-words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .ask-words strong {
    font-family: var(--font-display);
    font-size: 21px;
    font-weight: 800;
  }

  .ask-words span {
    font-weight: 600;
    opacity: 0.88;
    font-size: 14px;
  }

  .ask-go {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: white;
    color: var(--violet);
    flex: none;
  }

  .ask:active {
    transform: translateY(4px) scale(0.985);
    box-shadow:
      0 1px 0 var(--violet-press),
      0 6px 14px rgb(75 31 208 / 0.24);
    transition-duration: var(--dur-tap);
  }

  .progress {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 16px 0;
    padding: 14px 16px;
    border-radius: var(--radius-l);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-2);
    color: var(--ink);
    transition: transform var(--dur-2) var(--ease-bounce);
  }

  .progress-words {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .progress-words strong {
    font-family: var(--font-display);
    font-size: 18px;
  }

  .progress-words span {
    color: var(--ink-3);
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress:active,
  .feature-card:active {
    transform: scale(0.97);
    transition-duration: var(--dur-tap);
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-top: 16px;
  }

  .feature-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 18px;
    min-height: 112px;
    padding: 16px;
    border-radius: var(--radius-l);
    background: white;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-1);
    color: var(--ink);
    transition: transform var(--dur-2) var(--ease-bounce);
  }

  .feature-card strong {
    font-family: var(--font-display);
    font-size: 17px;
  }

  .feature-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }

  .coral .feature-icon {
    background: var(--coral-soft);
    color: var(--coral-press);
  }

  .violet .feature-icon {
    background: var(--violet-soft);
    color: var(--violet);
  }

  .sun .feature-icon {
    background: var(--sun-soft);
    color: #b07800;
  }

  .sky .feature-icon {
    background: #e0f0ff;
    color: #1b6fc2;
  }

  .danger .feature-icon {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .ink .feature-icon {
    background: #ecebf2;
    color: var(--ink-2);
  }

  .logout-container {
    display: flex;
    justify-content: center;
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
