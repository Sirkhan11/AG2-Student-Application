<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import Icon from '#lib/components/Icon.svelte';

  /** Each place, with its own icon and colour (the same as Home's tiles). */
  const menu = /** @type {const} */ ([
    { name: 'NHS Guide', href: '/nhs-guide', icon: 'heart', tone: 'coral' },
    { name: 'Late Arrivals', href: '/late-arrivals', icon: 'clock', tone: 'sun' },
    { name: 'GP and Dentist Finder', href: '/gp-finder', icon: 'medical', tone: 'coral' },
    { name: 'Societies', href: '/societies', icon: 'people', tone: 'violet' },
    { name: 'Students’ Union', href: '/students-union', icon: 'star', tone: 'sun' },
    { name: 'What the chat knows about you', href: '/about-you', icon: 'sparkle', tone: 'violet' },
    { name: 'Privacy', href: '/privacy', icon: 'shield', tone: 'mint' }
  ]);
</script>

<main class="page">
  <h1>More</h1>
  <p class="muted">Additional support and settings</p>

  <nav class="menu" aria-label="More">
    {#each menu as item (item.href)}
      <a class="menu-item" href={item.href}>
        <span class="menu-icon {item.tone}"><Icon name={item.icon} size={22} /></span>
        <span class="menu-name">{item.name}</span>
        <span class="go"><Icon name="arrow" size={18} /></span>
      </a>
    {/each}
  </nav>

  <nav class="menu" aria-label="Account">
    <a class="menu-item" href="/">
      <span class="menu-icon ink"><Icon name="logout" size={22} /></span>
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
    box-shadow: var(--shadow-2);
    overflow: hidden;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 60px;
    padding: 10px 16px;
    color: var(--ink);
    font-weight: 800;
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
    width: 40px;
    height: 40px;
    border-radius: 13px;
    flex: none;
  }

  .go {
    color: var(--ink-3);
    transition: transform var(--dur-2) var(--ease-spring);
  }

  .coral {
    background: var(--coral-soft);
    color: var(--coral-press);
  }

  .violet {
    background: var(--violet-soft);
    color: var(--violet);
  }

  .sun {
    background: var(--sun-soft);
    color: #b07800;
  }

  .mint {
    background: var(--mint-soft);
    color: var(--mint-press);
  }

  .ink {
    background: #ecebf2;
    color: var(--ink-2);
  }

  @media (prefers-reduced-motion: no-preference) {
    .menu-item:active .go {
      transform: translateX(4px);
    }
  }
</style>
