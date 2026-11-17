// Checks scripts/lib/sport-collect.mjs, the offline part of collect-sport-clubs.mjs, with made-up
// pages (no real club, person or address; the layout copies northumbriasport.com's): reading the
// /sports list and club pages, turning contact lines into contacts as process_sport.py did, building
// the two files (the list with nothing personal in it, and a pages file the import accepts), keeping
// only the picture on a list-only run, the change summaries, the checks before writing, spotting a
// refusal or challenge, and the script refusing a pages file inside the repo. Nothing here goes to
// the network.
//
// Run from the project folder:
//   node scripts/check-collect-sport.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkSportClubPages } from './lib/sport-club-pages.mjs';
import {
  blockedReason, buildFiles, checkBeforeWriting, contactsFrom, EMAIL_NOTE, listChanges, maskEmails, MIN_CLUBS,
  pagesChanges, parseClubList, parseClubPage, pictureOnly, sameList, summaryText
} from './lib/sport-collect.mjs';

// The /sports page, cut down and made up: a picture link and a text link to the same club, an
// absolute link, a repeat, and links that aren't clubs.
const LIST_PAGE = `<html><body>
<nav><a href="/sports">Sports</a> <a href="/sport">All sport</a> <a href="https://example.com/sport/elsewhere">Elsewhere</a></nav>
<div class="clubs">
  <a href="/sport/pretend-rowing"><img src="/uploads/x.jpg" alt=""></a>
  <a href="/sport/pretend-rowing">Pretend Rowing</a>
  <a href="https://northumbriasport.com/sport/made-up-netball"> Made-Up
     Netball </a>
  <a href="/sport/pretend-rowing">Pretend Rowing again</a>
  <a href="/sport/pretend-rowing/fixtures">Fixtures</a>
  <a href="/sport/Bad_Slug">Bad</a>
  <a href="/sport/abseiling">abseiling</a>
</div></body></html>`;

// A full club page, laid out like the real ones: the Book Online button in the toolbar, the banner,
// the header with its social links (one empty, one not https), then the article: about, a rule,
// memberships and training, another rule, contacts. One contact line comes before the first rule.
const ROWING_URL = 'https://northumbriasport.com/sport/pretend-rowing';
const ROWING_PAGE = `<html><body>
<div class="row-toolbar"><div class="container"><a class="btn btn-book btn-block" href="https://booking.example.test/rowing">Book Online</a></div></div>
<div class="banner"><img class="banner-image" src="/uploads/banners/abc_THUMB_rowing.jpg"><img class="banner-image" src="/uploads/banners/second.jpg"></div>
<header class="article__header"><h1 class="article-title"> Pretend Rowing </h1>
<ul class="social-media">
  <li><a class="social social-instagram" href="https://www.instagram.com/pretend.rowing/">Instagram</a></li>
  <li><a class="social social-facebook" href="">Facebook</a></li>
  <li><a class="social social-x" href="http://twitter.com/pretendrowing">X</a></li>
  <li><a class="social social-website" href="https://northumbriasport.com/pretend-rowing-news">Website</a></li>
</ul></header>
<div class="article__body">
  <p>We row on the river.<br>All welcome.</p>
  <p>Questions? Write to questions@example.com any time.</p>
  <ul><li>Beginners</li><li> Racers </li></ul>
  <p>   </p>
  <p>Club Captain: <a href="mailto:Alex.Example@Example.com">Alex Example</a></p>
  <hr>
  <p>Club memberships available for Pretend Rowing in 2026/27</p>
  <p>Full membership - £50</p>
  <ul><li>Mondays 18:00-19:00</li><li>Thursdays<br>07:00</li></ul>
  <table><tr><td>Week 1</td> <td>Erg test</td></tr></table>
  <div></div>
  <hr>
  <p>Key Contacts 2026/27</p>
  <p>Coaches: <a href="mailto:sam@example.com">Sam Example</a> &amp; <a href="mailto:jo%40example.com?subject=Hi">Jo Example</a></p>
  <p>This club is supported by <a href="mailto:staff@example.com">Pat Example</a>, Sport Development Officer</p>
  <p>For general enquiries please email <a href="mailto:club@example.com">club@example.com</a></p>
  <p>Treasurer - <a href="mailto:t@example.com">Taylor Example</a></p>
  <p>Our very long description of who to contact about anything at all at the club: <a href="mailto:long@example.com">Lee Example</a></p>
  <p>Social Secretary: <a href="mailto:nobody">Nobody Example</a></p>
</div></body></html>`;

// A club page with nothing but its name, one with no rule (so everything is about text, as on some
// real pages), and one that doesn't read as a club page at all.
const NETBALL_PAGE = '<html><body><header class="article__header"><h1 class="article-title">Made-Up Netball</h1></header></body></html>';
const ABSEILING_PAGE = `<html><body><header class="article__header"><h1 class="article-title">Abseiling</h1></header>
<div class="article__body"><p>Down the wall.</p><ul><li>Fridays</li></ul><p>Contact: <a href="mailto:rope@example.com">Robin Example</a></p></div></body></html>`;
const ODD_PAGE = '<html><body><h1>Netball</h1><div class="article__body"><p>Hi</p></div></body></html>';

const LISTED = parseClubList(LIST_PAGE);
const ROWING = parseClubPage(ROWING_PAGE, ROWING_URL);
const PAGES = new Map([
  ['pretend-rowing', ROWING],
  ['made-up-netball', parseClubPage(NETBALL_PAGE, 'https://northumbriasport.com/sport/made-up-netball')],
  ['abseiling', parseClubPage(ABSEILING_PAGE, 'https://northumbriasport.com/sport/abseiling')]
]);
const BUILT = buildFiles(LISTED, PAGES, '2026-11-24T06:01:00.000Z', true);
const PEOPLE = ['Alex Example', 'Sam Example', 'Jo Example', 'Pat Example', 'Taylor Example', 'Lee Example', 'Robin Example'];

/** @type {[string, () => void][]} */
const checks = [
  ["The /sports list: each club once, in the page's order, by its text link; links that aren't a club are left out", () => {
    assert.deepEqual(LISTED, [
      { slug: 'pretend-rowing', name: 'Pretend Rowing', url: 'https://northumbriasport.com/sport/pretend-rowing' },
      { slug: 'made-up-netball', name: 'Made-Up Netball', url: 'https://northumbriasport.com/sport/made-up-netball' },
      { slug: 'abseiling', name: 'abseiling', url: 'https://northumbriasport.com/sport/abseiling' }
    ]);
    assert.deepEqual(parseClubList('<html><body><p>No clubs today</p></body></html>'), []);
  }],
  ['A club page: name, first banner picture (made absolute), socials (no empty or non-https links), Book Online', () => {
    assert.equal(ROWING.parsed, true);
    assert.equal(ROWING.name, 'Pretend Rowing');
    assert.equal(ROWING.image, 'https://northumbriasport.com/uploads/banners/abc_THUMB_rowing.jpg');
    assert.deepEqual(ROWING.socials, [
      { platform: 'instagram', url: 'https://www.instagram.com/pretend.rowing/' },
      { platform: 'website', url: 'https://northumbriasport.com/pretend-rowing-news' }
    ]);
    assert.equal(ROWING.socialsLeftOut, 1, 'the http link is left out');
    assert.equal(ROWING.bookUrl, 'https://booking.example.test/rowing');
  }],
  ['About is everything before the first rule (lists one paragraph per item); after it, lists are session times and tables one line', () => {
    assert.deepEqual(ROWING.about, ['We row on the river. All welcome.', 'Questions? Write to questions@example.com any time.', 'Beginners', 'Racers']);
    assert.deepEqual(ROWING.membership, [
      { kind: 'text', text: 'Club memberships available for Pretend Rowing in 2026/27' },
      { kind: 'text', text: 'Full membership - £50' },
      { kind: 'item', text: 'Mondays 18:00-19:00' },
      { kind: 'item', text: 'Thursdays 07:00' },
      { kind: 'text', text: 'Week 1 Erg test' },
      { kind: 'text', text: 'Key Contacts 2026/27' }
    ]);
    const abseiling = /** @type {import('./lib/sport-collect.mjs').ClubPage} */ (PAGES.get('abseiling'));
    assert.deepEqual(abseiling.about, ['Down the wall.', 'Fridays'], 'with no rule, everything but contacts is about text');
    assert.deepEqual(abseiling.membership, []);
  }],
  ['Lines with email links are contacts wherever they are: names from the links, addresses in lower case and decoded', () => {
    assert.deepEqual(ROWING.contactLines.map((line) => line.people), [
      [{ name: 'Alex Example', email: 'alex.example@example.com' }],
      [{ name: 'Sam Example', email: 'sam@example.com' }, { name: 'Jo Example', email: 'jo@example.com' }],
      [{ name: 'Pat Example', email: 'staff@example.com' }],
      [{ name: null, email: 'club@example.com' }],
      [{ name: 'Taylor Example', email: 't@example.com' }],
      [{ name: 'Lee Example', email: 'long@example.com' }],
      [{ name: 'Nobody Example', email: 'nobody' }]
    ]);
  }],
  ['Contacts as process_sport.py made them: roles before ":" or " - ", "Supported by", notes, long roles, people with an "@"', () => {
    assert.deepEqual(contactsFrom(ROWING.contactLines), [
      { role: 'Club Captain', note: null, people: [{ name: 'Alex Example', email: 'alex.example@example.com' }] },
      { role: 'Coaches', note: null, people: [{ name: 'Sam Example', email: 'sam@example.com' }, { name: 'Jo Example', email: 'jo@example.com' }] },
      { role: 'Supported by', note: null, people: [{ name: 'Pat Example', email: 'staff@example.com' }] },
      { role: null, note: `For general enquiries please email ${EMAIL_NOTE}`, people: [{ name: null, email: 'club@example.com' }] },
      { role: 'Treasurer', note: null, people: [{ name: 'Taylor Example', email: 't@example.com' }] },
      { role: null, note: 'Our very long description of who to contact about anything at all at the club: Lee Example', people: [{ name: 'Lee Example', email: 'long@example.com' }] }
    ]);
    assert.deepEqual(contactsFrom([{ text: ': Robin Example', people: [{ name: 'Robin Example', email: 'r@example.com' }] }]),
      [{ role: null, note: ': Robin Example', people: [{ name: 'Robin Example', email: 'r@example.com' }] }], 'an empty role is a note');
  }],
  ['A page with only a name reads, with nothing else; a page without the club heading does not', () => {
    assert.deepEqual(PAGES.get('made-up-netball'), {
      parsed: true, name: 'Made-Up Netball', image: null, about: [], membership: [], socials: [], socialsLeftOut: 0, contactLines: [], bookUrl: null
    });
    assert.equal(parseClubPage(ODD_PAGE, 'https://northumbriasport.com/sport/netball').parsed, false);
  }],
  ['The list: sorted by name ignoring capitals, slug, name, link and picture only, with nothing personal in it', () => {
    const { list } = BUILT;
    assert.deepEqual(list.clubs.map((club) => club.slug), ['abseiling', 'made-up-netball', 'pretend-rowing']);
    assert.deepEqual(Object.keys(list), ['source', 'collectedAt', 'note', 'count', 'clubs']);
    assert.equal(list.count, 3);
    assert.deepEqual(list.clubs[2], { slug: 'pretend-rowing', name: 'Pretend Rowing', url: ROWING_URL, image: ROWING.image });
    const text = JSON.stringify(list);
    assert.ok(!text.includes('@'), 'no email in the list');
    for (const person of PEOPLE) assert.ok(!text.includes(person), `${person} isn't in the list`);
  }],
  ['The pages file: the import accepts it, and emails in about and membership text are taken out', () => {
    const pagesFile = /** @type {import('./lib/sport-collect.mjs').PagesFile} */ (BUILT.pagesFile);
    const { errors, counts } = checkSportClubPages(pagesFile, new Set(BUILT.list.clubs.map((club) => club.slug)));
    assert.deepEqual(errors, []);
    assert.equal(counts.clubs, 3);
    assert.equal(pagesFile.clubs['pretend-rowing'].about[1], `Questions? Write to ${EMAIL_NOTE} any time.`);
    assert.equal(pagesFile.clubs['pretend-rowing'].contacts.length, 6);
    assert.equal(pagesFile.clubs.abseiling.contacts[0].role, 'Contact');
  }],
  ['Review notes say which club and what, never page text', () => {
    assert.deepEqual([...BUILT.review].sort(), [
      "abseiling: no membership or training details on the club page",
      "abseiling: no picture on the club page",
      "abseiling: the club page's heading differs from its name on /sports (the list keeps /sports's)",
      "made-up-netball: no contact emails on the club page",
      "made-up-netball: no membership or training details on the club page",
      "made-up-netball: no picture on the club page",
      "pretend-rowing: a social link that isn't https was left out"
    ]);
  }],
  ['A list-only run keeps just the picture from each club page: the same list, no pages file, nothing personal kept', () => {
    const kept = new Map([...PAGES].map(([slug, page]) => [slug, pictureOnly(page)]));
    const text = JSON.stringify([...kept.values()]);
    assert.ok(!text.includes('@'));
    for (const person of PEOPLE) assert.ok(!text.includes(person), `${person} isn't kept`);
    const listOnly = buildFiles(LISTED, kept, '2026-11-24T06:01:00.000Z', false);
    assert.equal(listOnly.pagesFile, null);
    assert.deepEqual(listOnly.list, BUILT.list);
  }],
  ['List changes by slug (added, gone, renamed, new picture or link); when it was collected doesn\'t count', () => {
    const { list } = BUILT;
    assert.equal(sameList({ ...list, collectedAt: '2026-11-17T14:44:45.528Z' }, list), true);
    assert.equal(sameList(null, list), false);
    const last = {
      ...list,
      clubs: [
        { ...list.clubs[0], name: 'Abseiling' },
        { ...list.clubs[2], image: 'https://northumbriasport.com/uploads/banners/old.jpg', url: 'https://northumbriasport.com/sport/rowing' },
        { slug: 'gone-club', name: 'Gone Club', url: 'https://northumbriasport.com/sport/gone-club', image: null }
      ]
    };
    assert.deepEqual(listChanges(last, list), {
      added: ['made-up-netball'], removed: ['gone-club'], renamed: ['abseiling'], pictures: ['pretend-rowing'], links: ['pretend-rowing'], order: true
    });
  }],
  ['Pages file changes: which clubs differ and in which parts, by slug; a missing name is the same whether null or empty', () => {
    const pagesFile = /** @type {import('./lib/sport-collect.mjs').PagesFile} */ (BUILT.pagesFile);
    const last = JSON.parse(JSON.stringify(pagesFile));
    last.clubs['pretend-rowing'].contacts[3].people[0].name = '';
    assert.deepEqual(pagesChanges(last, pagesFile), { same: 3, changed: [], added: [], removed: [] });
    last.clubs['pretend-rowing'].bookUrl = null;
    last.clubs['pretend-rowing'].about.pop();
    delete last.clubs.abseiling;
    last.clubs['old-club'] = { name: 'Old Club' };
    assert.deepEqual(pagesChanges(last, pagesFile), {
      same: 1, changed: [{ slug: 'pretend-rowing', parts: ['about', 'bookUrl'] }], added: ['abseiling'], removed: ['old-club']
    });
  }],
  ['The change summary: counts and slugs only', () => {
    const counts = { clubs: 38, requests: 39, pages: { withAbout: 38, withMembership: 36, contacts: 146, people: 155, socials: 54, withBookUrl: 38 } };
    const text = summaryText({ added: ['padel'], removed: [], renamed: [], pictures: ['archery', 'swimming'], links: [], order: true }, counts);
    assert.equal(text, [
      'Northumbria Sport lists 38 clubs (39 requests to northumbriasport.com).',
      'Club pages: 38 with about text, 36 with memberships and training, 146 contacts (155 people), 54 social links, 38 booking links.',
      '',
      'New clubs (1): padel',
      '',
      'Pictures changed (2): archery, swimming'
    ].join('\n'));
    const none = { added: [], removed: [], renamed: [], pictures: [], links: [] };
    assert.match(summaryText({ ...none, order: false }, { ...counts, pages: null }), /The list hasn't changed\.$/);
    assert.match(summaryText({ ...none, order: true }, { ...counts, pages: null }), /Only the order of the list has changed\.$/);
  }],
  ['Nothing is written with too few clubs, a club page that didn\'t read, or a pages file the import would refuse', () => {
    assert.deepEqual(checkBeforeWriting({ clubs: 38, unparsed: [], pageErrors: [] }), []);
    assert.equal(checkBeforeWriting({ clubs: MIN_CLUBS - 1, unparsed: [], pageErrors: [] }).length, 1);
    assert.match(checkBeforeWriting({ clubs: 38, unparsed: ['netball'], pageErrors: [] })[0], /netball/);
    assert.equal(checkBeforeWriting({ clubs: 38, unparsed: [], pageErrors: ['swimming.name: should be text'] }).length, 1);
  }],
  ['A refusal or challenge is spotted (the run stops on it); printed lines have emails masked', () => {
    const headers = (/** @type {Record<string, string>} */ values = {}) => ({ get: (/** @type {string} */ name) => values[name] ?? null });
    assert.equal(blockedReason(403, headers(), ''), 'answered 403');
    assert.equal(blockedReason(429, headers(), ''), 'answered 429');
    assert.equal(blockedReason(200, headers({ 'cf-mitigated': 'challenge' }), ''), 'sent a Cloudflare challenge');
    assert.equal(blockedReason(200, headers(), '<title>Just a moment...</title>'), 'sent a Cloudflare challenge page');
    assert.equal(blockedReason(200, headers(), ROWING_PAGE), null);
    assert.equal(maskEmails('ask sam@example.com'), 'ask [email]');
  }],
  ['The script refuses a pages file inside the repo, --compare without --pages, and no mode, before asking the site anything', () => {
    const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, ['scripts/collect-sport-clubs.mjs', ...args], { encoding: 'utf8', timeout: 10_000 });
    const inside = run(['--pages', 'scripts/sport-club-pages.json']);
    assert.equal(inside.status, 1);
    assert.match(inside.stdout, /inside the repo/);
    assert.doesNotMatch(inside.stdout, /Collecting/, 'stopped before any request');
    assert.equal(run(['--no-pages', '--compare', '/tmp/x.json']).status, 2);
    assert.equal(run([]).status, 2);
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
