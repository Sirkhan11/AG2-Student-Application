import { inChat, SERVICES, serviceLink } from '#lib/nsu/services.js';
import { GROUP_ONLY, NAME_NOTES, SOCIETIES, suggestible } from '#lib/societies/societies.js';
import { CLUBS } from '#lib/sport/clubs.js';

// Everything the check-in chat may suggest, in one list: the Students' Union's societies at the chat's
// campus, Northumbria Sport's clubs and NSU's services. For each message the app picks a short list of
// likely ones from this (shortlist.js), and Gemini may only choose from that short list, by exact name
// (its reply's schema allows nothing else), so a suggestion can never be made up or misspelt.
// No Firebase here, so the checks can use it in Node.

/** The campus whose societies the chat suggests. The app doesn't know a student's campus yet. */
export const CHAT_CAMPUS = 'Newcastle';

/**
 * A link under a chat reply. Societies, clubs and services also say which one they are (kind, with
 * nsuId, slug or serviceId), so the chat shows a card with their details; an app page (no kind) is a
 * plain button.
 * @typedef {{ label: string, href: string, external: boolean, kind?: 'society' | 'club' | 'service',
 *   nsuId?: number, slug?: string, serviceId?: string }} ReplyLink
 */

/**
 * One thing the chat may suggest. name is unique across societies, clubs and services (check-shortlist.mjs
 * checks), and is what Gemini picks; about is what Gemini is told about it, besides its name; link is
 * the card the chat shows for it.
 * @typedef {{ name: string, kind: 'society' | 'club' | 'service', about: string, link: ReplyLink }} Suggestion
 */

/**
 * A society's words for Gemini: its NSU category and, where there is one, the note on who it's for
 * (GROUP_ONLY) or on a misleading name (NAME_NOTES).
 * @param {import('#lib/societies/societies.js').Society} society
 */
function aboutSociety(society) {
  const group = GROUP_ONLY[society.nsuId];
  const notes = [
    society.category,
    group ? (group.everyoneWelcome ? group.note : `${group.note}: only for someone who has said they are`) : null,
    NAME_NOTES[society.nsuId]
  ].filter(Boolean);
  return `a Students' Union society${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

/** @type {readonly Suggestion[]} */
export const SUGGESTIONS = Object.freeze([
  // Societies with a restricted audience (such as women only) are never suggested: see AUDIENCE.
  ...SOCIETIES.filter((society) => society.campus === CHAT_CAMPUS && suggestible(society)).map(
    (society) =>
      /** @type {Suggestion} */ ({
        name: society.name,
        kind: 'society',
        about: aboutSociety(society),
        link: { label: society.name, href: `/societies/${society.nsuId}`, external: false, kind: 'society', nsuId: society.nsuId }
      })
  ),
  // Names only for clubs: their about text, contacts and emails stay in Firestore, for the club cards.
  ...CLUBS.map(
    (club) =>
      /** @type {Suggestion} */ ({
        name: club.name,
        kind: 'club',
        about: 'a Northumbria Sport club (joining needs a paid membership; its card has the prices, training times and who to contact)',
        link: { label: club.name, href: `/sport/${club.slug}`, external: false, kind: 'club', slug: club.slug }
      })
  ),
  // Services left out of the chat (such as the Freshers Week wristband) aren't here: see NOT_IN_CHAT.
  ...SERVICES.filter(inChat).map((service) => {
    const topics = service.topics.length ? ` It covers: ${service.topics.map((topic) => topic.name).join('; ')}.` : '';
    return /** @type {Suggestion} */ ({
      name: service.name,
      kind: 'service',
      about: `an NSU service (${service.group}): ${service.summary}${topics}`,
      link: { label: service.name, ...serviceLink(service), kind: 'service', serviceId: service.id }
    });
  })
]);

/** Lower case with single spaces, for comparing names. @param {string} text */
const simple = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

const BY_NAME = new Map(SUGGESTIONS.map((suggestion) => [simple(suggestion.name), suggestion]));

/**
 * The suggestion with this exact name (ignoring capitals and spacing), or null.
 * @param {string} name
 */
export function suggestionNamed(name) {
  return BY_NAME.get(simple(name)) ?? null;
}
