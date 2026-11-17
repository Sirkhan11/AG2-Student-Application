<script>
  import { serviceLink } from '#lib/nsu/services.js';

  /**
   * An NSU service suggested in the check-in chat: its name, its one-line summary, and a button to
   * its page (NSU's in a new tab, or the app's own page for Societies).
   * @type {{ service: import('#lib/nsu/services.js').Service }}
   */
  let { service } = $props();

  let link = $derived(serviceLink(service));
</script>

<article class="service-card" aria-label={service.name}>
  <h3>{service.name}</h3>
  <p>{service.summary}</p>
  {#if link.external}
    <a class="open" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${service.name} (opens in a new tab)`}>
      Open {service.name} ↗
    </a>
  {:else}
    <a class="open" href={link.href}>Open {service.name}</a>
  {/if}
</article>

<style>
  .service-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  h3 {
    margin: 0;
    font-size: 16px;
  }

  p {
    margin: 0;
    font-size: 14px;
  }

  .open {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #fff;
    font-size: 14px;
  }
</style>
