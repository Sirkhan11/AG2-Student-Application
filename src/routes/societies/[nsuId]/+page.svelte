<script>
  import BottomNav from '$lib/components/BottomNav.svelte';
  import { watchSignedIn } from '#lib/firebase/auth.js';
  import { loginPathFor } from '#lib/next-path.js';
  import { loadSocietyPage } from '#lib/societies/pages.js';
  import { AUDIENCE, AUDIENCE_LABELS, COLLECTED_AT, initials } from '#lib/societies/societies.js';

  /** @type {{ data: import('./$types').PageData }} */
  let { data } = $props();
  let society = $derived(data.society);

  /**
   * What's showing below the society's name:
   * - 'loading'; 'signed-out' and 'missing' (not imported yet) show only what the list has;
   *   'error'; 'ready' shows the details from NSU
   * @typedef {'loading' | 'signed-out' | 'missing' | 'error' | 'ready'} View
   */
  let view = $state(/** @type {View} */ ('loading'));
  let details = $state(/** @type {import('#lib/societies/pages.js').SocietyPage | null} */ (null));
  let pictureFailed = $state(false);

  // Loads the details for this society, again whenever someone signs in or out, or the page moves
  // to another society. The details need a signed-in user (firestore.rules).
  $effect(() => {
    const nsuId = society.nsuId;
    details = null;
    view = 'loading';
    pictureFailed = false;
    return watchSignedIn(async (signedIn) => {
      if (!signedIn) {
        view = 'signed-out';
        return;
      }
      try {
        details = await loadSocietyPage(nsuId);
        view = details ? 'ready' : 'missing';
      } catch (err) {
        console.error(err);
        view = 'error';
      }
    });
  });

  // Every society's events are its NSU page plus "#events" (true for all 154 when collected), so
  // the button works even before the details load.
  let eventsUrl = $derived(details?.eventsUrl ?? `${society.url}#events`);

  /** How each social platform is named on its button. */
  const PLATFORMS = /** @type {Record<string, string>} */ ({
    instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok', youtube: 'YouTube',
    discord: 'Discord', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', spotify: 'Spotify', twitch: 'Twitch'
  });
  /** @param {string} platform */
  const platformName = (platform) => PLATFORMS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);

  const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  /** @param {number} price */
  const priceText = (price) => (price === 0 ? 'Free' : pounds.format(price));
  /** @param {string} iso */
  const dayText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  /**
   * A committee entry as text. NSU's Committee tab was empty for every society when collected, so
   * the shape isn't known yet: plain text, or { role, name }.
   * @param {unknown} member
   */
  function committeeText(member) {
    if (typeof member === 'string') return member;
    const { role, name } = /** @type {{ role?: unknown, name?: unknown }} */ (member ?? {});
    if (typeof name !== 'string') return '';
    return typeof role === 'string' ? `${role}: ${name}` : name;
  }
</script>

<main class="page">
  <p><a href="/societies">← All societies</a></p>

  <div class="header">
    {#if society.image && !pictureFailed}
      <!-- alt="" because the name is right next to it. The picture stays on NSU's image host. -->
      <img class="picture" src={society.image} alt="" width="88" height="88" onerror={() => (pictureFailed = true)} />
    {:else}
      <span class="picture initials" aria-hidden="true">{initials(society.name)}</span>
    {/if}
    <div>
      <h1>{society.name}</h1>
      <p class="muted">
        {society.category ?? 'Society'} · {society.campus} campus{#if AUDIENCE[society.nsuId]} · {AUDIENCE_LABELS[AUDIENCE[society.nsuId]]}{/if}
      </p>
    </div>
  </div>

  {#if view === 'loading'}
    <p class="muted" role="status">Loading…</p>
  {:else if view === 'signed-out'}
    <p class="muted">
      <a href={loginPathFor(`/societies/${society.nsuId}`)}>Log in</a> to see more about this society, or
      find out more on the NSU website.
    </p>
  {:else if view === 'missing'}
    <p class="muted">More about this society isn’t available here yet. The NSU website has the latest.</p>
  {:else if view === 'error'}
    <p class="error" role="alert">We couldn’t load more about this society. The NSU website has the latest.</p>
  {:else if details}
    {#if details.description.length}
      <section>
        <h2>About</h2>
        <!-- Plain text only, never {@html}: this came from another website. -->
        {#each details.description as paragraph, i (i)}
          <p>{paragraph}</p>
        {/each}
      </section>
    {/if}

    {#if details.memberships.length}
      <section>
        <h2>Membership</h2>
        <ul class="memberships">
          {#each details.memberships as membership, i (i)}
            <li><span>{membership.name}</span> <strong>{priceText(membership.price)}</strong></li>
          {/each}
        </ul>
        {#if details.collectedAt}
          <p class="muted">Prices from NSU on {dayText(details.collectedAt)}.</p>
        {/if}
      </section>
    {/if}

    {#if details.email || details.socials.length}
      <section>
        <h2>Get in touch</h2>
        <div class="buttons">
          {#if details.email}
            <a class="secondary-button" href={`mailto:${details.email}`}>Email the society</a>
          {/if}
          {#each details.socials as social, i (i)}
            <a
              class="secondary-button"
              href={social.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${society.name} on ${platformName(social.platform)} (opens in a new tab)`}
            >
              {platformName(social.platform)} ↗
            </a>
          {/each}
        </div>
      </section>
    {/if}

    {#if details.committee.length}
      <section>
        <h2>Committee</h2>
        <ul>
          {#each details.committee as member, i (i)}
            {#if committeeText(member)}
              <li>{committeeText(member)}</li>
            {/if}
          {/each}
        </ul>
      </section>
    {/if}
  {/if}

  <div class="actions">
    <a class="primary-button" href={society.url} target="_blank" rel="noopener noreferrer" aria-label="Join on the NSU website (opens in a new tab)">
      Join on the NSU website ↗
    </a>
    <a class="secondary-button" href={eventsUrl} target="_blank" rel="noopener noreferrer" aria-label="See their events on the NSU website (opens in a new tab)">
      See their events ↗
    </a>
  </div>

  <!-- The page's own date when its details loaded; otherwise the list's, which only changes when the list does. -->
  {#if details?.collectedAt}
    <p class="muted">Info from Northumbria Students’ Union, checked {dayText(details.collectedAt)}.</p>
  {:else}
    <p class="muted">Info from Northumbria Students’ Union’s list, last changed {dayText(COLLECTED_AT)}.</p>
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
    border-radius: 14px;
    object-fit: cover;
    background: #eaf2f8;
  }

  .initials {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    font-weight: bold;
    font-size: 28px;
  }

  section p {
    overflow-wrap: anywhere;
  }

  .memberships {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .memberships li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .buttons a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
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
