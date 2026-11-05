<script>
  import BottomNav from '$lib/components/BottomNav.svelte';

  let postcode = $state('');
  let category = $state('GP');
  let results = $state([]);
  let loading = $state(false);
  let error = $state('');

  // Development-only sample data.
  // Replace with verified Firestore records.
  const services = [
    {
      id: 1,
      name: 'Sample GP Practice',
      type: 'GP',
      latitude: 54.9783,
      longitude: -1.6178
    },
    {
      id: 2,
      name: 'Sample Dental Practice',
      type: 'Dentist',
      latitude: 54.9700,
      longitude: -1.6100
    }
  ];

  function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );
  }

  async function search() {
    loading = true;
    error = '';
    results = [];

    try {
      const response = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`
      );

      if (!response.ok) {
        throw new Error('Postcode not found');
      }

      const data = await response.json();
      const { latitude, longitude } = data.result;

      results = services
        .filter((service) => service.type === category)
        .map((service) => ({
          ...service,
          distance: distanceKm(
            latitude,
            longitude,
            service.latitude,
            service.longitude
          )
        }))
        .sort((a, b) => a.distance - b.distance);

    } catch (err) {
      error = 'Unable to find that postcode.';
    } finally {
      loading = false;
    }
  }
</script>

<main class="page">
  <h1>Find a GP or Dentist</h1>

  <p class="muted">
    Search for healthcare services near your postcode.
  </p>

  <form onsubmit={(event) => {
    event.preventDefault();
    search();
  }}>
    <label for="category">Service type</label>
    <select id="category" class="field" bind:value={category}>
      <option value="GP">GP</option>
      <option value="Dentist">Dentist</option>
    </select>

    <label for="postcode">Your postcode</label>
    <input
      id="postcode"
      class="field"
      placeholder="e.g. NE1 7RU"
      bind:value={postcode}
      required
    />

    <button class="primary-button" type="submit">
      {loading ? 'Searching...' : 'Search'}
    </button>
  </form>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#each results as service}
    <section class="card">
      <h2>{service.name}</h2>
      <p>{service.distance.toFixed(1)} km away</p>
      <p class="muted">
        Approximate straight-line distance
      </p>
    </section>
  {/each}

  <BottomNav />
</main>
