<script>
  import BackLink from '#lib/components/BackLink.svelte';
  import { serviceById } from '#lib/nsu/services.js';

  // Non-emergency help from the Students' Union, from src/lib/nsu/nsu-services.json
  // (check-services.mjs checks both are on the list). Each opens NSU's page in a new tab.
  const nsuHelp = [serviceById('wellbeing'), serviceById('advice-centre')].filter((service) => service !== null);
</script>

<main class="page">
  <BackLink />

  <h1>Need help now?</h1>

  <p>
    If someone is in immediate danger,
    call emergency services.
  </p>

  <section class="card">
    <h2>Emergency services</h2>
    <p>For life-threatening emergencies.</p>

    <a class="primary-button emergency" href="tel:999">
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

  <!-- Northumbria's own support, checked on 17 November 2026 against:
       - https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/frequently-asked-questions/
         (last reviewed 3 July 2026): "you can contact Ask4Help by telephoning 0191 227 4646", current
         students can also use Ask4Help Online on the Student Portal, and the support "is not an
         emergency or crisis service".
       - https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/overview-of-support/
         ("Overview of Mental Health Support").
       Neither page gives Ask4Help's opening hours, so none are shown. -->
  <section class="card">
    <h2>University support</h2>
    <p>
      For Northumbria’s mental health and wellbeing support, call Ask4Help. It isn’t an emergency or
      crisis service: if you’re in danger, call 999.
    </p>

    <a class="primary-button" href="tel:+441912274646">
      Call Ask4Help on 0191 227 4646
    </a>
    <p class="muted">Current students can also ask through Ask4Help Online on the Student Portal.</p>

    <a
      class="secondary-button uni-link"
      href="https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/overview-of-support/"
      target="_blank"
      rel="noopener noreferrer"
    >
      Counselling and mental health support<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span>
    </a>
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
  /* 999: red, as an emergency button should be. */
  .emergency {
    background: var(--danger);
  }

  @media (hover: hover) {
    .emergency:hover:not(:disabled) {
      background: #b91c1c;
    }
  }

  .emergency:active {
    background: #b91c1c;
  }

  .nsu-link,
  .uni-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-bottom: 8px;
  }
</style>
