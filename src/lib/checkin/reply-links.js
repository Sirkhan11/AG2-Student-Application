import { findService, inChat, serviceLink } from '#lib/nsu/services.js';
import { findSociety, suggestible } from '#lib/societies/societies.js';
import { findClub } from '#lib/sport/clubs.js';

// Turns the societies, Northumbria Sport clubs and NSU services Gemini names in a check-in chat reply
// into links. Gemini is told to write each one as [[Name]]. No Firebase here, so scripts can test it.


/** The most links one reply can have, societies, clubs and services together, whatever Gemini writes. */
export const MAX_LINKS = 3;

/**
 * A link under a chat reply. Societies, clubs and services also say which one they are (kind, with
 * nsuId, slug or serviceId), so the chat shows a card with their details instead of a plain button.
 * @typedef {{ label: string, href: string, external: boolean, kind?: 'society' | 'club' | 'service',
 *   nsuId?: number, slug?: string, serviceId?: string }} ReplyLink
 */

/**
 * Takes the [[Name]] markers out of a reply, and collects links for the names that really are on
 * the lists. Whatever Gemini writes:
 * - a name that's on neither list stays as plain text with no link, so nothing made up looks real
 * - a society with a restricted audience (see AUDIENCE in societies.js), or a service the chat
 *   leaves out (see NOT_IN_CHAT in services.js), is never linked
 * - at most MAX_LINKS links, each named once
 * Services are checked first, then clubs, then societies. None shares an exact name with another
 * (check-checkin.mjs and check-sport-clubs.mjs check), so [[Hockey]] is the club and [[Ice Hockey]]
 * the society.
 * A society opens its page in the app; a service opens its page in the app if it has one (Societies),
 * otherwise NSU's page in a new tab.
 * @param {string} reply
 * @param {string} campus the campus whose societies the chat suggests
 * @returns {{ text: string, links: ReplyLink[] }}
 */
export function linksInReply(reply, campus) {
  /** @type {ReplyLink[]} */
  const links = [];
  /** @param {ReplyLink} link */
  const add = (link) => {
    if (links.length < MAX_LINKS && !links.some((existing) => existing.href === link.href)) links.push(link);
  };
  const text = reply.replace(/\[\[([^\]]{1,80})\]\]/g, (_, name) => {
    const service = findService(name);
    if (service) {
      if (inChat(service)) add({ label: service.name, ...serviceLink(service), kind: 'service', serviceId: service.id });
      return service.name;
    }
    const club = findClub(name);
    if (club) {
      add({ label: club.name, href: `/sport/${club.slug}`, external: false, kind: 'club', slug: club.slug });
      return club.name;
    }
    const society = findSociety(name, campus);
    if (society) {
      if (suggestible(society)) {
        add({ label: society.name, href: `/societies/${society.nsuId}`, external: false, kind: 'society', nsuId: society.nsuId });
      }
      return society.name;
    }
    return name;
  });
  return { text, links };
}
