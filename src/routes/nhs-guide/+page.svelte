<script>
  import BackLink from '#lib/components/BackLink.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { loadMyRecord } from '#lib/checklist/store.js';
  import { COSTS_CHECKED_ON, sectionsFor, withFigures } from '#lib/nhs/guide.js';

  // How the NHS works for a new student in England, in short sections they can scan. The content
  // is in src/lib/nhs/guide.js: every fact links to its official source, and the money figures come
  // from nhs-costs.json, with the date they were checked. The order follows what they said at
  // sign-up (sectionsFor): a home student sees registering with a GP first and the visa section
  // further down; an international student, or one who hasn't said, sees the visa section first.

  /** The sections in their order: null until the student's record has been read (nothing shows meanwhile, so the order never jumps). */
  let sections = $state(/** @type {import('#lib/nhs/guide.js').Section[] | null} */ (null));

  $effect(() =>
    watchSignedIn(async (signedIn) => {
      if (!signedIn) return;
      try {
        sections = sectionsFor((await loadMyRecord()).studentType);
      } catch (err) {
        console.error('Loading the record for the NHS guide failed:', /** @type {{ code?: string }} */ (err)?.code ?? 'error');
        sections = sectionsFor(null);
      }
    })
  );
</script>


<main class="page">
  <BackLink />

  <h1>NHS Guide</h1>
  <p class="muted">
    How the NHS works for students in England. Each point links to the official page it comes from.
    Costs checked on {COSTS_CHECKED_ON}; they change every April.
  </p>

  {#if !sections}
    <p class="muted" role="status">Loading…</p>
  {:else}
  <nav class="contents" aria-label="Sections">
    <ul>
      {#each sections as section (section.id)}
        <li><a href={`#${section.id}`}>{section.title}</a></li>
      {/each}
    </ul>
  </nav>

  {#each sections as section (section.id)}
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
  {/if}

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
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    background: var(--panel);
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
    border-radius: var(--radius-s);
    background: var(--sun-soft);
    color: var(--sun-ink);
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
