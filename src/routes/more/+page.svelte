
<script>
  import BottomNav from '#lib/components/BottomNav.svelte';

  const menu = [
    { name: 'NHS Guide', href: '/nhs-guide' },
    { name: 'Late Arrivals', href: '/late-arrivals' },
    { name: 'GP and Dentist Finder', href: '/gp-finder' },
    { name: 'Societies', href: '/societies' },
    { name: 'Privacy', href: '/privacy' }
  ];
</script>

<main class="page">
  <h1>More</h1>
  <p class="muted">Additional support and settings</p>

  {#each menu as item}
    <a class="menu-item" href={item.href}>
      <span>{item.name}</span>
      <span>›</span>
    </a>
  {/each}

  <a class="menu-item" href="/">
    Log out (prototype only)
  </a>

  <BottomNav />
</main>

<style>
  .menu-item {
    display: flex;
    justify-content: space-between;
    padding: 18px 12px;
    border-bottom: 1px solid #e1e8ed;
    color: #172630;
  }
</style>
