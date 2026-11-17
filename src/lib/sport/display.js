// How a sports club's details are shown, shared by the club page (/sport/[slug]) and the check-in
// chat's club cards. No Firebase here, so check-sport-clubs.mjs can test it.

/** @typedef {import('#lib/sport/pages.js').ClubContact} ClubContact */

/** Northumbria Sport's own staff are listed under this role on each club's page. */
const STAFF_ROLE = /^supported by$/i;

/**
 * The contacts as groups of email buttons, one per person. A button is labelled with the person's
 * role as the club writes it ("Email the Men's Club President"), with their name shown beside it;
 * Northumbria Sport's staff ("Supported by") show as "Email Northumbria Sport staff". A contact with
 * a note instead of a role keeps the note, shown above its buttons, which are labelled by name.
 * @param {ClubContact[]} contacts
 * @returns {{ note: string | null, buttons: { label: string, name: string | null, email: string }[] }[]}
 */
export function contactGroups(contacts) {
  return contacts.map((contact) => {
    const role = contact.role?.trim() ?? '';
    const staff = STAFF_ROLE.test(role);
    return {
      note: contact.note,
      buttons: contact.people.map((person) => {
        if (staff) return { label: 'Email Northumbria Sport staff', name: person.name, email: person.email };
        if (role) return { label: `Email the ${role}`, name: person.name, email: person.email };
        return { label: person.name ? `Email ${person.name}` : 'Email this contact', name: null, email: person.email };
      })
    };
  });
}

/**
 * Memberships and training as blocks: each text line, with the session times (item lines) that
 * follow it listed under it. Items before any text line get a block of their own.
 * @param {{ kind: 'text' | 'item', text: string }[]} lines
 * @returns {{ text: string | null, items: string[] }[]}
 */
export function membershipBlocks(lines) {
  /** @type {{ text: string | null, items: string[] }[]} */
  const blocks = [];
  for (const line of lines) {
    if (line.kind === 'text') blocks.push({ text: line.text, items: [] });
    else if (blocks.length) blocks[blocks.length - 1].items.push(line.text);
    else blocks.push({ text: null, items: [line.text] });
  }
  return blocks;
}
