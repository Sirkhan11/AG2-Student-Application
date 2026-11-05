<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import LogoutButton from '#lib/components/LogoutButton.svelte';

  const features = [
    { title: 'Checklist', icon: '☑', href: '/checklist' },
    { title: 'GP Finder', icon: '♡', href: '/gp-finder' },
    { title: 'Societies', icon: '♧', href: '/societies' },
    { title: 'Your Mentor', icon: '♙', href: '/mentor' },
    { title: 'Need Help', icon: '!', href: '/need-help' },
    { title: 'More', icon: '☰', href: '/more' }
  ];
</script>

<main class="page">
  <header>
    <h1>Hi Sam</h1>
    <p class="muted">How can we help you today?</p>
  </header>

  <a class="search" href="/check-in">
    Ask anything...
  </a>

  <div class="feature-grid">
    {#each features as feature}
      <a class="feature-card" href={feature.href}>
        <span class="feature-icon">{feature.icon}</span>
        <strong>{feature.title}</strong>
      </a>
    {/each}
  </div>

  <a class="chat-button" href="/check-in">
    Chat
  </a>

  <div class="logout-container">
    <LogoutButton />
  </div>

  <BottomNav />
</main>

<style>
  .search {
    display: block;
    background: #f1f6f9;
    padding: 14px;
    border-radius: 10px;
    color: #647780;
    margin: 20px 0;
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .feature-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    min-height: 115px;
    padding: 16px;
    border: 1px solid #dce5e9;
    border-radius: 14px;
    color: #1764a1;
  }

  .feature-icon {
    font-size: 26px;
  }

  .chat-button {
    display: block;
    margin: 24px 0 12px;
    padding: 14px;
    border-radius: 10px;
    background: #1764a1;
    color: white;
    text-align: center;
  }

  .logout-container {
    display: flex;
    justify-content: center;
    margin: 0 0 24px;
  }
</style>

