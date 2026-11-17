import data from '#lib/nsu/nsu-services.json' with { type: 'json' };

// Northumbria Students' Union's services that matter to new students (src/lib/nsu/nsu-services.json:
// public information from the menus on mynsu.co.uk). Each has a name, a one-line summary and a link
// to NSU's own page, which has the details. Used by the /students-union page, Need Help Now, and the
// check-in chat. No Firebase here, so the check scripts can use it.

/**
 * @typedef {{ id: string, name: string, url: string, summary: string, group: string,
 *   appPath: string | null, seasonal: string | null, topics: { name: string, url: string }[] }} Service
 */

/** Where the list came from, and when it was checked. */
export const SERVICES_SOURCE = data.source;
export const SERVICES_CHECKED_AT = data.checkedAt;

/** The groups in NSU's order, each with its services. */
export const SERVICE_GROUPS = data.groups.map((group) => ({
  name: group.name,
  services: group.services.map(
    (service) =>
      /** @type {Service} */ ({
        id: service.id,
        name: service.name,
        url: service.url,
        summary: service.summary,
        group: group.name,
        // Opens a page in this app instead of NSU's (Societies opens /societies).
        appPath: 'appPath' in service && typeof service.appPath === 'string' ? service.appPath : null,
        // A note about timing (such as a link that changes every year). /students-union shows it
        // with a "Seasonal" label; check-services.mjs prints it as a reminder.
        seasonal: 'seasonal' in service && typeof service.seasonal === 'string' ? service.seasonal : null,
        topics: 'topics' in service && Array.isArray(service.topics) ? service.topics : []
      })
  )
}));

/** Every service, in the same order. */
export const SERVICES = SERVICE_GROUPS.flatMap((group) => group.services);

/**
 * Services the check-in chat never suggests or links, by id (so a renamed service keeps its rule).
 * They're still on the /students-union page. The Freshers Week wristband is left out because
 * Freshers is over and NSU's page has no dates; for students into nights out, the chat points to
 * Events and Gigs instead. Look at this again before next Freshers.
 */
export const NOT_IN_CHAT = ['freshers-week'];

/** True for services the check-in chat may suggest. @param {Service} service */
export function inChat(service) {
  return !NOT_IN_CHAT.includes(service.id);
}

/** Lower case with single spaces, for comparing names. @param {string} text */
const simple = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** @param {string} id */
export function serviceById(id) {
  return SERVICES.find((service) => service.id === id) ?? null;
}

/**
 * Finds a service by its exact name, ignoring capitals and spacing, or null.
 * @param {string} name
 */
export function findService(name) {
  return SERVICES.find((service) => simple(service.name) === simple(name)) ?? null;
}

/**
 * Where a service's link goes: its page in this app if it has one, otherwise NSU's own page, which
 * opens in a new tab.
 * @param {Service} service
 * @returns {{ href: string, external: boolean }}
 */
export function serviceLink(service) {
  return service.appPath ? { href: service.appPath, external: false } : { href: service.url, external: true };
}
