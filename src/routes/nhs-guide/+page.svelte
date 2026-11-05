
<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
</script>

<main class="page">
  <a href="/more">← Back</a>

  <h1>NHS Guide</h1>
  <p class="muted">
    Information about accessing healthcare in the UK.
  </p>

  <section class="card">
    <h2>Registering with a GP</h2>
    <p>
      A GP is usually your first contact for
      non-emergency medical support.
    </p>
    <a href="/gp-finder">Find a GP</a>
  </section>

  <section class="card">
    <h2>NHS 111</h2>
    <p>
      NHS 111 can help when you need urgent
      medical advice but it is not a
      life-threatening emergency.
    </p>
    <a href="https://111.nhs.uk/">
      Visit NHS 111
    </a>
  </section>

  <BottomNav />
</main>
