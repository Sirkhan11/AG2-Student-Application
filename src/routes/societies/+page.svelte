<script>
  import { page } from '$app/state';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import ClubsSwitch from '#lib/components/ClubsSwitch.svelte';
  import {
    AUDIENCE,
    AUDIENCE_LABELS,
    CAMPUSES,
    CATEGORIES,
    COLLECTED_AT,
    initials,
    searchSocieties,
    SOCIETIES,
    SOURCE_URL
  } from '#lib/societies/societies.js';

  // The Students' Union's real list (src/lib/societies/nsu-societies.json). Each card opens the
  // society's page in the app, /societies/[nsuId], which has the details from NSU.
  let search = $state('');
  let campus = $state('Newcastle');
  // A link can start the page on one category, such as /societies?category=Recreational%20Sport.
  let category = $state(CATEGORIES.includes(page.url.searchParams.get('category') ?? '') ? /** @type {string} */ (page.url.searchParams.get('category')) : 'all');

  let results = $derived(searchSocieties(search, campus, category));
  let campusTotal = $derived(SOCIETIES.filter((society) => society.campus === campus).length);

  // Pictures that failed to load, so those cards show initials instead of a broken image.
  let failedPictures = $state(/** @type {number[]} */ ([]));

  // When the list file last changed: a refresh that finds no changes leaves the file, and this date, alone.
  const changed = new Date(COLLECTED_AT).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
</script>

<main class="page">
  <h1>Societies</h1>
  <ClubsSwitch current="societies" />
  <p class="muted">
    Northumbria Students’ Union has {campusTotal} societies at the {campus} campus. Search or choose a
    category, then open a society to find out more and how to join.
  </p>

  {#if CAMPUSES.length > 1}
    <fieldset class="campus">
      <legend>Campus</legend>
      {#each CAMPUSES as name (name)}
        <label>
          <input type="radio" name="campus" value={name} bind:group={campus} />
          {name}
        </label>
      {/each}
    </fieldset>
  {/if}

  <label for="society-category">Category</label>
  <select id="society-category" class="field" bind:value={category}>
    <option value="all">All categories</option>
    {#each CATEGORIES as name (name)}
      <option value={name}>{name}</option>
    {/each}
  </select>

  <label for="society-search">Search societies</label>
  <input
    id="society-search"
    class="field"
    placeholder="For example, climbing or sport"
    autocomplete="off"
    bind:value={search}
  />

  <p class="muted" role="status">
    {results.length === campusTotal ? `Showing all ${campusTotal}` : `${results.length} of ${campusTotal} match`}
  </p>

  {#if results.length === 0}
    <p>No societies match. Try a shorter word, another category, or the other campus.</p>
  {/if}

  <ul class="societies">
    {#each results as society (society.nsuId)}
      <li>
        <a class="card society" href={`/societies/${society.nsuId}`}>
          {#if society.image && !failedPictures.includes(society.nsuId)}
            <!-- alt="" because the name is right next to it. Pictures stay on NSU's image host. -->
            <img
              class="picture"
              src={society.image}
              alt=""
              loading="lazy"
              width="56"
              height="56"
              onerror={() => (failedPictures = [...failedPictures, society.nsuId])}
            />
          {:else}
            <span class="picture initials" aria-hidden="true">{initials(society.name)}</span>
          {/if}
          <span class="text">
            <span class="name">{society.name}</span>
            <span class="muted">
              {society.category ?? 'Society'}{#if AUDIENCE[society.nsuId]}{' '}· {AUDIENCE_LABELS[AUDIENCE[society.nsuId]]}{/if}
            </span>
          </span>
        </a>
      </li>
    {/each}
  </ul>

  <p class="muted">
    List from the NSU website, last changed on {changed}. NSU’s own list may be newer:
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">See the latest list on the NSU website ↗</a>
  </p>

  <BottomNav />
</main>

<style>
  .campus {
    display: flex;
    gap: 20px;
    margin: 0 0 16px;
    padding: 0;
    border: 0;
  }

  .campus legend {
    margin-bottom: 8px;
    font-weight: bold;
  }

  .campus label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }

  .societies {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .society {
    display: flex;
    align-items: center;
    gap: 14px;
    color: inherit;
  }

  .picture {
    flex: none;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-s);
    object-fit: cover;
    background: var(--violet-soft);
  }

  .initials {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    font-weight: bold;
    font-size: 18px;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-weight: bold;
    overflow-wrap: anywhere;
  }
</style>
