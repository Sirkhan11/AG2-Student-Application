<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import Icon from '#lib/components/Icon.svelte';

  /** Each place, with its icon. Your Mentor is here (and on Home) since Societies took its place in the bottom bar (nav-tabs.js). */
  const menu = /** @type {const} */ ([
    { name: 'Your Mentor', href: '/mentor', icon: 'mentor' },
    { name: 'NHS Guide', href: '/nhs-guide', icon: 'heart' },
    { name: 'Late Arrivals', href: '/late-arrivals', icon: 'clock' },
    { name: 'GP and Dentist Finder', href: '/gp-finder', icon: 'medical' },
    { name: 'Societies', href: '/societies', icon: 'people' },
    { name: 'Students’ Union', href: '/students-union', icon: 'star' },
    { name: 'What the chat knows about you', href: '/about-you', icon: 'sparkle' },
    { name: 'Privacy', href: '/privacy', icon: 'shield' }
  ]);
</script>

<main class="page">
  <h1>More</h1>
  <p class="muted">Additional support and settings</p>

  <nav class="menu" aria-label="More">
    {#each menu as item (item.href)}
      <a class="menu-item" href={item.href}>
        <span class="menu-icon"><Icon name={item.icon} size={20} /></span>
        <span class="menu-name">{item.name}</span>
        <span class="go"><Icon name="arrow" size={18} /></span>
      </a>
    {/each}
  </nav>

  <nav class="menu" aria-label="Account">
    <a class="menu-item" href="/">
      <span class="menu-icon"><Icon name="logout" size={20} /></span>
      <span class="menu-name">Log out (prototype only)</span>
    </a>
  </nav>

  <BottomNav />
</main>

<style>
  .menu {
    margin: 16px 0;
    border-radius: var(--radius-l);
    background: white;
    border: 1px solid var(--line);
    overflow: hidden;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 54px;
    padding: 8px 14px;
    color: var(--ink);
    font-weight: 500;
    transition: background-color var(--dur-1) ease;
  }

  .menu-item + .menu-item {
    border-top: 1px solid var(--line);
  }

  .menu-item:active {
    background: var(--panel);
  }

  .menu-name {
    flex: 1;
    min-width: 0;
  }

  .menu-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: var(--violet);
    background: var(--violet-soft);
    flex: none;
  }

  .go {
    color: var(--ink-3);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  @media (prefers-reduced-motion: no-preference) {
    .menu-item:active .go {
      transform: translateX(4px);
    }
  }
</style>
