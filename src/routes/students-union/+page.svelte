<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { SERVICE_GROUPS, SERVICES_CHECKED_AT, SERVICES_SOURCE, serviceLink } from '#lib/nsu/services.js';

  // Northumbria Students' Union's services, in NSU's groups (src/lib/nsu/nsu-services.json). Each card
  // opens the service's own page in a new tab, except Societies, which opens /societies in the app.
  // The page needs no login: it's all public information.

  // The date the list was checked. timeZone UTC so it's the same day wherever the page is opened.
  const checked = new Date(SERVICES_CHECKED_AT).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
</script>

<main class="page">
  <h1>Students’ Union</h1>
  <p class="muted">
    Northumbria Students’ Union (NSU) runs these services for students. Tap one to open its own page,
    which has the details. Pages outside the app open in a new tab.
  </p>

  {#each SERVICE_GROUPS as group (group.name)}
    <section>
      <h2>{group.name}</h2>
      <ul class="services">
        {#each group.services as service (service.id)}
          {@const link = serviceLink(service)}
          <li>
            <a
              class="card service"
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
            >
              <span class="name">
                {service.name}{#if link.external}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span>{/if}
              </span>
              <span class="muted">{service.summary}</span>
              {#if service.seasonal}
                <span class="seasonal"><span class="tag">Seasonal</span> {service.seasonal}</span>
              {/if}
            </a>
            {#if service.topics.length > 0}
              <p class="muted" id={`topics-${service.id}`}>{service.name} topics (each opens NSU’s guide in a new tab):</p>
              <ul class="topics" aria-labelledby={`topics-${service.id}`}>
                {#each service.topics as topic (topic.url)}
                  <li>
                    <a class="topic" href={topic.url} target="_blank" rel="noopener noreferrer">
                      {topic.name}<span class="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <p class="muted">
    Checked on {checked}, so NSU may have changed things since. The latest is on
    <a href={SERVICES_SOURCE} target="_blank" rel="noopener noreferrer">mynsu.co.uk<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>.
  </p>

  <BottomNav />
</main>

<style>
  .services,
  .topics {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .service {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: inherit;
  }

  .name {
    font-weight: bold;
    color: var(--primary);
    overflow-wrap: anywhere;
  }

  .seasonal {
    font-size: 14px;
  }

  .tag {
    display: inline-block;
    margin-right: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--sun-soft);
    color: var(--sun-ink);
    font-size: 12px;
    font-weight: bold;
  }

  .topics {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }

  .topic {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    background: var(--panel);
    font-size: 14px;
  }
</style>
