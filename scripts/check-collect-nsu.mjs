// Checks scripts/lib/nsu-collect.mjs, the offline part of collect-nsu-societies.mjs, with made-up
// data (no real society, person or address): reading NSU's A to Z page settings and API answers,
// society pages, the social link repairs, building the two files, the change summary, spotting a
// refusal or challenge, the checks before writing, and refusing to write the pages file inside the
// repo. Nothing here goes to the network.
//
// Run from the project folder:
//   node scripts/check-collect-nsu.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkSocietyPages } from './lib/society-pages.mjs';
import {
  blockedReason, buildFiles, cfDecode, checkBeforeWriting, cleanParagraph, EMAIL_NOTE, expandHome, fixSocialUrl,
  groupsFrom, groupsUrl, isInside, listChanges, maskEmails, membershipsByGroup, mergeSocials, parseSiteSettings,
  parseSocietyPage, platformOf, productsUrl, sameList, socialsInDescription, summaryText
} from './lib/nsu-collect.mjs';

/** Cloudflare's email encoding, for making test pages: a key byte, then every byte XORed with it. */
const cfEncode = (/** @type {string} */ email, key = 0x5a) =>
  [key, ...Buffer.from(email)].map((byte, i) => (i === 0 ? byte : byte ^ key).toString(16).padStart(2, '0')).join('');

// The inline script on NSU's A to Z page, cut down and made up.
const AZ_PAGE = `<html><body><script> var siteId = 'TestSite123'; var apiUrl = 'https://pluto.sums.digital/api';
  var categoryMap = { 'Academic': { newcastle: '41', london: '35' }, 'Recreational': { newcastle: '39', london: '40' },
  'Adopt a Society': { newcastle: '50', london: '38' } }; </script></body></html>`;
const SETTINGS = /** @type {NonNullable<ReturnType<typeof parseSiteSettings>>} */ (parseSiteSettings(AZ_PAGE));

// One page of the groups API's answer.
const GROUPS_JSON = {
  current_page: 1,
  next_page_url: null,
  data: [
    { id: 1, name: 'Made-Up Chess', thumbnail_url: 'https://cdn.example.test/group-thumbnails/1/logo.png', header_image_url: null, activity_category_id: 39, url_name: 'chess' },
    { id: 2, name: 'Pretend Hiking', thumbnail_url: null, header_image_url: null, activity_category_id: 41, url_name: 'hiking' },
    { id: 3, name: 'Pretend Drama', thumbnail_url: 'https://cdn.example.test/group-thumbnails/3/logo.png', header_image_url: null, activity_category_id: 40, url_name: 'drama' },
    { id: 4, name: '', activity_category_id: 39 }
  ]
};
const GROUPS = groupsFrom(GROUPS_JSON, SETTINGS.categories).groups;

const CHESS_PAGE = `<html><head><meta property="og:image" content="https://cdn.example.test/header-images/1/top.jpg"></head><body>
<h1 class="society-name">Made-Up Chess</h1>
<p class="breadcrumb-path">Home / A-Z / Recreational - Newcastle Campus</p>
<div id="section1"><div class="card-body">
  <p>We play chess every week, all levels welcome.</p>
  <ul><li><p>Casual games</p> and tournaments</li></ul>
  <p>Contact us: <a class="__cf_email__" data-cfemail="${cfEncode('hidden@example.org')}">[email&#160;protected]</a> or written@example.org</p>
  <p>Follow us on insta @madeup.chess and join chat.whatsapp.com/ABC123. Trips: www.nucotravel.com/trip</p>
</div></div>
<div class="society-social-links">
  <a href="https://instagram.com/instagram.com/madeup.chess?igsh=xyz&utm_source=qr">Instagram</a>
  <a href="http://old-site.example.test">Old site</a>
  <a title="Email Society" href="/cdn-cgi/l/email-protection#${cfEncode('Chess@Example.org')}">Email</a>
  <a href="/cdn-cgi/l/email-protection#${cfEncode('su.enquiries@example.org')}">NSU</a>
</div>
<footer><a href="https://instagram.com/nsu_footer">NSU</a></footer>
<img src="/images/group-thumbnails/1/logo.png">
<ul class="committee-list"></ul>
</body></html>`;

// A page that doesn't read as expected: no name or breadcrumb, NSU's placeholder picture, no description.
const ODD_PAGE = `<html><head><meta property="og:image" content="https://mynsu.co.uk/WebsiteImages/url_preview/nsu_preview.png"></head>
<body><div id="section1"><div class="card-body"><p>Hi!</p></div></div></body></html>`;

const PRODUCTS = [
  { name: 'Full Membership ', price: 5, group_name: 'Made-Up Chess', is_event_ticket: false },
  { name: 'Member ticket', price: 2, group_name: 'Made-Up Chess', is_event_ticket: false },
  { name: 'Membership', price: 3, group_name: 'Made-Up Chess', is_event_ticket: true },
  { name: 'Hoodie', price: 20, group_name: 'Made-Up Chess', is_event_ticket: false },
  { name: 'Membership', price: 0, group_name: 'pretend drama', is_event_ticket: false },
  { name: 'Membership', price: 4, group_name: 'Some Other Group', is_event_ticket: false }
];

const LAST_LIST = {
  source: 'https://mynsu.co.uk/Activities/home#find',
  collectedAt: '2026-11-17T11:53:47.492Z',
  count: 3,
  categories: ['Academic', 'Recreational'],
  societies: [
    { nsuId: 1, name: 'Made-Up Chess', category: 'Recreational', campus: 'Newcastle', url: 'https://mynsu.co.uk/activities/view/1', image: 'https://cdn.example.test/group-thumbnails/1/logo.png' },
    { nsuId: 2, name: 'Pretend Hiking', category: 'Academic', campus: 'Newcastle', url: 'https://mynsu.co.uk/activities/view/2', image: 'https://cdn.example.test/old-picture.png' },
    { nsuId: 9, name: 'Gone Away', category: 'Academic', campus: 'London', url: 'https://mynsu.co.uk/activities/view/9', image: null }
  ]
};

/** The made-up API answers and pages, built into the two files as a laptop run would. */
function build() {
  const pages = new Map([[1, parseSocietyPage(CHESS_PAGE, 1)], [2, parseSocietyPage(ODD_PAGE, 2)], [3, parseSocietyPage(CHESS_PAGE.replace('Made-Up Chess', 'Pretend Drama').replace('Newcastle Campus', 'London Campus'), 3)]]);
  const { memberships } = membershipsByGroup(PRODUCTS, GROUPS);
  return buildFiles(GROUPS, pages, memberships, LAST_LIST, '2026-11-18T10:00:00.000Z');
}

/** @type {[string, () => void][]} */
const checks = [
  ['NSU\'s A to Z page: the site id, and the category map (each id\'s category and campus), asking for every category but "Adopt a Society"', () => {
    assert.equal(SETTINGS.siteId, 'TestSite123');
    assert.deepEqual(SETTINGS.categories.get('40'), { category: 'Recreational', campus: 'London' });
    assert.deepEqual(SETTINGS.categories.get('50'), { category: 'Adopt a Society', campus: 'Newcastle' });
    assert.deepEqual(SETTINGS.requestIds, ['41', '35', '39', '40']);
    assert.equal(parseSiteSettings('<p>No script here</p>'), null);
    assert.equal(groupsUrl(SETTINGS.requestIds, 1), 'https://pluto.sums.digital/api/groups?perPage=300&page=1&sortBy=name&categoryIds=41%2C35%2C39%2C40');
    assert.equal(productsUrl(2), 'https://pluto.sums.digital/api/products?perPage=100&page=2');
  }],
  ['The society list from the API: id, name, https picture, and category and campus from the map; unknown categories reported', () => {
    assert.deepEqual(GROUPS.map((group) => [group.nsuId, group.name, group.category, group.campus, Boolean(group.thumbnail)]), [
      [1, 'Made-Up Chess', 'Recreational', 'Newcastle', true],
      [2, 'Pretend Hiking', 'Academic', 'Newcastle', false],
      [3, 'Pretend Drama', 'Recreational', 'London', true]
    ]);
    assert.deepEqual(groupsFrom({ data: [{ id: 7, name: 'X', activity_category_id: 99 }] }, SETTINGS.categories).unknownCategoryIds, ['99']);
  }],
  ['Memberships from the products list: matched on the society\'s API name, "member" products only, never tickets', () => {
    const { memberships, sharedNames } = membershipsByGroup(PRODUCTS, GROUPS);
    assert.deepEqual(memberships.get(1), [{ name: 'Full Membership', price: 5 }]);
    assert.deepEqual(memberships.get(2), []);
    assert.deepEqual(memberships.get(3), [{ name: 'Membership', price: 0 }], 'names match whatever their capitals');
    assert.deepEqual(sharedNames, []);
    const twins = membershipsByGroup(PRODUCTS, [...GROUPS, { nsuId: 8, name: 'made-up chess', thumbnail: null, category: null, campus: null }]);
    assert.deepEqual(twins.sharedNames, ['made-up chess']);
    assert.deepEqual(twins.memberships.get(1), [], 'a shared name is never guessed');
  }],
  ['A society page: name and breadcrumb, description leaves, links only from the society\'s own box, and its email decoded (not NSU\'s)', () => {
    const page = parseSocietyPage(CHESS_PAGE, 1);
    assert.equal(page.parsed, true);
    assert.equal(page.paragraphs.length, 4);
    assert.equal(page.paragraphs[1], 'Casual games and tournaments');
    assert.deepEqual(page.socialLinks, ['https://instagram.com/instagram.com/madeup.chess?igsh=xyz&utm_source=qr', 'http://old-site.example.test']);
    assert.deepEqual(page.emails, ['chess@example.org']);
    assert.equal(cfDecode(cfEncode('a.b@example.org', 0x13)), 'a.b@example.org');
    assert.equal(parseSocietyPage(ODD_PAGE, 2).parsed, false);
  }],
  ['Pictures: the API\'s thumbnail, else the page\'s; without pages (the workflow), a society with no thumbnail keeps its last picture', () => {
    const { list } = build();
    assert.equal(list.societies.find((society) => society.nsuId === 1)?.image, 'https://cdn.example.test/group-thumbnails/1/logo.png');
    assert.equal(list.societies.find((society) => society.nsuId === 2)?.image, null, 'the page only has NSU\'s placeholder');
    const headerOnly = parseSocietyPage(CHESS_PAGE.replace('<img src="/images/group-thumbnails/1/logo.png">', ''), 1);
    assert.equal(headerOnly.headerImage, 'https://cdn.example.test/header-images/1/top.jpg');
    const listOnly = buildFiles(GROUPS, null, null, LAST_LIST, '2026-11-18T10:00:00.000Z');
    assert.equal(listOnly.list.societies.find((society) => society.nsuId === 2)?.image, 'https://cdn.example.test/old-picture.png');
    assert.equal(listOnly.pagesFile, null, 'no pages file without pages');
  }],
  ['Social links: doubled addresses repaired, tracking removed, the description\'s links and handles added once, and no http', () => {
    assert.equal(fixSocialUrl('https://instagram.com/instagram.com/name'), 'https://instagram.com/name');
    assert.equal(fixSocialUrl('https://instagram.com/https://www.instagram.com/name/'), 'https://instagram.com/name');
    assert.equal(fixSocialUrl('https://example.test/page?igsh=1&keep=yes&utm_medium=x'), 'https://example.test/page?keep=yes');
    assert.equal(fixSocialUrl('https://example.test/page/'), 'https://example.test/page/', 'no query: left as it is');
    assert.deepEqual(socialsInDescription(['Insta: @our.soc!', 'Email a@b.example.org', 'www.nucotravel.com/x']), [
      { platform: 'instagram', url: 'https://instagram.com/our.soc' }
    ]);
    const { pagesFile } = build();
    assert.deepEqual(/** @type {any} */ (pagesFile?.societies['1']).socials, [
      { platform: 'instagram', url: 'https://instagram.com/madeup.chess' },
      { platform: 'whatsapp', url: 'https://chat.whatsapp.com/ABC123' }
    ]);
    assert.deepEqual(mergeSocials(['http://insecure.example.test'], []), []);
  }],
  ['Platforms are matched on the host properly ("dropbox.com" isn\'t X)', () => {
    assert.equal(platformOf('https://x.com/oursoc'), 'x');
    assert.equal(platformOf('https://www.dropbox.com/s/1'), 'website');
    assert.equal(platformOf('https://fb.me/oursoc'), 'facebook');
    assert.equal(platformOf('https://discord.gg/abc'), 'discord');
    assert.equal(platformOf('https://linktr.ee/oursoc'), 'linktree');
  }],
  ['Descriptions: emails replaced with a note (social handles stay), and a very short one counts as none', () => {
    assert.equal(cleanParagraph('Write to [email protected] or x.y@example.org'), `Write to ${EMAIL_NOTE} or ${EMAIL_NOTE}`);
    const { pagesFile } = build();
    const chess = /** @type {any} */ (pagesFile?.societies['1']);
    assert.ok(chess.description.every((/** @type {string} */ text) => !/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text)));
    assert.ok(chess.description[2].includes(EMAIL_NOTE));
    assert.ok(chess.description[3].includes('@madeup.chess'));
    assert.deepEqual(/** @type {any} */ (pagesFile?.societies['2']).description, []);
  }],
  ['The files: names kept from the last list, new ones from NSU, and the pages pass the import\'s checks', () => {
    const { list, pagesFile } = build();
    assert.deepEqual(list.societies.map((society) => [society.nsuId, society.name, society.category, society.campus]), [
      [1, 'Made-Up Chess', 'Recreational', 'Newcastle'],
      [3, 'Pretend Drama', 'Recreational', 'London'],
      [2, 'Pretend Hiking', 'Academic', 'Newcastle']
    ]);
    assert.deepEqual(list.categories, ['Academic', 'Recreational']);
    const chess = /** @type {any} */ (pagesFile?.societies['1']);
    assert.equal(chess.email, 'chess@example.org');
    assert.deepEqual(chess.memberships, [{ name: 'Full Membership', price: 5 }]);
    assert.ok(!('otherEmails' in chess), 'emails in descriptions aren\'t collected');
    const { errors, counts } = checkSocietyPages(pagesFile, new Set(list.societies.map((society) => society.nsuId)));
    assert.deepEqual(errors, []);
    assert.equal(counts.societies, 3);
  }],
  ['What changed: new and removed societies (with what to delete), possible renames; the date alone isn\'t a change', () => {
    const { list, possibleRenames } = build();
    assert.deepEqual(possibleRenames, []);
    const renamedGroups = groupsFrom({ data: [{ ...GROUPS_JSON.data[0], name: 'Made-Up Chess and Draughts' }] }, SETTINGS.categories).groups;
    const renamed = buildFiles(renamedGroups, null, null, LAST_LIST, '2026-11-18T10:00:00.000Z');
    assert.deepEqual(renamed.possibleRenames, [{ nsuId: 1, ours: 'Made-Up Chess', nsu: 'Made-Up Chess and Draughts' }]);
    assert.equal(renamed.list.societies[0].name, 'Made-Up Chess', 'our name is kept until a person changes it');
    const changes = listChanges(LAST_LIST, list, possibleRenames);
    assert.deepEqual(changes.added, ['Pretend Drama (Recreational, London), id 3']);
    assert.deepEqual(changes.removed, ['Gone Away, id 9: delete societies/9 in the Firestore console']);
    assert.deepEqual(changes.category, []);
    assert.equal(sameList(list, { ...list, collectedAt: '2030-01-01T00:00:00.000Z' }), true);
    assert.equal(sameList(LAST_LIST, list), false);
  }],
  ['Nothing printed holds an email or a description', () => {
    const { list, review, possibleRenames } = build();
    const pages = { parsed: 2, withDescription: 2, withEmail: 2, socials: 4, memberships: 2 };
    const printed = [summaryText(listChanges(LAST_LIST, list, possibleRenames), { societies: 3, requests: 9, pages }), ...review].join('\n');
    assert.ok(!/@/.test(printed), 'no email');
    assert.ok(!printed.includes('chess every week'), 'no description');
    assert.ok(printed.includes('9 requests'));
    assert.equal(maskEmails('reach me at someone@example.org'), 'reach me at [email]');
  }],
  ['A refusal or challenge stops the run; Cloudflare\'s script on an ordinary page doesn\'t', () => {
    const none = { get: () => null };
    for (const status of [403, 429, 503]) assert.ok(blockedReason(status, none, ''), String(status));
    assert.ok(blockedReason(200, { get: (/** @type {string} */ name) => (name === 'cf-mitigated' ? 'challenge' : null) }, ''));
    assert.ok(blockedReason(200, none, '<html><title>Just a moment...</title></html>'));
    assert.ok(blockedReason(200, none, '<script>window._cf_chl_opt={}</script>'));
    assert.equal(blockedReason(200, none, '<html><title>Chess</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>'), null);
    assert.equal(blockedReason(404, none, 'Not found'), null, 'other failures are handled as failures, not blocks');
  }],
  ['Checks before writing: at least 140 societies, 95% of pages read as expected (when read), and the import\'s checks', () => {
    assert.deepEqual(checkBeforeWriting({ societies: 154, parsed: 150, pageErrors: [] }), []);
    assert.deepEqual(checkBeforeWriting({ societies: 154, parsed: null, pageErrors: [] }), [], 'no pages read, so nothing to check there');
    assert.equal(checkBeforeWriting({ societies: 120, parsed: null, pageErrors: [] }).length, 1);
    assert.equal(checkBeforeWriting({ societies: 154, parsed: 140, pageErrors: [] }).length, 1);
    assert.equal(checkBeforeWriting({ societies: 154, parsed: 154, pageErrors: ['64.name: should be text'] }).length, 1);
  }],
  ['The pages file is refused inside the repo, even through a symbolic link; ~ means the home folder', () => {
    const repo = resolve('.');
    assert.equal(isInside(join(repo, 'pages.json'), repo), true);
    assert.equal(isInside(join(repo, 'not-yet', 'made', 'pages.json'), repo), true);
    assert.equal(isInside(join(homedir(), 'Downloads', 'nsu-refresh-test', 'pages.json'), repo), false);
    const outside = mkdtempSync(join(tmpdir(), 'nsu-collect-check-'));
    try {
      symlinkSync(repo, join(outside, 'link-to-repo'));
      assert.equal(isInside(join(outside, 'link-to-repo', 'pages.json'), repo), true);
      assert.equal(isInside(join(outside, 'pages.json'), repo), false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    assert.equal(expandHome('~/Downloads/x.json'), join(homedir(), 'Downloads', 'x.json'));
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
