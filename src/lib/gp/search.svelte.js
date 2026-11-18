import { classifySearch, nearestAnywhere, OTHER_NATIONS, placeChoices, RESULTS } from '#lib/gp/finder.js';

// One search for the nearest GP surgeries, as the GP finder page and the check-in chat's GP finder
// card both do it (see finder.js for the two lists):
// - A typed full postcode (NE1 8ST), postcode district (NE6) or place (Heaton) goes to postcodes.io
//   (open data, no key) for where it is. A place with more than one match gives a short "which one?"
//   list. Nothing typed here is ever sent to Gemini: the chat's card is the app's own.
// - "Use my location" asks the phone where it is and works everything out on the phone. The
//   location is never saved, logged or sent anywhere (not to postcodes.io, our server, Firestore,
//   Gemini or anyone else). Searches outside the North East load the all-England list, and that
//   request is the same for everyone.
// - Outside England, it points to that country's own GP finder.
// Every new search, valid or not, replaces the last result and message.

/**
 * A search's surgeries (closest first), what was searched for, the postcode or district for NHS Find
 * a GP (null for a place or location), which list they came from, and whether it looked like it was
 * outside England.
 * @typedef {{ practices: import('#lib/gp/finder.js').NearbyPractice[], label: string, nhsSearch: string | null,
 *   source: 'north-east' | 'england', farFromEngland: boolean }} Results
 */

/** @param {unknown} country */
const otherNation = (country) => (typeof country === 'string' && Object.hasOwn(OTHER_NATIONS, country) ? /** @type {keyof typeof OTHER_NATIONS} */ (country) : null);

/** @param {string} path */
async function postcodesIo(path) {
  const response = await fetch(`https://api.postcodes.io${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`postcodes.io answered ${response.status}`);
  return (await response.json()).result;
}

export class GpSearch {
  /** What's being looked up: a typed search, the phone's location, or nothing. */
  busy = $state(/** @type {'' | 'search' | 'location'} */ (''));
  /** A problem or note to show. */
  note = $state('');
  /** Places with the name typed, when there's more than one. @type {import('#lib/gp/finder.js').PlaceChoice[] | null} */
  choices = $state(null);
  /** A search outside England: which country, for its own GP finder. @type {keyof typeof OTHER_NATIONS | null} */
  nation = $state(null);
  /** @type {Results | null} */
  results = $state(null);
  /** How many results are showing ("Show more" adds RESULTS more). */
  shown = $state(RESULTS);

  /** @param {{ needsTyping?: () => void }} [options] needsTyping: the location couldn't be used, so they should type instead */
  constructor({ needsTyping } = {}) {
    this.needsTyping = needsTyping ?? (() => {});
  }

  /** Clears the last search's results and messages: every new search starts from nothing. */
  startOver() {
    this.results = null;
    this.choices = null;
    this.nation = null;
    this.note = '';
    this.shown = RESULTS;
  }

  /**
   * Shows the nearest surgeries to a point. The point itself isn't kept.
   * @param {number} lat @param {number} lng @param {string} label @param {string | null} nhsSearch
   */
  async showNearest(lat, lng, label, nhsSearch) {
    try {
      const found = await nearestAnywhere(lat, lng);
      this.results = { ...found, label, nhsSearch };
    } catch (err) {
      console.error('The England GP list did not load:', err instanceof Error ? err.message : err);
      this.note = 'We couldn’t load the list of surgeries in England just now. Please try again, or use NHS Find a GP.';
    }
  }

  /** Searches for what they typed. @param {string} query */
  async search(query) {
    this.startOver();
    const wanted = classifySearch(query);
    if (wanted.kind === 'empty') {
      this.note = 'Type a postcode (NE1 8ST), a postcode district (NE6) or a place (Heaton).';
      return;
    }
    this.busy = 'search';
    try {
      if (wanted.kind === 'postcode') {
        const found = await postcodesIo(`/postcodes/${encodeURIComponent(wanted.value)}`);
        if (!found) this.note = 'We couldn’t find that postcode. Please check it, or try just the first part (such as NE6).';
        else if (otherNation(found.country)) this.nation = otherNation(found.country);
        else await this.showNearest(found.latitude, found.longitude, wanted.value, wanted.value);
      } else if (wanted.kind === 'district') {
        const found = await postcodesIo(`/outcodes/${encodeURIComponent(wanted.value)}`);
        const countries = Array.isArray(found?.country) ? found.country : [];
        if (!found || typeof found.latitude !== 'number') this.note = 'We couldn’t find that postcode district. Please check it, or type a full postcode.';
        else if (!countries.includes('England') && otherNation(countries[0])) this.nation = otherNation(countries[0]);
        else await this.showNearest(found.latitude, found.longitude, wanted.value, wanted.value);
      } else {
        const found = placeChoices(await postcodesIo(`/places?q=${encodeURIComponent(wanted.value)}&limit=20`), wanted.value);
        if (found.length === 0) this.note = `We couldn’t find a place called “${wanted.value}”. Please try a postcode or district instead.`;
        else if (found.length === 1) await this.choose(found[0]);
        else this.choices = found;
      }
    } catch (err) {
      console.error('The search failed:', err instanceof Error ? err.message : err);
      this.note = 'We couldn’t look that up just now. Please try again, or use NHS Find a GP.';
    } finally {
      this.busy = '';
    }
  }

  /** One of the places with the name typed. @param {import('#lib/gp/finder.js').PlaceChoice} place */
  async choose(place) {
    this.choices = null;
    if (otherNation(place.country)) {
      this.nation = otherNation(place.country);
      return;
    }
    await this.showNearest(place.lat, place.lng, `${place.label}, ${place.county}`, null);
  }

  /** Works out the nearest surgeries from the phone's location, which never leaves the phone. */
  useMyLocation() {
    this.startOver();
    if (!('geolocation' in navigator)) {
      this.askToType('This browser can’t share your location, so please type a postcode or place instead.');
      return;
    }
    this.busy = 'location';
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await this.showNearest(position.coords.latitude, position.coords.longitude, 'you', null);
        this.busy = '';
      },
      (failure) => {
        this.busy = '';
        this.askToType(
          failure.code === failure.PERMISSION_DENIED
            ? 'Your location wasn’t shared, so please type a postcode or place instead.'
            : 'We couldn’t get your location, so please type a postcode or place instead.'
        );
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 }
    );
  }

  /** @param {string} message */
  askToType(message) {
    this.note = message;
    this.needsTyping();
  }
}
