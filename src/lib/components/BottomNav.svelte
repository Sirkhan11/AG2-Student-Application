<script>
  import { page } from '$app/state';
  import Icon from '#lib/components/Icon.svelte';

  /**
   * The bar along the bottom of every signed-in page: a floating rounded bar, with the chat (the
   * heart of the app) as a raised round button in the middle. The active tab's soft highlight has
   * its own view-transition-name, so it glides to the new tab when the page changes (see
   * page-transitions.js); the bar itself stays still.
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
    <a href={link.href} class:active class:chat={link.href === '/check-in'} aria-current={active ? 'page' : undefined}>
      {#if link.href === '/check-in'}
        <span class="orb"><Icon name={link.icon} size={26} /></span>
      {:else}
        <span class="spot">
          {#if active}<span class="pill"></span>{/if}
          <Icon name={link.icon} size={23} />
        </span>
      {/if}
      <span class="label">{link.name}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    bottom: calc(10px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    width: calc(100% - 20px);
    max-width: 460px;
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    padding: 6px 6px 8px;
    border-radius: 26px;
    background: rgb(255 255 255 / 0.94);
    -webkit-backdrop-filter: saturate(1.4) blur(14px);
    backdrop-filter: saturate(1.4) blur(14px);
    box-shadow: var(--shadow-3);
    border: 1px solid rgb(236 228 246 / 0.8);
    z-index: 10;
    /* Animated on its own, so it stays still when a page slides (see page-transitions.js). */
    view-transition-name: bottom-nav;
  }

  a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 0 0;
    color: var(--ink-3);
    font-weight: 800;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
  }

  .label {
    font-size: 11.5px;
    letter-spacing: 0.01em;
  }

  .spot {
    position: relative;
    display: grid;
    place-items: center;
    width: 52px;
    height: 34px;
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
  }

  /* The chat: a raised round button, a little proud of the bar. */
  .chat {
    color: var(--ink-2);
  }

  .orb {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin-top: -26px;
    border-radius: 50%;
    color: white;
    background: linear-gradient(145deg, #8a5cff 0%, var(--violet) 45%, var(--coral) 130%);
    box-shadow:
      0 4px 0 var(--violet-press),
      0 12px 24px rgb(75 31 208 / 0.35);
    border: 3px solid white;
    view-transition-name: chat-button;
  }

  .chat.active {
    color: var(--violet);
  }

  .chat.active .orb {
    box-shadow:
      0 0 0 4px var(--violet-soft),
      0 4px 0 var(--violet-press),
      0 12px 24px rgb(75 31 208 / 0.35);
  }

  @media (prefers-reduced-motion: no-preference) {
    .spot :global(.icon),
    .orb {
      transition: transform var(--dur-2) var(--ease-bounce);
    }

    a:active .spot :global(.icon) {
      transform: scale(0.84);
      transition-duration: var(--dur-tap);
    }

    a:active .orb {
      transform: translateY(3px) scale(0.92);
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
