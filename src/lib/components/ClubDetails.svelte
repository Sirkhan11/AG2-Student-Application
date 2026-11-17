<script>
  import { platformName } from '#lib/societies/display.js';
  import { contactGroups, membershipBlocks } from '#lib/sport/display.js';

  /**
   * A sports club's details from Northumbria Sport: about, memberships and training (prices and
   * session times), who to contact, and socials. Used by the club page; the development preview
   * page passes made-up details. Plain text only, never {@html}: it came from another website.
   * @type {{ club: import('#lib/sport/clubs.js').Club, details: import('#lib/sport/pages.js').ClubPage }}
   */
  let { club, details } = $props();

  let blocks = $derived(membershipBlocks(details.membership));
  let groups = $derived(contactGroups(details.contacts));

  /** @param {string} iso */
  const dayText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

{#if details.about.length}
  <section>
    <h2>About</h2>
    {#each details.about as paragraph, i (i)}
      <p>{paragraph}</p>
    {/each}
  </section>
{/if}

{#if blocks.length}
  <section>
    <h2>Memberships and training</h2>
    {#each blocks as block, i (i)}
      {#if block.text}<p class="line">{block.text}</p>{/if}
      {#if block.items.length}
        <ul class="sessions">
          {#each block.items as item, j (j)}
            <li>{item}</li>
          {/each}
        </ul>
      {/if}
    {/each}
    {#if details.collectedAt}
      <p class="muted">Prices and times from Northumbria Sport on {dayText(details.collectedAt)}.</p>
    {/if}
  </section>
{/if}

{#if groups.length || details.socials.length}
  <section>
    <h2>Get in touch</h2>
    {#each groups as group, i (i)}
      {#if group.note}<p class="note">{group.note}</p>{/if}
      <div class="buttons">
        {#each group.buttons as button, j (j)}
          <a class="secondary-button contact" href={`mailto:${button.email}`}>
            <span>{button.label}</span>
            {#if button.name}<span class="who">{button.name}</span>{/if}
          </a>
        {/each}
      </div>
    {/each}
    {#if details.socials.length}
      <div class="buttons socials">
        {#each details.socials as social, i (i)}
          <a
            class="secondary-button"
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
  </section>
{/if}

<style>
  section p {
    overflow-wrap: anywhere;
  }

  .line {
    margin: 12px 0 4px;
  }

  .sessions {
    margin: 0 0 8px;
    padding-left: 20px;
  }

  .note {
    margin: 12px 0 6px;
    font-size: 14px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }

  .buttons a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }

  .contact {
    flex-direction: column;
    align-items: flex-start !important;
    justify-content: center;
    text-align: left;
  }

  .who {
    color: #647780;
    font-size: 13px;
  }

  .socials {
    margin-top: 12px;
  }
</style>
