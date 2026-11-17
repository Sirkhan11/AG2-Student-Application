// Checks scripts/lib/sport-club-pages.mjs, which checks a sport club pages file and turns it into the
// documents imported to Firestore, using made-up data (no real club, person or address): a good file
// becomes documents, bad values are found and reported by where they are (never what they are), long
// notes are left out with their people kept, and no message ever holds an email address.
//
// Run from the project folder:
//   node scripts/check-sport-club-import.mjs

import assert from 'node:assert/strict';
import { checkSportClubPages, MAX_NOTE_LENGTH } from './lib/sport-club-pages.mjs';

const SLUGS = new Set(['made-up-swimming', 'pretend-hockey']);

/** A good made-up file, built fresh each time so a check can break one part of it. */
function goodFile() {
  return {
    source: 'https://northumbriasport.com/sports',
    collectedAt: '2026-11-17T14:44:45.528Z',
    clubs: {
      'made-up-swimming': {
        name: 'Made-Up Swimming',
        url: 'https://northumbriasport.com/sport/made-up-swimming',
        about: ['We swim.', '  ', 'All levels welcome.'],
        membership: [
          { kind: 'text', text: 'COMPETE Swimming - £120 per person' },
          { kind: 'item', text: 'Mondays 18:00-19:00 (Pool)' },
          { kind: 'text', text: '  ' }
        ],
        socials: [{ platform: 'instagram', url: 'https://instagram.com/madeupswim' }],
        contacts: [
          { role: 'Club President', note: null, people: [{ name: 'Alex Example', email: 'alex@example.org' }, { name: '', email: 'president2@example.org' }] },
          { role: 'Supported by', people: [{ name: 'Sam Example', email: 'sam@example.org' }] },
          { role: null, note: 'Non-students should contact the sport team first.', people: [{ name: 'Jo Example', email: 'jo@example.org' }] }
        ],
        bookUrl: 'https://booking.example.org/made-up-swimming'
      },
      'pretend-hockey': {
        name: 'Pretend Hockey',
        url: 'https://northumbriasport.com/sport/pretend-hockey',
        about: ['Hockey on grass.'],
        contacts: [],
        bookUrl: null
      }
    }
  };
}

/** @type {[string, () => void][]} */
const checks = [
  ['A good file becomes one document per club, tidied (blank paragraphs and lines dropped), with counts', () => {
    const { errors, review, docs, counts } = checkSportClubPages(goodFile(), SLUGS);
    assert.deepEqual(errors, []);
    assert.deepEqual(review, []);
    const swimming = docs.get('made-up-swimming');
    assert.deepEqual(swimming?.about, ['We swim.', 'All levels welcome.']);
    assert.deepEqual(swimming?.membership, [{ kind: 'text', text: 'COMPETE Swimming - £120 per person' }, { kind: 'item', text: 'Mondays 18:00-19:00 (Pool)' }]);
    assert.deepEqual(swimming?.contacts[1], { role: 'Supported by', note: null, people: [{ name: 'Sam Example', email: 'sam@example.org' }] });
    assert.deepEqual(swimming?.contacts[0].people[1], { name: null, email: 'president2@example.org' }, 'a person with an email but no name is kept, with name null');
    assert.equal(swimming?.contacts[2].role, null);
    assert.equal(docs.get('pretend-hockey')?.bookUrl, null);
    assert.deepEqual(docs.get('pretend-hockey')?.socials, []);
    assert.deepEqual(counts, { clubs: 2, withAbout: 2, withMembership: 1, membershipLines: 2, sessionItems: 1, contacts: 3, people: 4, socials: 1, withBookUrl: 1, notesLeftOut: 0 });
  }],
  ['Bad values are reported by where they are, never what they are', () => {
    const file = goodFile();
    const swimming = /** @type {any} */ (file.clubs['made-up-swimming']);
    swimming.contacts[0].people[0].email = 'not-an-email bad@@example';
    swimming.url = 'http://northumbriasport.com/sport/made-up-swimming';
    swimming.membership[0].kind = 'heading';
    swimming.contacts[1].role = null;
    const { errors, docs } = checkSportClubPages(file, SLUGS);
    assert.deepEqual(errors, [
      'made-up-swimming.url: should be an https link',
      'made-up-swimming.membership[0]: should be { kind: "text" or "item", text }',
      'made-up-swimming.contacts[0].people[0].email: should be an email address',
      'made-up-swimming.contacts[1]: needs a role or a note'
    ]);
    assert.ok(!docs.has('made-up-swimming'), 'a club with problems isn\'t imported');
    assert.ok(errors.every((error) => !error.includes('@') && !error.includes('Alex')));
  }],
  ['Clubs must match the list: an unknown slug and a missing one are both problems', () => {
    const file = goodFile();
    /** @type {any} */ (file.clubs)['made-up-rowing'] = file.clubs['pretend-hockey'];
    delete (/** @type {any} */ (file.clubs))['pretend-hockey'];
    const { errors } = checkSportClubPages(file, SLUGS);
    assert.deepEqual(errors, ['made-up-rowing: not a slug from sport-clubs.json', 'pretend-hockey: in sport-clubs.json but missing from this file']);
  }],
  [`A note over ${MAX_NOTE_LENGTH} characters is left out (its people kept) and listed by club, without its text`, () => {
    const file = goodFile();
    const long = `Key contacts: Pat Example, pat@example.org. ${'More of the page. '.repeat(30)}`;
    /** @type {any} */ (file.clubs['made-up-swimming']).contacts[2].note = long;
    const { errors, review, docs, counts } = checkSportClubPages(file, SLUGS);
    assert.deepEqual(errors, []);
    assert.equal(docs.get('made-up-swimming')?.contacts[2].note, null);
    assert.deepEqual(docs.get('made-up-swimming')?.contacts[2].people, [{ name: 'Jo Example', email: 'jo@example.org' }]);
    assert.deepEqual(review, [`made-up-swimming: contact 3's note was ${long.trim().length} characters, so it was left out (its people are kept)`]);
    assert.equal(counts.notesLeftOut, 1);
    assert.ok(review.every((line) => !line.includes('@') && !line.includes('Pat')));
  }],
  ['A file with no clubs object is refused outright', () => {
    assert.deepEqual(checkSportClubPages({ source: 'https://x.example' }, SLUGS).errors, ['the file needs a "clubs" object keyed by slug']);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
