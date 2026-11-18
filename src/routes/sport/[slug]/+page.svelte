<script>
  import BottomNav from '#lib/components/BottomNav.svelte';
  import ClubDetails from '#lib/components/ClubDetails.svelte';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { loginPathFor } from '#lib/next-path.js';
  import { CLUBS_COLLECTED_AT } from '#lib/sport/clubs.js';
  import { loadClubPage } from '#lib/sport/pages.js';
  import { initials } from '#lib/societies/societies.js';

  /** @type {{ data: import('./$types').PageData }} */
  let { data } = $props();
  let club = $derived(data.club);

  /**
   * What's showing below the club's name:
   * - 'loading'; 'signed-out' and 'missing' (not imported yet) show only what the list has;
   *   'error'; 'ready' shows the details from Northumbria Sport
   * @typedef {'loading' | 'signed-out' | 'missing' | 'error' | 'ready'} View
   */
  let view = $state(/** @type {View} */ ('loading'));
  let details = $state(/** @type {import('#lib/sport/pages.js').ClubPage | null} */ (null));
  let pictureFailed = $state(false);

  // Loads the details for this club, again whenever someone signs in or out, or the page moves to
  // another club. The details need a signed-in user (firestore.rules): the contacts are people's.
  $effect(() => {
    const slug = club.slug;
    details = null;
    view = 'loading';
    pictureFailed = false;
    return watchSignedIn(async (signedIn) => {
      if (!signedIn) {
        view = 'signed-out';
        return;
      }
      try {
        details = await loadClubPage(slug);
        view = details ? 'ready' : 'missing';
      } catch (err) {
        console.error(err);
        view = 'error';
      }
    });
  });

  /** @param {string} iso */
  const dayText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<main class="page">
  <p><a href="/sport">← All sport clubs</a></p>

  <div class="header">
    {#if club.image && !pictureFailed}
      <!-- alt="" because the name is right next to it. The picture stays on Northumbria Sport's site. -->
      <img class="picture" src={club.image} alt="" width="88" height="88" onerror={() => (pictureFailed = true)} />
    {:else}
      <span class="picture initials" aria-hidden="true">{initials(club.name)}</span>
    {/if}
    <div>
      <h1>{club.name}</h1>
      <p class="muted">Northumbria Sport club · Newcastle campus</p>
    </div>
  </div>

  {#if view === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if view === 'signed-out'}
    <p class="muted">
      <a href={loginPathFor(`/sport/${club.slug}`)}>Log in</a> to see this club’s memberships, training times
      and who to contact, or find out more on Northumbria Sport’s website.
    </p>
  {:else if view === 'missing'}
    <p class="muted">More about this club isn’t available here yet. Northumbria Sport’s website has the latest.</p>
  {:else if view === 'error'}
    <p class="error" role="alert">We couldn’t load more about this club. Northumbria Sport’s website has the latest.</p>
  {:else if details}
    <ClubDetails {club} {details} />
  {/if}

  <div class="actions">
    {#if details?.bookUrl}
      <a class="primary-button" href={details.bookUrl} target="_blank" rel="noopener noreferrer" aria-label="Book a membership on Northumbria Sport’s booking site (opens in a new tab)">
        Book a membership ↗
      </a>
    {/if}
    <a class="secondary-button" href={club.url} target="_blank" rel="noopener noreferrer" aria-label="See the club on northumbriasport.com (opens in a new tab)">
      See the club on northumbriasport.com ↗
    </a>
  </div>

  <!-- The details' own date when they loaded; otherwise the list's, which only changes when the list does. -->
  {#if details?.collectedAt}
    <p class="muted">Info from Northumbria Sport, checked {dayText(details.collectedAt)}.</p>
  {:else}
    <p class="muted">Info from Northumbria Sport’s list, last changed {dayText(CLUBS_COLLECTED_AT)}.</p>
  {/if}

  <BottomNav />
</main>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .header h1 {
    margin: 0 0 4px;
    overflow-wrap: anywhere;
  }

  .header p {
    margin: 0;
  }

  .picture {
    flex: none;
    width: 88px;
    height: 88px;
    border-radius: var(--radius-m);
    object-fit: cover;
    background: var(--violet-soft);
  }

  .initials {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    font-weight: bold;
    font-size: 28px;
  }

  .actions {
    display: grid;
    gap: 12px;
    margin: 24px 0 12px;
  }

  .actions .secondary-button {
    text-align: center;
    padding: 12px;
  }
</style>
