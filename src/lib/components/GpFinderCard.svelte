<script>
  import { untrack } from 'svelte';
  import { dentistPageUrl } from '#lib/dentists/england.js';
  import { DENTIST_NATIONS, DENTIST_WORDS, nearestDentists } from '#lib/dentists/finder.js';
  import { distanceText, findADentistUrl, findAGpUrl, OTHER_NATIONS, practicePageUrl } from '#lib/gp/finder.js';
  import { GpSearch } from '#lib/gp/search.svelte.js';

  /**
   * The GP or dentist finder inside the check-in chat, when Gemini shows it (its show_finder tool,
   * chat-tools.js): the student types a postcode, district or place here, in the app's own card, so it
   * never goes to Gemini (the chat's messages blank postcodes too), or taps Use my location, which stays
   * on the phone. The same search as the finder page's GP and Dentist tabs (search.svelte.js), showing
   * the nearest few, each with its NHS page.
   * @type {{ kind?: 'gp' | 'dentist' }}
   */
  let { kind = 'gp' } = $props();

  /** How many the card shows: the full list is on the finder page. */
  const SHOWN = 3;
  const htmlId = $props.id();
  let query = $state('');
  /** @type {HTMLInputElement | undefined} */
  let box = $state();
  // A card is a GP one or a dentist one for good (the chat makes a new card for the other), so only
  // the kind it starts with counts.
  const dentist = untrack(() => kind === 'dentist');
  const finder = new GpSearch({ needsTyping: () => box?.focus(), ...(dentist ? { nearest: nearestDentists, words: DENTIST_WORDS } : {}) });
  const nations = dentist ? DENTIST_NATIONS : OTHER_NATIONS;
  /** @param {import('#lib/gp/finder.js').NearbyPractice} practice */
  const pageOf = (practice) => (dentist ? dentistPageUrl(practice) : practicePageUrl(practice));

  /** @param {SubmitEvent} event */
  function search(event) {
    event.preventDefault();
    void finder.search(query);
  }
</script>

<div class="finder-card" role="group" aria-label={dentist ? 'Find a dentist near you' : 'Find a GP near you'}>
  <form onsubmit={search}>
    <label for={`${htmlId}-search`}>Your postcode, district or place</label>
    <div class="row">
      <input id={`${htmlId}-search`} class="field" bind:this={box} bind:value={query} autocomplete="postal-code" placeholder="NE1 8ST, NE6 or Heaton" />
      <button class="primary-button" type="submit" disabled={finder.busy !== ''}>{finder.busy === 'search' ? 'Searching…' : 'Find'}</button>
    </div>
  </form>
  <button class="secondary-button" type="button" onclick={() => finder.useMyLocation()} disabled={finder.busy !== ''}>
    {finder.busy === 'location' ? 'Finding where you are…' : 'Use my location'}
  </button>
  <p class="muted small">This stays in the app: it’s never sent to Gemini. Your location stays on your phone, and a postcode or place is looked up on postcodes.io.</p>

  <div aria-live="polite">
    {#if finder.note}
      <p role="alert">{finder.note}</p>
    {/if}
    {#if finder.choices}
      <p>Which {finder.choices[0].label}?</p>
      <div class="choices">
        {#each finder.choices.slice(0, 5) as place (`${place.label}|${place.county}`)}
          <button class="secondary-button" type="button" onclick={() => finder.choose(place)}>{place.label}, {place.county}</button>
        {/each}
      </div>
    {/if}
    {#if finder.nation}
      <p>That’s in {finder.nation}, so use its own {dentist ? 'way to find a dentist' : 'GP finder'}:</p>
      <a class="secondary-button" href={nations[finder.nation].href} target="_blank" rel="noopener noreferrer" aria-label={`${nations[finder.nation].label} (opens in a new tab)`}>{nations[finder.nation].label} ↗</a>
    {/if}
    {#if finder.results}
      <p class="heading">{dentist ? 'Nearest NHS dentists' : 'Nearest GP surgeries'} to {finder.results.label}</p>
      <ol>
        {#each finder.results.practices.slice(0, SHOWN) as practice (practice.code)}
          <li>
            <strong>{practice.name}</strong>
            <span class="muted">{distanceText(practice.distanceKm)} away</span>
            {#if dentist}
              <a href={pageOf(practice)} target="_blank" rel="noopener noreferrer" aria-label={`Whether ${practice.name} is taking new NHS patients, on the NHS website (opens in a new tab)`}>New NHS patients? ↗</a>
            {:else}
              <a href={pageOf(practice)} target="_blank" rel="noopener noreferrer" aria-label={`${practice.name} on the NHS website: registering and new patients (opens in a new tab)`}>NHS page: register ↗</a>
            {/if}
          </li>
        {/each}
      </ol>
      <div class="more">
        {#if dentist}
          <a href="/gp-finder?tab=dentist">More on the dentist finder</a>
          <a href={findADentistUrl(finder.results.nhsSearch)} target="_blank" rel="noopener noreferrer" aria-label="NHS Find a dentist (opens in a new tab)">NHS Find a dentist ↗</a>
        {:else}
          <a href="/gp-finder">More on the GP finder</a>
          <a href={findAGpUrl(finder.results.nhsSearch)} target="_blank" rel="noopener noreferrer" aria-label="NHS Find a GP (opens in a new tab)">NHS Find a GP ↗</a>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .finder-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-1);
    background: #fff;
    color: var(--ink);
  }

  .finder-card p {
    margin: 0;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  /* The box takes the room and Find stays its own size (the shared .field and .primary-button are
     full width, which squeezed the box to a sliver). */
  .row {
    align-items: stretch;
  }

  .row input {
    flex: 1;
    min-width: 0;
    margin: 0;
  }

  .row .primary-button {
    flex: none;
    width: auto;
    padding: 10px 18px;
  }

  .small {
    font-size: 14px;
  }

  .heading {
    font-weight: bold;
  }

  ol {
    margin: 0;
    padding-left: 20px;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  li + li {
    margin-top: 8px;
  }

  .choices,
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
