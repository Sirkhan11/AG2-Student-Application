<script>
  import { serviceById } from '#lib/nsu/services.js';

  // Non-emergency help from the Students' Union, from src/lib/nsu/nsu-services.json
  // (check-services.mjs checks both are on the list). Each opens NSU's page in a new tab.
  const nsuHelp = [serviceById('wellbeing'), serviceById('advice-centre')].filter((service) => service !== null);
</script>

<main class="page">
  <a href="/">← Back</a>

  <h1>Need help now?</h1>

  <p>
    If someone is in immediate danger,
    call emergency services.
  </p>

  <section class="card">
    <h2>Emergency services</h2>
    <p>For life-threatening emergencies.</p>

    <a class="primary-button" href="tel:999">
      Call 999
    </a>
  </section>

  <section class="card">
    <h2>NHS 111</h2>
    <p>
      For urgent medical help when it is
      not a life-threatening emergency.
    </p>

    <a class="primary-button" href="tel:111">
      Call 111
    </a>
  </section>

  <section class="card">
    <h2>University support</h2>
    <p>
      Add the university's verified
      wellbeing support contact details here.
    </p>
  </section>

  <section class="card">
    <h2>Not an emergency?</h2>
    <p>Northumbria Students’ Union (NSU) can help too. These open NSU’s website in a new tab.</p>

    {#each nsuHelp as service (service.id)}
      <h3>NSU {service.name}</h3>
      <p class="muted">{service.summary}</p>
      <a class="secondary-button nsu-link" href={service.url} target="_blank" rel="noopener noreferrer">
        Open NSU {service.name}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span>
      </a>
    {/each}
  </section>

  <a href="/home">Return to Home</a>
</main>

<style>
  .nsu-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-bottom: 8px;
  }
</style>
