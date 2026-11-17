<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import { REGISTERING } from '#lib/nhs/guide.js';
  import {
    distanceText,
    findADentistUrl,
    findAGpUrl,
    isPostcode,
    LIST_DATE,
    nearestPractices,
    normalisePostcode,
    practicePageUrl,
    RADIUS_KM,
    telHref
  } from '#lib/gp/finder.js';

  // Finds the GP surgeries nearest a student, from NHS England's list (src/lib/gp/gp-practices.json:
  // every active GP practice within 10 km of the Newcastle city campus).
  // - A postcode is the main way in. It goes to postcodes.io (open data, no key) for its coordinates,
  //   then the nearest surgeries are worked out here.
  // - "Use my location" asks the phone where it is and works the distances out here, on the phone.
  //   The location is never saved, logged or sent anywhere (not to postcodes.io, Firestore, Gemini or
  //   anyone else): it's passed straight to nearestPractices() and then forgotten. Only the results
  //   are kept, and only while the page is open.
  // Distances are straight lines.

  /**
   * The registering facts, shared with the NHS guide so the two pages say the same.
   * @type {import('#lib/nhs/guide.js').Point[]}
   */
  const registering = [REGISTERING.free, REGISTERING.documents, REGISTERING.studentRegistration, REGISTERING.healthHub];

  let postcode = $state('');
  /** @type {HTMLInputElement | undefined} */
  let postcodeBox = $state();
  /** What's being looked up: a postcode, the phone's location, or nothing. */
  let busy = $state(/** @type {'' | 'postcode' | 'location'} */ (''));
  /** A problem or note to show above the results. */
  let note = $state('');
  /**
   * The last search: the nearest surgeries (closest first), the postcode searched (null for a
   * location), and whether it was within the list's area.
   * @type {{ practices: import('#lib/gp/finder.js').NearbyPractice[], postcode: string | null, inArea: boolean } | null}
   */
  let results = $state(null);

  /**
   * Shows the nearest surgeries to a point. The point itself isn't kept.
   * @param {number} lat
   * @param {number} lng
   * @param {string | null} searchedPostcode
   */
  function showNearest(lat, lng, searchedPostcode) {
    const { inArea, practices } = nearestPractices(lat, lng);
    results = { practices, postcode: searchedPostcode, inArea };
  }

  /** @param {SubmitEvent} event */
  async function searchPostcode(event) {
    event.preventDefault();
    note = '';
    const wanted = normalisePostcode(postcode);
    if (!isPostcode(wanted)) {
      note = 'Please enter a full UK postcode, such as NE1 8ST.';
      return;
    }
    busy = 'postcode';
    try {
      const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(wanted)}`);
      if (response.status === 404) {
        note = 'We couldn’t find that postcode. Please check it and try again.';
        return;
      }
      if (!response.ok) throw new Error(`postcodes.io answered ${response.status}`);
      const { result } = await response.json();
      postcode = wanted;
      showNearest(result.latitude, result.longitude, wanted);
    } catch (err) {
      console.error('The postcode lookup failed:', err);
      note = 'We couldn’t look up that postcode just now. Please try again, or use NHS Find a GP.';
    } finally {
      busy = '';
    }
  }

  /** Works out the nearest surgeries from the phone's location, which never leaves the phone. */
  function useMyLocation() {
    note = '';
    if (!('geolocation' in navigator)) {
      askForPostcode('This browser can’t share your location, so please type your postcode instead.');
      return;
    }
    busy = 'location';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        busy = '';
        showNearest(position.coords.latitude, position.coords.longitude, null);
      },
      (failure) => {
        busy = '';
        askForPostcode(
          failure.code === failure.PERMISSION_DENIED
            ? 'Your location wasn’t shared, so please type your postcode instead.'
            : 'We couldn’t get your location, so please type your postcode instead.'
        );
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 }
    );
  }

  /** @param {string} message */
  function askForPostcode(message) {
    note = message;
    postcodeBox?.focus();
  }
</script>

<svelte:head>
  <title>Find a GP</title>
</svelte:head>

<main class="page">
  <a href="/more">← Back</a>

  <h1>Find a GP</h1>
  <p class="muted">
    Search near where you live in term time. Each surgery’s NHS page says whether it’s taking new
    patients and how to register.
  </p>

  <form class="search" onsubmit={searchPostcode}>
    <label for="postcode">Your postcode</label>
    <div class="row">
      <input
        id="postcode"
        class="field"
        bind:this={postcodeBox}
        bind:value={postcode}
        autocomplete="postal-code"
        autocapitalize="characters"
        placeholder="For example NE1 8ST"
      />
      <button class="primary-button" type="submit" disabled={busy !== ''}>
        {busy === 'postcode' ? 'Searching…' : 'Find GPs'}
      </button>
    </div>
  </form>

  <button class="secondary-button location" type="button" onclick={useMyLocation} disabled={busy !== ''}>
    {busy === 'location' ? 'Finding where you are…' : 'Use my location'}
  </button>
  <p class="muted small">
    Your location stays on your phone: it isn’t saved or sent anywhere. A postcode you type is looked up
    on postcodes.io.
  </p>

  {#if note}
    <p class="note" role="alert">{note}</p>
  {/if}

  <div aria-live="polite">
    {#if results}
      {#if results.inArea}
        <h2>Nearest GP surgeries</h2>
        <ol class="results">
          {#each results.practices as practice (practice.code)}
            <li class="card practice">
              <h3>{practice.name}</h3>
              <p>{practice.address}, {practice.postcode}</p>
              <p class="muted">{distanceText(practice.distanceKm)} away in a straight line</p>
              <div class="actions">
                <a
                  class="primary-button"
                  href={practicePageUrl(practice)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${practice.name} on the NHS website (opens in a new tab)`}
                >
                  NHS page ↗
                </a>
                {#if practice.phone}
                  <a class="secondary-button" href={telHref(practice.phone)} aria-label={`Call ${practice.name} on ${practice.phone}`}>
                    Call {practice.phone}
                  </a>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
        <p>
          <a href={findAGpUrl(results.postcode)} target="_blank" rel="noopener noreferrer" aria-label="More surgeries on NHS Find a GP (opens in a new tab)">
            More surgeries on NHS Find a GP ↗
          </a>
        </p>
      {:else}
        <div class="card">
          <p>
            That’s more than {RADIUS_KM} km from Northumbria’s Newcastle city campus, so it’s outside our
            list. NHS Find a GP has every surgery in England.
          </p>
          <a class="primary-button" href={findAGpUrl(results.postcode)} target="_blank" rel="noopener noreferrer" aria-label="NHS Find a GP (opens in a new tab)">
            NHS Find a GP ↗
          </a>
        </div>
      {/if}
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
      href={findADentistUrl(results?.postcode)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="NHS Find a dentist (opens in a new tab)"
    >
      NHS Find a dentist ↗
    </a>
  </section>

  <p class="muted small">
    GP surgeries within {RADIUS_KM} km of Northumbria’s Newcastle city campus, from NHS England’s
    Organisation Data Service (list last changed on {LIST_DATE}). Contains NHS England data, under the
    Open Government Licence. Distances are worked out on your phone.
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .actions a {
    flex: 1 1 140px;
    text-align: center;
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
