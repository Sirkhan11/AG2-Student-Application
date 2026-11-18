<script>
  import BackLink from '#lib/components/BackLink.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { REGISTERING } from '#lib/nhs/guide.js';
  import { distanceText, findADentistUrl, findAGpUrl, LIST_DATE, mailHref, OTHER_NATIONS, practicePageUrl, RESULTS, telHref } from '#lib/gp/finder.js';
  import { GpSearch } from '#lib/gp/search.svelte.js';

  // Finds the GP surgeries nearest a student, anywhere in England. The search itself (and what it
  // keeps private: the location never leaves the phone) is in src/lib/gp/search.svelte.js, which the
  // check-in chat's GP finder card shares.

  /** The registering facts, shared with the NHS guide so the two pages say the same. @type {import('#lib/nhs/guide.js').Point[]} */
  const registering = [REGISTERING.free, REGISTERING.documents, REGISTERING.studentRegistration, REGISTERING.healthHub];

  let query = $state('');
  /** @type {HTMLInputElement | undefined} */
  let searchBox = $state();
  const finder = new GpSearch({ needsTyping: () => searchBox?.focus() });

  /** @param {SubmitEvent} event */
  function search(event) {
    event.preventDefault();
    void finder.search(query);
  }
</script>


<main class="page">
  <BackLink />

  <h1>Find a GP</h1>
  <p class="muted">
    Search near where you live in term time. Each surgery’s NHS page says whether it’s taking new
    patients and how to register.
  </p>

  <form class="search" onsubmit={search}>
    <label for="search">Postcode, district or place</label>
    <div class="row">
      <input id="search" class="field" bind:this={searchBox} bind:value={query} autocomplete="postal-code" placeholder="NE1 8ST, NE6 or Heaton" />
      <button class="primary-button" type="submit" disabled={finder.busy !== ''}>
        {finder.busy === 'search' ? 'Searching…' : 'Find GPs'}
      </button>
    </div>
  </form>

  <button class="secondary-button location" type="button" onclick={() => finder.useMyLocation()} disabled={finder.busy !== ''}>
    {finder.busy === 'location' ? 'Finding where you are…' : 'Use my location'}
  </button>
  <p class="muted small">
    Your location stays on your phone: it isn’t saved or sent anywhere. A postcode or place you type is
    looked up on postcodes.io.
  </p>

  <div aria-live="polite">
    {#if finder.note}
      <p class="note" role="alert">{finder.note}</p>
    {/if}

    {#if finder.choices}
      <div class="card">
        <h2>Which {finder.choices[0].label}?</h2>
        <ul class="choices">
          {#each finder.choices as place (`${place.label}|${place.county}`)}
            <li>
              <button class="secondary-button" type="button" onclick={() => finder.choose(place)}>
                {place.label}, {place.county}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if finder.nation}
      <div class="card">
        <p>That’s in {finder.nation}. We only list surgeries in England, so use {finder.nation}’s own GP finder:</p>
        <a class="primary-button" href={OTHER_NATIONS[finder.nation].href} target="_blank" rel="noopener noreferrer" aria-label={`${OTHER_NATIONS[finder.nation].label} (opens in a new tab)`}>
          {OTHER_NATIONS[finder.nation].label} ↗
        </a>
      </div>
    {/if}

    {#if finder.results}
      {#if finder.results.farFromEngland}
        <div class="card nations">
          <p>You look to be outside England. If you’re in Scotland, Wales or Northern Ireland, use its own GP finder:</p>
          <ul>
            {#each Object.values(OTHER_NATIONS) as link (link.href)}
              <li><a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} (opens in a new tab)`}>{link.label} ↗</a></li>
            {/each}
          </ul>
          <p class="muted small">The nearest surgeries in England are below.</p>
        </div>
      {/if}

      <h2>Nearest GP surgeries to {finder.results.label}</h2>
      {#if finder.results.source === 'england'}
        <p class="muted small">Each surgery’s NHS page has its email address and website.</p>
      {/if}
      <ol class="results">
        {#each finder.results.practices.slice(0, finder.shown) as practice (practice.code)}
          <li class="card practice">
            <h3>{practice.name}</h3>
            <p>{practice.address}, {practice.postcode}</p>
            <p class="muted">{distanceText(practice.distanceKm)} away in a straight line</p>
            <dl class="contact">
              {#if practice.phone}
                <div>
                  <dt>Phone</dt>
                  <dd><a href={telHref(practice.phone)} aria-label={`Call ${practice.name} on ${practice.phone}`}>{practice.phone}</a></dd>
                </div>
              {/if}
              {#if practice.email}
                <div>
                  <dt>Email</dt>
                  <dd><a href={mailHref(practice.email)}>{practice.email}</a></dd>
                </div>
              {/if}
              {#if practice.website}
                <div>
                  <dt>Website</dt>
                  <dd>
                    <a href={practice.website} target="_blank" rel="noopener noreferrer" aria-label={`${practice.name}’s website (opens in a new tab)`}>
                      {practice.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} ↗
                    </a>
                  </dd>
                </div>
              {/if}
            </dl>
            <a
              class="primary-button"
              href={practicePageUrl(practice)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${practice.name} on the NHS website: registering and new patients (opens in a new tab)`}
            >
              NHS page: register ↗
            </a>
          </li>
        {/each}
      </ol>
      {#if finder.results.practices.length > finder.shown}
        <button class="secondary-button more" type="button" onclick={() => (finder.shown += RESULTS)}>
          Show {Math.min(RESULTS, finder.results.practices.length - finder.shown)} more
        </button>
      {/if}
      <p>
        <a href={findAGpUrl(finder.results.nhsSearch)} target="_blank" rel="noopener noreferrer" aria-label="More surgeries on NHS Find a GP (opens in a new tab)">
          More surgeries on NHS Find a GP ↗
        </a>
      </p>
    {/if}
  </div>

  <section class="card">
    <h2>Registering</h2>
    <ul class="points">
      {#each registering as point, i (i)}
        <li>
          {point.text}
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
        </li>
      {/each}
    </ul>
    <a href="/nhs-guide#gp">More in the NHS Guide</a>
  </section>

  <section class="card">
    <h2>Dentists</h2>
    <p>NHS dentists are separate from GP surgeries. The NHS website lists the ones near you.</p>
    <a
      class="secondary-button"
      href={findADentistUrl(finder.results?.nhsSearch)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="NHS Find a dentist (opens in a new tab)"
    >
      NHS Find a dentist ↗
    </a>
  </section>

  <p class="muted small">
    Every active GP surgery in England, from NHS England’s Organisation Data Service (list last changed
    on {LIST_DATE}). Surgeries in Tyne and Wear, Northumberland and County Durham also show the phone
    number, email and website from their NHS page. Contains NHS England data, under the Open Government
    Licence. Distances are worked out on your phone.
  </p>

  <BottomNav />
</main>

<style>
  .search label {
    display: block;
    margin-bottom: 4px;
    font-weight: bold;
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }

  /* The shared .field and .primary-button styles are full width; in this row the box takes the room. */
  .row .field {
    flex: 1;
    min-width: 0;
    margin: 0;
  }

  .row .primary-button {
    flex: none;
    width: auto;
    padding: 12px 16px;
  }

  .location {
    width: 100%;
    margin-top: 10px;
  }

  .small {
    font-size: 13px;
  }

  .note {
    padding: 10px 12px;
    border-radius: var(--radius-s);
    background: var(--sun-soft);
    color: var(--sun-ink);
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }

  .choices button {
    width: 100%;
    text-align: left;
  }

  .nations ul {
    margin: 6px 0;
    padding-left: 18px;
  }

  .nations li + li {
    margin-top: 6px;
  }

  .results {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .practice h3 {
    margin: 0 0 4px;
    font-size: 17px;
  }

  .practice p {
    margin: 0 0 4px;
  }

  .contact {
    margin: 8px 0 10px;
  }

  .contact div {
    display: flex;
    gap: 8px;
    padding: 4px 0;
  }

  .contact dt {
    flex: none;
    width: 64px;
    color: var(--ink-3);
    font-size: 14px;
  }

  .contact dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .contact a {
    display: inline-block;
    min-height: 32px;
  }

  .more {
    width: 100%;
    margin-bottom: 12px;
  }

  .points {
    margin: 8px 0 12px;
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
</style>
