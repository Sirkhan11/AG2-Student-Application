<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { COSTS_CHECKED_ON, SECTIONS, withFigures } from '#lib/nhs/guide.js';

  // How the NHS works for a new student in England, in short sections they can scan. The content
  // is in src/lib/nhs/guide.js: every fact links to its official source, and the money figures come
  // from nhs-costs.json, with the date they were checked.
</script>

<svelte:head>
  <title>NHS Guide</title>
</svelte:head>

<main class="page">
  <a href="/more">← Back</a>

  <h1>NHS Guide</h1>
  <p class="muted">
    How the NHS works for students in England. Each point links to the official page it comes from.
    Costs checked on {COSTS_CHECKED_ON}; they change every April.
  </p>

  <nav class="contents" aria-label="Sections">
    <ul>
      {#each SECTIONS as section (section.id)}
        <li><a href={`#${section.id}`}>{section.title}</a></li>
      {/each}
    </ul>
  </nav>

  {#each SECTIONS as section (section.id)}
    <section class="card" id={section.id} aria-labelledby={`${section.id}-title`}>
      <h2 id={`${section.id}-title`}>{section.title}</h2>
      <p>{section.intro}</p>

      {#if section.points.length}
        <ul class="points">
          {#each section.points as point, i (i)}
            <li>
              {withFigures(point.text)}
              {#if point.toBeConfirmed}
                <span class="tbc">To be confirmed</span>
              {/if}
              {#if point.source}
                <a class="source" href={point.source.href} target="_blank" rel="noopener noreferrer" aria-label={`Source: ${point.source.label} (opens in a new tab)`}>
                  Source: {point.source.label} ↗
                </a>
              {/if}
              {#if point.link}
                <a class="source" href={point.link.href} target="_blank" rel="noopener noreferrer" aria-label={`${point.link.label} (opens in a new tab)`}>
                  {point.link.label} ↗
                </a>
              {/if}
              {#if point.app}
                <a class="app-link" href={point.app.href}>{point.app.label}</a>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if section.terms}
        <dl class="terms">
          {#each section.terms as term (term.term)}
            <div>
              <dt>{term.term}</dt>
              <dd>
                {withFigures(term.meaning)}
                <a class="source" href={term.source.href} target="_blank" rel="noopener noreferrer" aria-label={`Source: ${term.source.label} (opens in a new tab)`}>
                  Source ↗
                </a>
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
    </section>
  {/each}

  <BottomNav />
</main>

<style>
  .contents ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
  }

  .contents a {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: #f1f6f9;
    font-size: 14px;
  }

  section {
    scroll-margin-top: 12px;
  }

  .points {
    margin: 8px 0 0;
    padding-left: 18px;
  }

  .points li + li {
    margin-top: 10px;
  }

  .source {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .app-link {
    display: block;
    margin-top: 4px;
    font-weight: bold;
  }

  .tbc {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 8px;
    border-radius: 10px;
    background: #fff3cd;
    color: #6b4e00;
    font-size: 12px;
    font-weight: bold;
  }

  .terms {
    margin: 8px 0 0;
  }

  .terms div + div {
    margin-top: 10px;
  }

  .terms dt {
    font-weight: bold;
  }

  .terms dd {
    margin: 2px 0 0;
  }
</style>
