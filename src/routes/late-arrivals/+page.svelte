<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { SECTIONS } from '#lib/late-arrivals/guide.js';

  // For students whose arrival is delayed: the CAS deadline, who to contact, and how to catch up.
  // The content is in src/lib/late-arrivals/guide.js, where each fact has its Northumbria source.
</script>


<main class="page">
  <a href="/more">← Back</a>

  <h1>Arriving late</h1>
  <p class="muted">
    If your arrival is delayed, or you’ve arrived after teaching started. Each fact links to the
    Northumbria page it comes from.
  </p>

  {#each SECTIONS as section (section.id)}
    <section class="card" id={section.id} aria-labelledby={`${section.id}-title`}>
      <h2 id={`${section.id}-title`}>{section.title}</h2>
      <svelte:element this={section.numbered ? 'ol' : 'ul'} class="points">
        {#each section.points as point, i (i)}
          <li>
            {point.text}
            {#if point.link}
              <a class="action" href={point.link.href} target="_blank" rel="noopener noreferrer" aria-label={`${point.link.label} (opens in a new tab)`}>
                {point.link.label} ↗
              </a>
            {/if}
            {#if point.app}
              <a class="action" href={point.app.href}>{point.app.label}</a>
            {/if}
            {#if point.source}
              <a class="source" href={point.source.href} target="_blank" rel="noopener noreferrer" aria-label={`Source: ${point.source.label} (opens in a new tab)`}>
                Source: {point.source.label} ↗
              </a>
            {/if}
          </li>
        {/each}
      </svelte:element>
    </section>
  {/each}

  <BottomNav />
</main>

<style>
  .points {
    margin: 8px 0 0;
    padding-left: 20px;
  }

  .points li + li {
    margin-top: 12px;
  }

  .action {
    display: block;
    margin-top: 4px;
    font-weight: bold;
  }

  .source {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
</style>
