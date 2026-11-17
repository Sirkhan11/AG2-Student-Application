<script>
  import ServiceCard from '#lib/components/ServiceCard.svelte';
  import SocietyCard from '#lib/components/SocietyCard.svelte';
  import { serviceById } from '#lib/nsu/services.js';

  // Made-up societies and details (no real society, person or address), passed straight to the
  // cards so nothing is loaded. The picture is drawn here, so the page makes no outside requests.
  const picture =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#1764a1"/><circle cx="24" cy="24" r="12" fill="#fff"/></svg>');

  /** @type {import('#lib/societies/societies.js').Society} */
  const full = {
    nsuId: 900001,
    name: 'Made-Up Chess and Board Games Society',
    category: 'Recreational Sport',
    campus: 'Newcastle',
    url: 'https://mynsu.co.uk/',
    image: picture
  };
  /** @type {import('#lib/societies/pages.js').SocietyPage} */
  const fullDetails = {
    description: [
      'We meet for casual games every week, from chess and draughts to big strategy board games, and run a friendly tournament each term. Complete beginners are welcome, and we always have someone happy to teach the rules.',
      'A second paragraph that the card leaves for the society page.'
    ],
    memberships: [
      { name: 'Full Membership', price: 5 },
      { name: 'Associate Membership (staff and alumni)', price: 6.5 }
    ],
    socials: [
      { platform: 'instagram', url: 'https://example.org/instagram' },
      { platform: 'tiktok', url: 'https://example.org/tiktok' },
      { platform: 'whatsapp', url: 'https://example.org/whatsapp' },
      { platform: 'discord', url: 'https://example.org/discord' },
      { platform: 'website', url: 'https://example.org/' }
    ],
    eventsUrl: null,
    email: 'chess@example.org',
    committee: [],
    collectedAt: null
  };
  /** A society whose details couldn't load: the card shows what the list has. */
  /** @type {import('#lib/societies/societies.js').Society} */
  const listOnly = { nsuId: 900002, name: 'Pretend Hiking', category: 'Recreational Sport', campus: 'Newcastle', url: 'https://mynsu.co.uk/', image: null };

  const services = [serviceById('food-pantry'), serviceById('societies')].filter((service) => service !== null);
</script>

<main class="page">
  <h1>Chat cards preview</h1>
  <p class="muted">Development only, with made-up details, for checking the chat's cards at phone width.</p>

  <div class="messages">
    <div class="bubble">
      You might like the Made-Up Chess and Board Games Society or Pretend Hiking. If money's tight,
      the Food Pantry can help, and the Societies page has the rest.
    </div>
    <div class="cards">
      <SocietyCard society={full} details={fullDetails} />
      <SocietyCard society={listOnly} details={null} />
      {#each services as service (service.id)}
        <ServiceCard {service} />
      {/each}
    </div>
  </div>
</main>

<style>
  /* The same layout as the chat's messages and cards (src/routes/check-in/+page.svelte). */
  .messages {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 20px 0;
  }

  .bubble {
    align-self: flex-start;
    max-width: 85%;
    padding: 13px;
    border-radius: 14px;
    background: #eaf2f8;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
