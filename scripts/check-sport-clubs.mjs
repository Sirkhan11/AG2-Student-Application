// Checks Northumbria Sport's club list (src/lib/sport/sport-clubs.json) and src/lib/sport/clubs.js:
// the data is what we expect and holds no contact details, lookups work, and no club has exactly the
// same name as a society or an NSU service, so a name in a chat reply can only mean one thing (a
// later refresh that adds a clash fails here). Also how a club's contacts and training times are
// shown (src/lib/sport/display.js), with made-up people, and that the chat's instructions hold no
// "@" and only the clubs' names. No Gemini or Firebase.
//
// Given the private pages file (kept outside the repo), it also checks nothing from it (about text,
// notes, contacts' names or emails) is in the chat's instructions, printing counts only:
//   SPORT_CLUB_PAGES=~/Downloads/sport-club-pages.json node scripts/check-sport-clubs.mjs
//
// Run from the project folder:
//   node scripts/check-sport-clubs.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLUBS, CLUBS_COLLECTED_AT, CLUBS_SOURCE, clubBySlug, findClub, searchClubs } from '#lib/sport/clubs.js';
import { findSociety, SOCIETIES } from '#lib/societies/societies.js';
import { SERVICES } from '#lib/nsu/services.js';
import { contactGroups, membershipBlocks } from '#lib/sport/display.js';
import { chatInstructions, CLUB_LIST } from '#lib/checkin/chat-prompt.js';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { homedir } from 'node:os';

/** The chat's full instructions for a made-up student, as Gemini receives them. */
const INSTRUCTIONS = chatInstructions(
  describeForGemini({ match: null, tasks: null }),
  buildOpener({ match: null, tasks: null, justSignedUp: false }).messages
);

const key = (/** @type {string} */ name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/** @type {[string, () => void][]} */
const checks = [
  ['38 clubs, each with a unique slug, a name, a northumbriasport.com link, and an https picture or none', () => {
    assert.equal(CLUBS.length, 38);
    assert.equal(new Set(CLUBS.map((club) => club.slug)).size, 38);
    for (const club of CLUBS) {
      assert.match(club.slug, /^[a-z0-9-]+$/, club.name);
      assert.ok(club.name.trim() !== '', `${club.slug} has no name`);
      assert.match(club.url, /^https:\/\/northumbriasport\.com\//, club.name);
      assert.ok(club.image === null || club.image.startsWith('https://'), `${club.name}: picture link isn't https`);
    }
    assert.deepEqual(CLUBS.filter((club) => club.image === null).map((club) => club.name), ['Dodgeball', 'Padel', 'Rounders']);
    assert.match(CLUBS_SOURCE, /^https:\/\/northumbriasport\.com\//);
    assert.ok(!Number.isNaN(new Date(CLUBS_COLLECTED_AT).getTime()));
  }],
  ['The list file holds no contact details: no "@" anywhere in it', () => {
    assert.ok(!readFileSync('src/lib/sport/sport-clubs.json', 'utf8').includes('@'));
  }],
  ['Looking up by slug and by exact name (ignoring capitals); search by part of a name', () => {
    assert.equal(clubBySlug('swimming')?.name, 'Swimming');
    assert.equal(clubBySlug('nope'), null);
    assert.equal(findClub('  table   TENNIS ')?.slug, 'table-tennis');
    assert.equal(findClub('Swim'), null, 'part of a name is not enough');
    assert.deepEqual(searchClubs('foot').map((club) => club.name), ['American Football', 'Football', 'Gaelic Football']);
  }],
  ['No club has exactly the same name as a society (on either campus) or an NSU service', () => {
    const societies = new Set(SOCIETIES.map((society) => key(society.name)));
    const services = new Set(SERVICES.map((service) => key(service.name)));
    const clashes = CLUBS.filter((club) => societies.has(key(club.name)) || services.has(key(club.name))).map((club) => club.name);
    assert.deepEqual(clashes, []);
  }],
  ['Contact buttons: roles as the club writes them, with the name beside; "Supported by" is Northumbria Sport staff; a note goes above its buttons', () => {
    const groups = contactGroups([
      { role: "Men's Club President", note: null, people: [{ name: 'Alex Example', email: 'alex@example.org' }, { name: null, email: 'mens@example.org' }] },
      { role: 'Supported by', note: null, people: [{ name: 'Sam Example', email: 'sam@example.org' }] },
      { role: null, note: 'Non-students should get in touch first.', people: [{ name: 'Jo Example', email: 'jo@example.org' }, { name: null, email: 'club@example.org' }] }
    ]);
    assert.deepEqual(groups, [
      { note: null, buttons: [
        { label: "Email the Men's Club President", name: 'Alex Example', email: 'alex@example.org' },
        { label: "Email the Men's Club President", name: null, email: 'mens@example.org' }
      ] },
      { note: null, buttons: [{ label: 'Email Northumbria Sport staff', name: 'Sam Example', email: 'sam@example.org' }] },
      { note: 'Non-students should get in touch first.', buttons: [
        { label: 'Email Jo Example', name: null, email: 'jo@example.org' },
        { label: 'Email this contact', name: null, email: 'club@example.org' }
      ] }
    ]);
  }],
  ['Memberships and training: each line with the session times under it listed beneath it', () => {
    assert.deepEqual(membershipBlocks([
      { kind: 'item', text: 'Saturdays 10:00' },
      { kind: 'text', text: 'COMPETE Swimming - £120' },
      { kind: 'item', text: 'Mondays 18:00-19:00' },
      { kind: 'item', text: 'Thursdays 07:00-08:00' },
      { kind: 'text', text: 'Includes BUCS entry' }
    ]), [
      { text: null, items: ['Saturdays 10:00'] },
      { text: 'COMPETE Swimming - £120', items: ['Mondays 18:00-19:00', 'Thursdays 07:00-08:00'] },
      { text: 'Includes BUCS entry', items: [] }
    ]);
  }],
  ['The chat\'s instructions hold no "@", and their club list is only the clubs\' names', () => {
    assert.ok(!INSTRUCTIONS.includes('@'));
    assert.ok(INSTRUCTIONS.includes(`Northumbria Sport clubs, all at the Newcastle campus (one per line):\n${CLUB_LIST}\n`));
    assert.deepEqual(CLUB_LIST.split('\n'), CLUBS.map((club) => club.name));
  }],
  ['Hockey is the club and Ice Hockey the society, never the other way round', () => {
    assert.equal(findClub('Hockey')?.slug, 'hockey');
    assert.equal(findClub('Ice Hockey'), null);
    assert.equal(findSociety('Ice Hockey', 'Newcastle')?.name, 'Ice Hockey');
    assert.equal(findSociety('Hockey', 'Newcastle'), null);
  }]
];

// With the private pages file: nothing from it reaches Gemini. Prints counts only, never the text.
const pagesPath = process.env.SPORT_CLUB_PAGES?.replace(/^~(?=\/)/, homedir());
if (pagesPath) {
  checks.push(['Nothing from the private pages file (about text, notes, contacts\' names and emails) is in the chat\'s instructions', () => {
    const pages = Object.values(JSON.parse(readFileSync(pagesPath, 'utf8')).clubs);
    /** @type {string[]} */
    const pieces = [];
    for (const page of /** @type {any[]} */ (pages)) {
      pieces.push(...(page.about ?? []).filter((/** @type {string} */ text) => text.trim().length >= 25));
      for (const contact of page.contacts ?? []) {
        if (contact.note && contact.note.trim().length >= 25) pieces.push(contact.note);
        for (const person of contact.people ?? []) {
          if (person.email) pieces.push(person.email);
          // Names of 2 words or more, so a one-word name that's also a club ("Football") isn't counted.
          if (person.name && person.name.trim().split(/\s+/).length >= 2) pieces.push(person.name);
        }
      }
    }
    const found = pieces.filter((piece) => INSTRUCTIONS.includes(piece.trim())).length;
    console.log(`      (looked for ${pieces.length} pieces of the pages file in the instructions)`);
    assert.equal(found, 0, `${found} piece(s) of the pages file are in the instructions`);
  }]);
}

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n')[0]}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
