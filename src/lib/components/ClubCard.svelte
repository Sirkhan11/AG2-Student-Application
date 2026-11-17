<script>
  import { platformName } from '#lib/societies/display.js';
  import { initials } from '#lib/societies/societies.js';
  import { contactGroups, membershipBlocks } from '#lib/sport/display.js';
  import { loadClubPageOnce } from '#lib/sport/pages.js';

  /**
   * A Northumbria Sport club suggested in the check-in chat, with what a student needs from its page
   * to decide and book without leaving the chat: the first paragraph about it, memberships and
   * training (prices and session times, the first two lines with the rest behind "Show all"), the
   * first two people to contact, socials, Book a membership, and its page in the app (which has the
   * other contacts). The details load from Firestore (sportClubs/{slug}, which needs a signed-in
   * user, as the chat does), once per visit; if they can't, the card shows what the list has, with
   * the links. Gemini never sees any of these details.
   *
   * details can be passed in (the development preview page does, with made-up details); otherwise
   * the card loads them.
   * @type {{ club: import('#lib/sport/clubs.js').Club, details?: import('#lib/sport/pages.js').ClubPage | null }}
   */
  let { club, details: given = undefined } = $props();

  /** How many memberships-and-training lines show before "Show all". */
  const FIRST_LINES = 2;
  /** How many people to contact show on the card; the club's page has the rest. */
  const FIRST_CONTACTS = 2;

  // What the card loaded itself, when no details were passed in.
  /** @type {import('#lib/sport/pages.js').ClubPage | null} */
  let loaded = $state(null);
  let loadStatus = $state(/** @type {'loading' | 'ready' | 'unavailable'} */ ('loading'));
  let pictureFailed = $state(false);
  let showAll = $state(false);

  // Details passed in are used straight away (also when the page is rendered on the server).
  let details = $derived(given !== undefined ? given : loaded);
  let status = $derived(given !== undefined ? (given ? 'ready' : 'unavailable') : loadStatus);

  let blocks = $derived(details ? membershipBlocks(details.membership) : []);
  let shownBlocks = $derived(showAll ? blocks : blocks.slice(0, FIRST_LINES));
  let contacts = $derived(details ? contactGroups(details.contacts).flatMap((group) => group.buttons).slice(0, FIRST_CONTACTS) : []);

  $effect(() => {
    if (given !== undefined) return;
    let stopped = false;
    loadStatus = 'loading';
    loadClubPageOnce(club.slug)
      .then((found) => {
        if (stopped) return;
        loaded = found;
        loadStatus = found ? 'ready' : 'unavailable';
      })
      .catch((err) => {
        console.error(err);
        if (!stopped) loadStatus = 'unavailable';
      });
    return () => {
      stopped = true;
    };
  });
</script>

<article class="club-card" aria-label={club.name}>
  <div class="top">
    {#if club.image && !pictureFailed}
      <!-- alt="" because the name is right next to it. Pictures stay on Northumbria Sport's site. -->
      <img class="picture" src={club.image} alt="" width="48" height="48" loading="lazy" onerror={() => (pictureFailed = true)} />
    {:else}
      <span class="picture initials" aria-hidden="true">{initials(club.name)}</span>
    {/if}
    <div class="titles">
      <h3>{club.name}</h3>
      <p class="muted">Northumbria Sport club</p>
    </div>
  </div>

  {#if status === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if details}
    {#if details.about.length}
      <p class="about">{details.about[0]}</p>
    {/if}
    {#if blocks.length}
      <div class="training">
        <p class="label">Memberships and training</p>
        {#each shownBlocks as block, i (i)}
          {#if block.text}<p class="line">{block.text}</p>{/if}
          {#if block.items.length}
            <ul>
              {#each block.items as item, j (j)}
                <li>{item}</li>
              {/each}
            </ul>
          {/if}
        {/each}
        {#if blocks.length > FIRST_LINES}
          <button class="show-all" type="button" aria-expanded={showAll} onclick={() => (showAll = !showAll)}>
            {showAll ? 'Show less' : `Show all ${blocks.length}`}
          </button>
        {/if}
      </div>
    {/if}
    {#if contacts.length || details.socials.length}
      <div class="chips">
        {#each contacts as contact, i (i)}
          <a class="chip" href={`mailto:${contact.email}`}>
            {contact.label}{#if contact.name}<span class="who">&nbsp;({contact.name})</span>{/if}
          </a>
        {/each}
        {#each details.socials as social, i (i)}
          <a
            class="chip"
            href={social.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${club.name} on ${platformName(social.platform)} (opens in a new tab)`}
          >
            {platformName(social.platform)} ↗
          </a>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="actions">
    {#if details?.bookUrl}
      <a
        class="book"
        href={details.bookUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Book a ${club.name} membership on Northumbria Sport’s booking site (opens in a new tab)`}
      >
        Book a membership ↗
      </a>
    {/if}
    <a class="more" href={`/sport/${club.slug}`}>More about this club</a>
  </div>
</article>

<style>
  .club-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: #fff;
    color: #172630;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .picture {
    flex: none;
    width: 48px;
    height: 48px;
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
  }

  .titles {
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  .titles p,
  .about,
  .label,
  .line {
    margin: 0;
  }

  /* The first paragraph, cut to three lines: the rest is on the club's page. */
  .about {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    font-size: 14px;
  }

  .training {
    font-size: 14px;
  }

  .label {
    font-weight: bold;
  }

  .line {
    margin-top: 4px;
  }

  .training ul {
    margin: 2px 0 0;
    padding-left: 18px;
  }

  .show-all {
    margin-top: 4px;
    padding: 6px 0;
    border: 0;
    background: none;
    color: var(--primary);
    font-size: 14px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: #f1f6f9;
    font-size: 14px;
  }

  .who {
    color: #647780;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .book,
  .more {
    flex: 1 1 140px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 14px;
    text-align: center;
  }

  .book {
    background: var(--primary);
    color: #fff;
    font-weight: bold;
  }

  .more {
    border: 1px solid var(--border);
    background: #fff;
  }
</style>
