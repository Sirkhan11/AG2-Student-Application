<script>
  import BackLink from '#lib/components/BackLink.svelte';
  import { URGENT_HELP } from '#lib/need-help/urgent.js';
  import { serviceById } from '#lib/nsu/services.js';

  // Help first, with no questions: four one-tap cards, most urgent at the top (need-help/urgent.js,
  // where each number has the official page it was checked against), then "Not urgent?" with
  // Northumbria's own support and the Students' Union's. Public, so it opens without logging in, and
  // whatever state an account is in (account-gate.js).

  // Non-emergency help from the Students' Union, from src/lib/nsu/nsu-services.json
  // (check-services.mjs checks both are on the list). Each opens NSU's page in a new tab.
  const nsuHelp = [serviceById('wellbeing'), serviceById('advice-centre')].filter((service) => service !== null);
</script>

<main class="page">
  <BackLink />

  <h1>Need help now?</h1>
  <p class="muted">You’re not alone. Choose an option below: each is one tap to call or text.</p>

  <ul class="urgent" aria-label="Urgent help">
    {#each URGENT_HELP as help (help.id)}
      <li>
        <a class="help-card {help.tone}" href={help.href}>
          <span class="help-title">{help.title}</span>
          <span class="help-words">{help.words}</span>
        </a>
      </li>
    {/each}
  </ul>

  <section class="card">
    <h2>Not urgent?</h2>

    <!-- Northumbria's own support, checked on 17 November 2026 against:
         - https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/frequently-asked-questions/
           (last reviewed 3 July 2026): "you can contact Ask4Help by telephoning 0191 227 4646", current
           students can also use Ask4Help Online on the Student Portal, and the support "is not an
           emergency or crisis service".
         - https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/overview-of-support/
           ("Overview of Mental Health Support").
         Neither page gives Ask4Help's opening hours, so none are shown. -->
    <h3>University support</h3>
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

    <h3>Students’ Union</h3>
    <p>Northumbria Students’ Union (NSU) can help too. These open NSU’s website in a new tab.</p>

    {#each nsuHelp as service (service.id)}
      <h4>NSU {service.name}</h4>
      <p class="muted">{service.summary}</p>
      <a class="secondary-button nsu-link" href={service.url} target="_blank" rel="noopener noreferrer">
        Open NSU {service.name}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span>
      </a>
    {/each}
  </section>

  <a href="/home">Return to Home</a>
</main>

<style>
  .urgent {
    display: grid;
    gap: 10px;
    margin: 16px 0 18px;
    padding: 0;
    list-style: none;
  }

  /* One tap each: a filled red card for 999, soft red for the rest. */
  .help-card {
    display: block;
    padding: 14px 16px;
    border: 1px solid var(--danger-line);
    border-radius: var(--radius-m);
    background: var(--danger-soft);
    color: var(--danger-ink);
    text-decoration: none;
  }

  .help-card.danger {
    border-color: var(--danger);
    background: var(--danger);
    color: #fff;
  }

  .help-title {
    display: block;
    font-size: 19px;
    font-weight: 700;
  }

  .help-words {
    display: block;
    margin-top: 4px;
    font-size: 14px;
  }

  .help-card.danger .help-words {
    color: rgb(255 255 255 / 0.9);
  }

  .card h3 {
    margin: 14px 0 6px;
  }

  .card h4 {
    margin: 12px 0 2px;
    font-size: 15px;
  }

  .nsu-link,
  .uni-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-bottom: 8px;
  }
</style>
