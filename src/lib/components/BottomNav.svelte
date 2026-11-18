<script>
  import { page } from '$app/state';
  import Icon from '#lib/components/Icon.svelte';

  /**
   * The tab bar along the bottom of every signed-in page, docked above the phone's home bar. The
   * active tab's soft highlight has its own view-transition-name, so it glides to the new tab when
   * the page changes (see page-transitions.js); the bar itself stays still.
   */
  const links = /** @type {const} */ ([
    { name: 'Home', icon: 'home', href: '/home' },
    { name: 'Checklist', icon: 'checklist', href: '/checklist' },
    { name: 'Chat', icon: 'chat', href: '/check-in' },
    { name: 'Mentor', icon: 'mentor', href: '/mentor' },
    { name: 'More', icon: 'more', href: '/more' }
  ]);
</script>

<nav class="bottom-nav" aria-label="Main navigation">
  {#each links as link (link.href)}
    {@const active = page.url.pathname === link.href}
    <a href={link.href} class:active aria-current={active ? 'page' : undefined}>
      <span class="spot">
        {#if active}<span class="pill"></span>{/if}
        <Icon name={link.icon} size={22} stroke={active ? 2.3 : 1.9} />
      </span>
      <span class="label">{link.name}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    display: flex;
    justify-content: space-around;
    padding: 5px 4px calc(5px + env(safe-area-inset-bottom));
    background: rgb(255 255 255 / 0.92);
    -webkit-backdrop-filter: saturate(1.6) blur(16px);
    backdrop-filter: saturate(1.6) blur(16px);
    border-top: 1px solid var(--line);
    z-index: 10;
    /* Animated on its own, so it stays still when a page slides (see page-transitions.js). */
    view-transition-name: bottom-nav;
  }

  a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    color: var(--ink-3);
    font-weight: 500;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
  }

  .label {
    font-size: 11px;
  }

  .spot {
    position: relative;
    display: grid;
    place-items: center;
    width: 50px;
    height: 30px;
  }

  .spot :global(.icon) {
    position: relative;
  }

  /* The active tab's highlight: it glides between tabs (view-transition-name). */
  .pill {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-pill);
    background: var(--violet-soft);
    view-transition-name: nav-pill;
  }

  .active {
    color: var(--violet);
    font-weight: 600;
  }

  @media (prefers-reduced-motion: no-preference) {
    .spot :global(.icon) {
      transition: transform var(--dur-2) var(--ease-bounce);
    }

    a:active .spot :global(.icon) {
      transform: scale(0.84);
      transition-duration: var(--dur-tap);
    }

    .active .spot :global(.icon) {
      animation: nav-pop var(--dur-3) var(--ease-bounce);
    }
  }

  @keyframes nav-pop {
    from {
      transform: scale(0.7);
    }
  }
</style>
