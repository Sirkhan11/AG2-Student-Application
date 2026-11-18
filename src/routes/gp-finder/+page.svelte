<script>
  import { page } from '$app/state';
  import BackLink from '#lib/components/BackLink.svelte';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import SafetyNote from '#lib/components/SafetyNote.svelte';
  import { HOW_TO } from '#lib/checklist/how-to.js';
  import { REGISTERING } from '#lib/nhs/guide.js';
  import { newPatientsUrl } from '#lib/dentists/england.js';
  import { DENTIST_LIST_DATE, DENTIST_NATIONS, DENTIST_WORDS, nearestDentists } from '#lib/dentists/finder.js';
  import { distanceText, findADentistUrl, findAGpUrl, LIST_DATE, mailHref, OTHER_NATIONS, practicePageUrl, RESULTS, telHref } from '#lib/gp/finder.js';
  import { GpSearch } from '#lib/gp/search.svelte.js';

  // One finder for GPs and dentists, with a tab for each, as the group's wireframe. The GP tab finds
  // the surgeries nearest a student, anywhere in England: the search itself (and what it keeps
  // private: the location never leaves the phone) is in src/lib/gp/search.svelte.js, which the
  // check-in chat's GP finder card shares. The results come first; each has "How to register" (its NHS
  // page), and the registering facts sit below them. The Dentist tab (/gp-finder?tab=dentist) does the
  // same for England's NHS dental practices, with the same search and the same privacy (the location
  // never leaves the phone): each has its NHS page, which says whether it's taking new NHS patients.
  // The checklist's steps for finding a dentist sit below.

  /** Which tab is showing, from the address, so the checklist's "Find one" can open the Dentist tab. */
  let tab = $derived(page.url.searchParams.get('tab') === 'dentist' ? 'dentist' : 'gp');

  /** The registering facts, shared with the NHS guide so the two pages say the same. @type {import('#lib/nhs/guide.js').Point[]} */
  const registering = [REGISTERING.free, REGISTERING.documents, REGISTERING.studentRegistration, REGISTERING.healthHub];
  /** The checklist's steps for finding a dentist, from the NHS (how-to.js). */
  const dentistHowTo = HOW_TO.dentist;

  let query = $state('');
  /** @type {HTMLInputElement | undefined} */
  let searchBox = $state();
  const finder = new GpSearch({ needsTyping: () => searchBox?.focus() });

  /** @param {SubmitEvent} event */
  function search(event) {
    event.preventDefault();
    void finder.search(query);
  }

  // The Dentist tab: the same search, with England's NHS dental practices (dentists/finder.js).
  let dentistQuery = $state('');
  /** @type {HTMLInputElement | undefined} */
  let dentistBox = $state();
  const dentists = new GpSearch({ needsTyping: () => dentistBox?.focus(), nearest: nearestDentists, words: DENTIST_WORDS });

  /** @param {SubmitEvent} event */
  function findDentists(event) {
    event.preventDefault();
    void dentists.search(dentistQuery);
  }
</script>


<main class="page">
  <BackLink />

  <h1>Find a GP or dentist</h1>

  <nav class="tabs" aria-label="GP or dentist">
    <a href="/gp-finder" class:active={tab === 'gp'} aria-current={tab === 'gp' ? 'page' : undefined}>GP</a>
    <a href="/gp-finder?tab=dentist" class:active={tab === 'dentist'} aria-current={tab === 'dentist' ? 'page' : undefined}>Dentist</a>
  </nav>

  {#if tab === 'gp'}
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
      {#if finder.crisis}
        <SafetyNote note="What you typed wasn’t looked up or sent anywhere." />
      {/if}
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
              <!-- The practice's NHS page: whether it's taking new patients, and how to register. -->
              <a
                class="secondary-button register"
                href={practicePageUrl(practice)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`How to register with ${practice.name}, on the NHS website (opens in a new tab)`}
              >
                How to register ↗
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

    <p class="muted small remind">Phone the practice to check before you visit: what’s listed can be out of date.</p>

    <!-- Below the results, so they come first; nothing from it is lost. -->
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

    <p class="muted small">
      Every active GP surgery in England, from NHS England’s Organisation Data Service (list last changed
      on {LIST_DATE}). Surgeries in Tyne and Wear, Northumberland and County Durham also show the phone
      number, email and website from their NHS page. Contains NHS England data, under the Open Government
      Licence. Distances are worked out on your phone.
    </p>
  {:else}
    <p class="muted">
      NHS dentists are separate from GP surgeries. Search near where you live in term time. Each
      practice’s NHS page says whether it’s taking new NHS patients.
    </p>

    <form class="search" onsubmit={findDentists}>
      <label for="dentist-search">Postcode, district or place</label>
      <div class="row">
        <input id="dentist-search" class="field" bind:this={dentistBox} bind:value={dentistQuery} autocomplete="postal-code" placeholder="NE1 8ST, NE6 or Heaton" />
        <button class="primary-button" type="submit" disabled={dentists.busy !== ''}>
          {dentists.busy === 'search' ? 'Searching…' : 'Find dentists'}
        </button>
      </div>
    </form>

    <button class="secondary-button location" type="button" onclick={() => dentists.useMyLocation()} disabled={dentists.busy !== ''}>
      {dentists.busy === 'location' ? 'Finding where you are…' : 'Use my location'}
    </button>
    <p class="muted small">
      Your location stays on your phone: it isn’t saved or sent anywhere. A postcode or place you type is
      looked up on postcodes.io.
    </p>

    <div aria-live="polite">
      {#if dentists.crisis}
        <SafetyNote note="What you typed wasn’t looked up or sent anywhere." />
      {/if}
      {#if dentists.note}
        <p class="note" role="alert">{dentists.note}</p>
      {/if}

      {#if dentists.choices}
        <div class="card">
          <h2>Which {dentists.choices[0].label}?</h2>
          <ul class="choices">
            {#each dentists.choices as place (`${place.label}|${place.county}`)}
              <li>
                <button class="secondary-button" type="button" onclick={() => dentists.choose(place)}>
                  {place.label}, {place.county}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if dentists.nation}
        <div class="card">
          <p>That’s in {dentists.nation}. We only list dentists in England, so use {dentists.nation}’s own:</p>
          <a class="primary-button" href={DENTIST_NATIONS[dentists.nation].href} target="_blank" rel="noopener noreferrer" aria-label={`${DENTIST_NATIONS[dentists.nation].label} (opens in a new tab)`}>
            {DENTIST_NATIONS[dentists.nation].label} ↗
          </a>
        </div>
      {/if}

      {#if dentists.results}
        {#if dentists.results.farFromEngland}
          <div class="card nations">
            <p>You look to be outside England. If you’re in Scotland, Wales or Northern Ireland, look there:</p>
            <ul>
              {#each Object.values(DENTIST_NATIONS) as link (link.href)}
                <li><a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} (opens in a new tab)`}>{link.label} ↗</a></li>
              {/each}
            </ul>
            <p class="muted small">The nearest dentists in England are below.</p>
          </div>
        {/if}

        <h2>Nearest NHS dentists to {dentists.results.label}</h2>
        <ol class="results">
          {#each dentists.results.practices.slice(0, dentists.shown) as practice (practice.code)}
            <li class="card practice">
              <h3>{practice.name}</h3>
              <p>{practice.address}, {practice.postcode}</p>
              <p class="muted">{distanceText(practice.distanceKm)} away in a straight line</p>
              <!-- The appointments section of the practice's NHS page: whether it's taking new NHS patients. -->
              <a
                class="secondary-button register"
                href={newPatientsUrl(practice)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Whether ${practice.name} is taking new NHS patients, on the NHS website (opens in a new tab)`}
              >
                New NHS patients? ↗
              </a>
            </li>
          {/each}
        </ol>
        {#if dentists.results.practices.length > dentists.shown}
          <button class="secondary-button more" type="button" onclick={() => (dentists.shown += RESULTS)}>
            Show {Math.min(RESULTS, dentists.results.practices.length - dentists.shown)} more
          </button>
        {/if}
        <p>
          <a href={findADentistUrl(dentists.results.nhsSearch)} target="_blank" rel="noopener noreferrer" aria-label="More dentists on NHS Find a dentist (opens in a new tab)">
            More dentists on NHS Find a dentist ↗
          </a>
        </p>
      {/if}
    </div>

    <p class="muted small remind">Phone the practice to check before you visit: what’s listed can be out of date.</p>

    <section class="card">
      <h2>Finding an NHS dentist</h2>
      <ol class="points">
        {#each dentistHowTo.steps as step, i (i)}
          <li>{step}</li>
        {/each}
      </ol>
      <a class="secondary-button" href={findADentistUrl(dentists.results?.nhsSearch ?? null)} target="_blank" rel="noopener noreferrer" aria-label="NHS Find a dentist (opens in a new tab)">
        NHS Find a dentist ↗
      </a>
      <p class="sources">
        {dentistHowTo.sources.length > 1 ? 'Sources:' : 'Source:'}
        {#each dentistHowTo.sources as link, i (link.href)}
          <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} (opens in a new tab)`}>{link.label} ↗</a>{i < dentistHowTo.sources.length - 1 ? '; ' : ''}
        {/each}
      </p>
    </section>

    <p class="muted small">
      NHS dental practices in England, from NHS England’s Organisation Data Service (list last changed on
      {DENTIST_LIST_DATE}), leaving out orthodontists and oral surgeons, as you can’t register with them.
      Contains NHS England data, under the Open Government Licence. Distances are worked out on your phone.
    </p>
  {/if}

  <BottomNav />
</main>

<style>
  /* GP or dentist: two tabs, one of which is showing, like the societies and sport switch. */
  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin: 0 0 16px;
    padding: 4px;
    border-radius: var(--radius-s);
    background: var(--violet-soft);
  }

  .tabs a {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    border-radius: 9px;
    font-weight: bold;
  }

  .tabs a.active {
    background: #fff;
    box-shadow: var(--shadow-1);
    color: var(--ink);
  }

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

  .remind {
    margin: 12px 0;
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

  .register {
    width: auto;
    display: inline-flex;
    min-height: 40px;
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

  .sources {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--ink-3);
  }
</style>
