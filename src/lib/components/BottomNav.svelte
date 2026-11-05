
<script>
  import { page } from '$app/state';

  const links = [
    { name: 'Home', icon: '⌂', href: '/home' },
    { name: 'Checklist', icon: '☑', href: '/checklist' },
    { name: 'Chat', icon: '◉', href: '/check-in' },
    { name: 'Mentor', icon: '♧', href: '/mentor' },
    { name: 'More', icon: '☰', href: '/more' }
  ];
</script>

<nav class="bottom-nav" aria-label="Main navigation">
  {#each links as link}
    <a
      href={link.href}
      class:active={page.url.pathname === link.href}
      aria-current={page.url.pathname === link.href
        ? 'page'
        : undefined}
    >
      <span class="icon">{link.icon}</span>
      <span>{link.name}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    display: flex;
    justify-content: space-around;
    padding: 10px 4px calc(12px + env(safe-area-inset-bottom));
    background: white;
    border-top: 1px solid #dce5e9;
    z-index: 10;
  }

  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #647780;
  }

  .icon {
    font-size: 22px;
  }

  .active {
    color: #1764a1;
    font-weight: bold;
  }
</style>
