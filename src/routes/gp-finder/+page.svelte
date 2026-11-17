<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { REGISTERING } from '#lib/nhs/guide.js';
  import {
    classifySearch,
    distanceText,
    findADentistUrl,
    findAGpUrl,
    LIST_DATE,
    mailHref,
    nearestAnywhere,
    OTHER_NATIONS,
    placeChoices,
    practicePageUrl,
    RESULTS,
    telHref
  } from '#lib/gp/finder.js';

  // Finds the GP surgeries nearest a student, anywhere in England (see finder.js for the two lists).
  // - The box takes a full postcode (NE1 8ST), a postcode district (NE6) or a place (Heaton), which
  //   go to postcodes.io (open data, no key) for where they are. A place with more than one match
  //   gets a short "which one?" list.
  // - "Use my location" asks the phone where it is and works everything out here, on the phone. The
  //   location is never saved, logged or sent anywhere (not to postcodes.io, our server, Firestore,
  //   Gemini or anyone else). Searches outside the North East load the all-England list, and that
  //   request is the same for everyone.
  // - Outside England, the page points to that country's own GP finder.
  // Every new search, valid or not, replaces the last result and message.

  /** The registering facts, shared with the NHS guide so the two pages say the same. @type {import('#lib/nhs/guide.js').Point[]} */
  const registering = [REGISTERING.free, REGISTERING.documents, REGISTERING.studentRegistration, REGISTERING.healthHub];

  let query = $state('');
  /** @type {HTMLInputElement | undefined} */
  let searchBox = $state();
  /** What's being looked up: a typed search, the phone's location, or nothing. */
  let busy = $state(/** @type {'' | 'search' | 'location'} */ (''));
  /** A problem or note to show. */
  let note = $state('');
  /** Places with the name typed, when there's more than one. @type {import('#lib/gp/finder.js').PlaceChoice[] | null} */
  let choices = $state(null);
  /** A search outside England: which country, for its own GP finder. @type {keyof typeof OTHER_NATIONS | null} */
  let nation = $state(null);
  /**
   * The last search's surgeries (closest first), what was searched for, the postcode or district for
   * NHS Find a GP (null for a place or location), and whether it looked like it was outside England.
   * @type {{ practices: import('#lib/gp/finder.js').NearbyPractice[], label: string, nhsSearch: string | null, source: 'north-east' | 'england', farFromEngland: boolean } | null}
   */
  let results = $state(null);
  /** How many results are showing ("Show more" adds RESULTS more). */
  let shown = $state(RESULTS);

  /** Clears the last search's results and messages: every new search starts from nothing. */
  function startOver() {
    results = null;
    choices = null;
    nation = null;
    note = '';
    shown = RESULTS;
  }

  /** @param {unknown} country */
  const otherNation = (country) => (typeof country === 'string' && Object.hasOwn(OTHER_NATIONS, country) ? /** @type {keyof typeof OTHER_NATIONS} */ (country) : null);

  /**
   * Shows the nearest surgeries to a point. The point itself isn't kept.
   * @param {number} lat
   * @param {number} lng
   * @param {string} label
   * @param {string | null} nhsSearch
   */
  async function showNearest(lat, lng, label, nhsSearch) {
    try {
      const found = await nearestAnywhere(lat, lng);
      results = { ...found, label, nhsSearch };
    } catch (err) {
      console.error('The England GP list did not load:', err instanceof Error ? err.message : err);
      note = 'We couldn’t load the list of surgeries in England just now. Please try again, or use NHS Find a GP.';
    }
  }

  /** @param {string} path */
  async function postcodesIo(path) {
    const response = await fetch(`https://api.postcodes.io${path}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`postcodes.io answered ${response.status}`);
    return (await response.json()).result;
  }

  /** @param {SubmitEvent} event */
  async function search(event) {
    event.preventDefault();
    startOver();
    const wanted = classifySearch(query);
    if (wanted.kind === 'empty') {
      note = 'Type a postcode (NE1 8ST), a postcode district (NE6) or a place (Heaton).';
      return;
    }
    busy = 'search';
    try {
      if (wanted.kind === 'postcode') {
        const found = await postcodesIo(`/postcodes/${encodeURIComponent(wanted.value)}`);
        if (!found) note = 'We couldn’t find that postcode. Please check it, or try just the first part (such as NE6).';
        else if (otherNation(found.country)) nation = otherNation(found.country);
        else await showNearest(found.latitude, found.longitude, wanted.value, wanted.value);
      } else if (wanted.kind === 'district') {
        const found = await postcodesIo(`/outcodes/${encodeURIComponent(wanted.value)}`);
        const countries = Array.isArray(found?.country) ? found.country : [];
        if (!found || typeof found.latitude !== 'number') note = 'We couldn’t find that postcode district. Please check it, or type a full postcode.';
        else if (!countries.includes('England') && otherNation(countries[0])) nation = otherNation(countries[0]);
        else await showNearest(found.latitude, found.longitude, wanted.value, wanted.value);
      } else {
        const found = placeChoices(await postcodesIo(`/places?q=${encodeURIComponent(wanted.value)}&limit=20`), wanted.value);
        if (found.length === 0) note = `We couldn’t find a place called “${wanted.value}”. Please try a postcode or district instead.`;
        else if (found.length === 1) await choose(found[0]);
        else choices = found;
      }
    } catch (err) {
      console.error('The search failed:', err instanceof Error ? err.message : err);
      note = 'We couldn’t look that up just now. Please try again, or use NHS Find a GP.';
    } finally {
      busy = '';
    }
  }

  /** One of the places with the name typed. @param {import('#lib/gp/finder.js').PlaceChoice} place */
  async function choose(place) {
    choices = null;
    if (otherNation(place.country)) {
      nation = otherNation(place.country);
      return;
    }
    await showNearest(place.lat, place.lng, `${place.label}, ${place.county}`, null);
  }

  /** Works out the nearest surgeries from the phone's location, which never leaves the phone. */
  function useMyLocation() {
    startOver();
    if (!('geolocation' in navigator)) {
      askToType('This browser can’t share your location, so please type a postcode or place instead.');
      return;
    }
    busy = 'location';
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await showNearest(position.coords.latitude, position.coords.longitude, 'you', null);
        busy = '';
      },
      (failure) => {
        busy = '';
        askToType(
          failure.code === failure.PERMISSION_DENIED
            ? 'Your location wasn’t shared, so please type a postcode or place instead.'
            : 'We couldn’t get your location, so please type a postcode or place instead.'
        );
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 }
    );
  }

  /** @param {string} message */
  function askToType(message) {
    note = message;
    searchBox?.focus();
  }
</script>


<main class="page">
  <a href="/more">← Back</a>

  <h1>Find a GP</h1>
  <p class="muted">
    Search near where you live in term time. Each surgery’s NHS page says whether it’s taking new
    patients and how to register.
  </p>

  <form class="search" onsubmit={search}>
    <label for="search">Postcode, district or place</label>
    <div class="row">
      <input id="search" class="field" bind:this={searchBox} bind:value={query} autocomplete="postal-code" placeholder="NE1 8ST, NE6 or Heaton" />
      <button class="primary-button" type="submit" disabled={busy !== ''}>
        {busy === 'search' ? 'Searching…' : 'Find GPs'}
      </button>
    </div>
  </form>

  <button class="secondary-button location" type="button" onclick={useMyLocation} disabled={busy !== ''}>
    {busy === 'location' ? 'Finding where you are…' : 'Use my location'}
  </button>
  <p class="muted small">
    Your location stays on your phone: it isn’t saved or sent anywhere. A postcode or place you type is
    looked up on postcodes.io.
  </p>

  <div aria-live="polite">
    {#if note}
      <p class="note" role="alert">{note}</p>
    {/if}

    {#if choices}
      <div class="card">
        <h2>Which {choices[0].label}?</h2>
        <ul class="choices">
          {#each choices as place (`${place.label}|${place.county}`)}
            <li>
              <button class="secondary-button" type="button" onclick={() => choose(place)}>
                {place.label}, {place.county}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if nation}
      <div class="card">
        <p>That’s in {nation}. We only list surgeries in England, so use {nation}’s own GP finder:</p>
        <a class="primary-button" href={OTHER_NATIONS[nation].href} target="_blank" rel="noopener noreferrer" aria-label={`${OTHER_NATIONS[nation].label} (opens in a new tab)`}>
          {OTHER_NATIONS[nation].label} ↗
        </a>
      </div>
    {/if}

    {#if results}
      {#if results.farFromEngland}
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

      <h2>Nearest GP surgeries to {results.label}</h2>
      {#if results.source === 'england'}
        <p class="muted small">Each surgery’s NHS page has its email address and website.</p>
      {/if}
      <ol class="results">
        {#each results.practices.slice(0, shown) as practice (practice.code)}
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
      {#if results.practices.length > shown}
        <button class="secondary-button more" type="button" onclick={() => (shown += RESULTS)}>
          Show {Math.min(RESULTS, results.practices.length - shown)} more
        </button>
      {/if}
      <p>
        <a href={findAGpUrl(results.nhsSearch)} target="_blank" rel="noopener noreferrer" aria-label="More surgeries on NHS Find a GP (opens in a new tab)">
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
      href={findADentistUrl(results?.nhsSearch)}
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
    border-radius: 10px;
    background: #fff3cd;
    color: #4d3800;
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
    color: #647780;
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
