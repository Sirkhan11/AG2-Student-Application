<script>
  import { classifySearch, distanceText, findADentistUrl, findAGpUrl, OTHER_NATIONS, practicePageUrl } from '#lib/gp/finder.js';
  import { GpSearch } from '#lib/gp/search.svelte.js';

  /**
   * The GP finder inside the check-in chat, while going through the checklist (checklist-talk.js):
   * the student types a postcode, district or place here, in the app's own card, so it never goes to
   * Gemini (the chat's messages blank postcodes too). For a GP, the nearest surgeries, the same search
   * as the GP finder page (search.svelte.js: "Use my location" stays on the phone); for a dentist,
   * NHS Find a dentist for that postcode or district, as the NHS lists dentists.
   * @type {{ kind?: 'gp' | 'dentist' }}
   */
  let { kind = 'gp' } = $props();

  /** How many surgeries the card shows: the full list is on the GP finder page. */
  const SHOWN = 3;
  const htmlId = $props.id();
  let query = $state('');
  /** @type {HTMLInputElement | undefined} */
  let box = $state();
  const finder = new GpSearch({ needsTyping: () => box?.focus() });
  /** The dentist search: NHS Find a dentist for what they typed, or a note. */
  let dentist = $state(/** @type {{ href: string, label: string } | null} */ (null));
  let dentistNote = $state('');

  /** @param {SubmitEvent} event */
  function search(event) {
    event.preventDefault();
    if (kind === 'gp') {
      void finder.search(query);
      return;
    }
    const wanted = classifySearch(query);
    dentist = null;
    dentistNote = '';
    if (wanted.kind === 'postcode' || wanted.kind === 'district') dentist = { href: findADentistUrl(wanted.value), label: wanted.value };
    else dentistNote = 'Type a postcode (NE1 8ST) or a postcode district (NE6).';
  }
</script>

<div class="finder-card" role="group" aria-label={kind === 'gp' ? 'Find a GP near you' : 'Find a dentist near you'}>
  <form onsubmit={search}>
    <label for={`${htmlId}-search`}>{kind === 'gp' ? 'Your postcode, district or place' : 'Your postcode or district'}</label>
    <div class="row">
      <input id={`${htmlId}-search`} class="field" bind:this={box} bind:value={query} autocomplete="postal-code" placeholder={kind === 'gp' ? 'NE1 8ST, NE6 or Heaton' : 'NE1 8ST or NE6'} />
      <button class="primary-button" type="submit" disabled={finder.busy !== ''}>{finder.busy === 'search' ? 'Searching…' : 'Find'}</button>
    </div>
  </form>
  {#if kind === 'gp'}
    <button class="secondary-button" type="button" onclick={() => finder.useMyLocation()} disabled={finder.busy !== ''}>
      {finder.busy === 'location' ? 'Finding where you are…' : 'Use my location'}
    </button>
  {/if}
  <p class="muted small">This stays in the app: it’s never sent to Gemini. {kind === 'gp' ? 'Your location stays on your phone, and a postcode or place is looked up on postcodes.io.' : 'It’s only used to open NHS Find a dentist.'}</p>

  <div aria-live="polite">
    {#if kind === 'gp'}
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
        <p>That’s in {finder.nation}, so use its own GP finder:</p>
        <a class="secondary-button" href={OTHER_NATIONS[finder.nation].href} target="_blank" rel="noopener noreferrer" aria-label={`${OTHER_NATIONS[finder.nation].label} (opens in a new tab)`}>{OTHER_NATIONS[finder.nation].label} ↗</a>
      {/if}
      {#if finder.results}
        <p class="heading">Nearest GP surgeries to {finder.results.label}</p>
        <ol>
          {#each finder.results.practices.slice(0, SHOWN) as practice (practice.code)}
            <li>
              <strong>{practice.name}</strong>
              <span class="muted">{distanceText(practice.distanceKm)} away</span>
              <a href={practicePageUrl(practice)} target="_blank" rel="noopener noreferrer" aria-label={`${practice.name} on the NHS website: registering and new patients (opens in a new tab)`}>NHS page: register ↗</a>
            </li>
          {/each}
        </ol>
        <div class="more">
          <a href="/gp-finder">More on the GP finder</a>
          <a href={findAGpUrl(finder.results.nhsSearch)} target="_blank" rel="noopener noreferrer" aria-label="NHS Find a GP (opens in a new tab)">NHS Find a GP ↗</a>
        </div>
      {/if}
    {:else}
      {#if dentistNote}
        <p role="alert">{dentistNote}</p>
      {/if}
      {#if dentist}
        <a class="primary-button" href={dentist.href} target="_blank" rel="noopener noreferrer" aria-label={`NHS Find a dentist near ${dentist.label} (opens in a new tab)`}>NHS Find a dentist near {dentist.label} ↗</a>
      {/if}
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

  .row input {
    flex: 1;
    min-width: 0;
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
