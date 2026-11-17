<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import ClubsSwitch from '#lib/components/ClubsSwitch.svelte';
  import { CLUBS, CLUBS_COLLECTED_AT, CLUBS_SOURCE, searchClubs } from '#lib/sport/clubs.js';
  import { initials } from '#lib/societies/societies.js';

  // Northumbria Sport's student sports clubs (src/lib/sport/sport-clubs.json), all at the Newcastle
  // campus. Each card opens the club's page in the app, /sport/[slug], with its details.
  let search = $state('');
  let results = $derived(searchClubs(search));

  // Pictures that failed to load, so those cards show initials instead of a broken image.
  let failedPictures = $state(/** @type {string[]} */ ([]));

  // When the list file last changed: a refresh that finds no changes leaves the file, and this date, alone.
  const changed = new Date(CLUBS_COLLECTED_AT).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
</script>

<main class="page">
  <h1>Sport clubs</h1>
  <ClubsSwitch current="sport" />
  <p class="muted">
    Northumbria Sport runs {CLUBS.length} student sports clubs at the Newcastle campus. Search, then open a
    club to see its memberships, training times and how to join.
  </p>

  <label for="club-search">Search clubs</label>
  <input id="club-search" class="field" placeholder="For example, swimming or football" autocomplete="off" bind:value={search} />

  <p class="muted" role="status">
    {results.length === CLUBS.length ? `Showing all ${CLUBS.length}` : `${results.length} of ${CLUBS.length} match`}
  </p>

  {#if results.length === 0}
    <p>No clubs match. Try a shorter word.</p>
  {/if}

  <ul class="clubs">
    {#each results as club (club.slug)}
      <li>
        <a class="card club" href={`/sport/${club.slug}`}>
          {#if club.image && !failedPictures.includes(club.slug)}
            <!-- alt="" because the name is right next to it. Pictures stay on Northumbria Sport's site. -->
            <img
              class="picture"
              src={club.image}
              alt=""
              loading="lazy"
              width="56"
              height="56"
              onerror={() => (failedPictures = [...failedPictures, club.slug])}
            />
          {:else}
            <span class="picture initials" aria-hidden="true">{initials(club.name)}</span>
          {/if}
          <span class="text">
            <span class="name">{club.name}</span>
            <span class="muted">Northumbria Sport club</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>

  <p class="muted">
    List from Northumbria Sport’s website, last changed on {changed}. Their own list may be newer:
    <a href={CLUBS_SOURCE} target="_blank" rel="noopener noreferrer">See the clubs on northumbriasport.com ↗</a>
  </p>

  <BottomNav />
</main>

<style>
  .clubs {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .club {
    display: flex;
    align-items: center;
    gap: 14px;
    color: inherit;
  }

  .picture {
    flex: none;
    width: 56px;
    height: 56px;
    border-radius: 10px;
    object-fit: cover;
    background: #eaf2f8;
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
