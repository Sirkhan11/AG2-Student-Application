<script>
  import { platformName, priceText } from '#lib/societies/display.js';
  import { loadSocietyPageOnce } from '#lib/societies/pages.js';
  import { initials } from '#lib/societies/societies.js';

  /**
   * A society suggested in the check-in chat, with what a student needs from its NSU page so they
   * don't have to go looking: the first paragraph about it, membership prices, ways to get in touch,
   * how to join, and its page in the app. The details load from Firestore (societies/{nsuId}, which
   * needs a signed-in user, as the chat does); if they can't, the card shows what the list has, with
   * the NSU and app buttons. Gemini never sees any of these details.
   *
   * details can be passed in (the development preview page does, with made-up details); otherwise
   * the card loads them, once per visit.
   * @type {{ society: import('#lib/societies/societies.js').Society,
   *   details?: import('#lib/societies/pages.js').SocietyPage | null }}
   */
  let { society, details: given = undefined } = $props();

  // What the card loaded itself, when no details were passed in.
  /** @type {import('#lib/societies/pages.js').SocietyPage | null} */
  let loaded = $state(null);
  let loadStatus = $state(/** @type {'loading' | 'ready' | 'unavailable'} */ ('loading'));
  let pictureFailed = $state(false);

  // Details passed in are used straight away (also when the page is rendered on the server).
  let details = $derived(given !== undefined ? given : loaded);
  // 'loading', then 'ready', or 'unavailable' (not imported yet, or it couldn't load).
  let status = $derived(given !== undefined ? (given ? 'ready' : 'unavailable') : loadStatus);

  $effect(() => {
    if (given !== undefined) return;
    let stopped = false;
    loadStatus = 'loading';
    loadSocietyPageOnce(society.nsuId)
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

<article class="society-card" aria-label={society.name}>
  <div class="top">
    {#if society.image && !pictureFailed}
      <!-- alt="" because the name is right next to it. Pictures stay on NSU's image host. -->
      <img class="picture" src={society.image} alt="" width="48" height="48" loading="lazy" onerror={() => (pictureFailed = true)} />
    {:else}
      <span class="picture initials" aria-hidden="true">{initials(society.name)}</span>
    {/if}
    <div class="titles">
      <h3>{society.name}</h3>
      <p class="muted">{society.category ?? 'Society'}</p>
    </div>
  </div>

  {#if status === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if details}
    {#if details.description.length}
      <p class="about">{details.description[0]}</p>
    {/if}
    {#if details.memberships.length}
      <ul class="prices" aria-label="Membership prices">
        {#each details.memberships as membership, i (i)}
          <li><span>{membership.name}</span> <strong>{priceText(membership.price)}</strong></li>
        {/each}
      </ul>
    {/if}
    {#if details.email || details.socials.length}
      <div class="chips">
        {#if details.email}
          <a class="chip" href={`mailto:${details.email}`}>Email the society</a>
        {/if}
        {#each details.socials as social, i (i)}
          <a
            class="chip"
            href={social.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${society.name} on ${platformName(social.platform)} (opens in a new tab)`}
          >
            {platformName(social.platform)} ↗
          </a>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="actions">
    <a
      class="join"
      href={society.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Join ${society.name} on the NSU website (opens in a new tab)`}
    >
      Join on the NSU website ↗
    </a>
    <a class="more" href={`/societies/${society.nsuId}`}>More about this society</a>
  </div>
</article>

<style>
  .society-card {
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

  .top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .picture {
    flex: none;
    width: 48px;
    height: 48px;
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
  .about {
    margin: 0;
  }

  /* The first paragraph, cut to three lines: the rest is on the society's page. */
  .about {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    font-size: 14px;
  }

  .prices {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
  }

  .prices li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
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
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    background: var(--panel);
    font-size: 14px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .join,
  .more {
    flex: 1 1 140px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: var(--radius-s);
    font-size: 14px;
    text-align: center;
  }

  .join {
    background: var(--primary);
    color: #fff;
    font-weight: bold;
  }

  .more {
    border: 1px solid var(--line);
    background: #fff;
  }
</style>
