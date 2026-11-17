// Checks the check-in chat's first message and what Gemini is told (src/lib/checkin/opener.js), and
// the crisis check that runs before anything is sent to Gemini (src/lib/checkin/safety.js).
// Nothing here needs Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-checkin.mjs

import assert from 'node:assert/strict';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { isCrisis } from '#lib/checkin/safety.js';
import { SERVICE_LIST, SOCIETY_LIST } from '#lib/checkin/chat-prompt.js';
import { linksInReply, MAX_LINKS } from '#lib/checkin/reply-links.js';
import { startsAfresh } from '#lib/checkin/keep-chat.js';
import { SERVICES } from '#lib/nsu/services.js';
import { SOCIETIES } from '#lib/societies/societies.js';

/** The five default tasks (see src/lib/checkin/saved-checklist.js), with the given ids ticked. @param {string[]} [done] */
const tasks = (done = []) =>
  [
    ['gp', 'Register with a GP'],
    ['student-id', 'Collect student ID'],
    ['society', 'Join a society'],
    ['dentist', 'Find a dentist'],
    ['contacts', 'Save key contacts']
  ].map(([id, title]) => ({ id, title, done: done.includes(id) }));
const allDone = ['gp', 'student-id', 'society', 'dentist', 'contacts'];
const matched = /** @type {const} */ ({
  status: 'matched', mentorId: 'm1', mentorName: 'Alex', reasons: [], meetingFrequency: 'weekly', availability: null
});
const waiting = /** @type {const} */ ({ status: 'coordinator', meetingFrequency: 'weekly', availability: null });

/** @type {[string, () => void][]} */
const checks = [
  // ---------- The first message ----------
  ['Just matched, nothing ticked: mentor news, then a society question and 3 tasks by name', () => {
    const { messages, links } = buildOpener({ match: matched, tasks: tasks(), justSignedUp: true });
    assert.equal(messages[0], 'Thanks for answering those questions. You’ve been matched with Alex, and your coordinator will introduce you. While you wait, how’s your day been?');
    assert.equal(messages[1], 'Have you joined a society yet? I can see on your checklist that you haven’t registered with a GP, collected your student ID or found a dentist yet, plus 1 other task. Would you like help with any of these?');
    assert.deepEqual(links.map((link) => link.label), ['Your mentor', 'Find a GP or dentist', 'Browse societies', 'Open your checklist']);
  }],
  ['Waiting for the coordinator, only the GP left: "help with that", one GP button', () => {
    const { messages, links } = buildOpener({ match: waiting, tasks: tasks(['student-id', 'society', 'dentist', 'contacts']), justSignedUp: false });
    assert.equal(messages[0], 'Hi! We’re finding you a mentor, and we’ll let you know soon. While you wait, how’s your day been?');
    assert.equal(messages[1], 'I can see on your checklist that you haven’t registered with a GP yet. Would you like help with that?');
    assert.deepEqual(links.map((link) => link.label), ['Find a GP', 'Open your checklist']);
  }],
  ['Only a society left: "help finding one"', () => {
    const { messages } = buildOpener({ match: waiting, tasks: tasks(['gp', 'student-id', 'dentist', 'contacts']), justSignedUp: false });
    assert.equal(messages[1], 'Have you joined a society yet? Would you like help finding one?');
  }],
  ['Everything ticked: well done, and no task buttons', () => {
    const { messages, links } = buildOpener({ match: waiting, tasks: tasks(allDone), justSignedUp: false });
    assert.equal(messages[1], 'I can see your checklist’s all done. Nice work!');
    assert.deepEqual(links, []);
  }],
  ['Only their own tasks left: counted, not named', () => {
    const own = [{ id: 'own-1', title: 'Call home about rent', done: false }, { id: 'own-2', title: 'Buy a desk lamp', done: false }];
    const { messages } = buildOpener({ match: waiting, tasks: [...tasks(allDone), ...own], justSignedUp: false });
    assert.equal(messages[1], 'I can see you’ve got 2 tasks left on your checklist. Would you like help with any of these?');
  }],
  ['No mentor request yet: suggests one, with a Find a mentor button', () => {
    const { messages, links } = buildOpener({ match: null, tasks: tasks(allDone), justSignedUp: false });
    assert.equal(messages[0], 'Hi! How’s your day been? If you’d like a student mentor, you can answer a few questions to be matched.');
    assert.equal(links[0].href, '/find-mentor');
  }],
  ['Nothing could be loaded: just a greeting', () => {
    assert.deepEqual(buildOpener({ match: undefined, tasks: null, justSignedUp: false }), { messages: ['Hi! How’s your day been?'], links: [] });
  }],

  // ---------- What Gemini is told ----------
  ['Gemini knows they have a mentor (and to point to Your Mentor), but never the name or their own task titles', () => {
    const own = [{ id: 'own-1', title: 'Call home about rent', done: false }];
    const about = describeForGemini({ match: matched, tasks: [...tasks(['society']), ...own] });
    assert.ok(!about.includes('Alex'), 'mentor name leaked');
    assert.ok(!about.includes('rent'), 'own task title leaked');
    assert.match(about, /Checklist, not done yet: Register with a GP, Collect student ID, Find a dentist, Save key contacts\./);
    assert.match(about, /Checklist, done: Join a society\./);
    assert.match(about, /1 task of their own still to do/);
    assert.match(about, /they have one/, 'Gemini is told they have a mentor');
    assert.match(about, /Your Mentor page/, 'and where to see who it is');
  }],
  // ---------- The crisis check ----------
  ['Crisis phrases are caught, including with a phone\'s curly apostrophe', () => {
    for (const text of [
      'I want to die',
      'I’ve been self-harming again',
      'I don’t want to be here anymore',
      'I keep thinking about suicide',
      'I feel like ending it all',
      'I don\'t feel safe at home',
      'I think I\'m in danger'
    ]) assert.equal(isCrisis(text), true, text);
  }],
  // ---------- The societies Gemini may suggest ----------
  ['Gemini\'s society list: one per line, with categories and group notes, and no women-only societies', () => {
    const lines = SOCIETY_LIST.split('\n');
    assert.ok(lines.includes('Climbing (Recreational Sport)'));
    assert.ok(lines.includes('Ukrainian (International and Cultural; Ukrainian community, everyone welcome)'));
    assert.ok(lines.includes('Christian Union (Faith and Belief; for Christians)'));
    assert.ok(!SOCIETY_LIST.includes('Girls Who Run') && !SOCIETY_LIST.includes('Women in Business'));
    assert.ok(!SOCIETY_LIST.includes('Nigerian (International and Cultural; for the Nigerian community)\nNigerian'), 'London societies are left out');
  }],
  ['Gemini\'s services list: groups and summaries, the Advice Centre\'s topics, and no Freshers Week wristband', () => {
    const lines = SERVICE_LIST.split('\n');
    assert.equal(lines.length, 20, 'the 21 services minus the wristband');
    assert.ok(lines.some((line) => line.startsWith('Food Pantry (Money and food): ')));
    assert.ok(lines.some((line) => line.startsWith('Advice Centre (Help and advice): ') && line.includes('Topics: ') && line.includes('Academic misconduct')));
    assert.ok(!SERVICE_LIST.includes('Freshers'));
  }],

  // ---------- Keeping the conversation when they visit another page ----------
  ['The chat keeps its conversation when they come back, but starts afresh for someone else, after logging out, or after Find a mentor', () => {
    const back = { keptUid: 'student-1', started: true, uid: 'student-1', fromFindMentor: false };
    assert.equal(startsAfresh(back), false, 'the same student coming back');
    assert.equal(startsAfresh({ ...back, started: false }), true, 'nothing kept yet');
    assert.equal(startsAfresh({ ...back, uid: 'student-2' }), true, 'someone else logged in');
    assert.equal(startsAfresh({ ...back, keptUid: null }), true, 'cleared when they logged out');
    assert.equal(startsAfresh({ ...back, fromFindMentor: true }), true, 'they\'ve just asked for a mentor');
  }],

  // ---------- Turning a reply's [[Name]]s into links ----------
  ['Each link says which society or service it is (for its card); societies open in the app, services on NSU\'s site, Societies at /societies', () => {
    const { text, links } = linksInReply('Try [[Climbing]], the [[Food Pantry]] and [[Societies]].', 'Newcastle');
    assert.equal(text, 'Try Climbing, the Food Pantry and Societies.');
    assert.deepEqual(links, [
      { label: 'Climbing', href: '/societies/15', external: false, kind: 'society', nsuId: 15 },
      { label: 'Food Pantry', href: 'https://mynsu.co.uk/foodpantry', external: true, kind: 'service', serviceId: 'food-pantry' },
      { label: 'Societies', href: '/societies', external: false, kind: 'service', serviceId: 'societies' }
    ]);
  }],
  ['Made-up names stay plain text; plain words like "music" never become links; each link once', () => {
    const { text, links } = linksInReply('[[Music]] and [[music]], or [[Underwater Basket Weaving]]. I love music.', 'Newcastle');
    assert.equal(text, 'Music and Music, or Underwater Basket Weaving. I love music.');
    assert.deepEqual(links.map((link) => link.label), ['Music']);
  }],
  [`At most ${MAX_LINKS} links (so at most ${MAX_LINKS} cards), societies and services together`, () => {
    const { links } = linksInReply('[[Music]], [[Gigs]], [[Rock]], [[Events]], [[Film]]', 'Newcastle');
    assert.equal(links.length, MAX_LINKS);
    assert.ok(links.every((link) => link.kind === 'society' || link.kind === 'service'));
  }],
  ['Never linked, whatever Gemini writes: a women-only society, or the Freshers Week wristband', () => {
    const { text, links } = linksInReply('Maybe [[Girls Who Run]] or the [[Freshers Week wristband]].', 'Newcastle');
    assert.equal(text, 'Maybe Girls Who Run or the Freshers Week wristband.');
    assert.deepEqual(links, []);
  }],
  ['No service has the same name as a society, so a [[Name]] can only mean one thing', () => {
    const societies = new Set(SOCIETIES.map((society) => society.name.toLowerCase()));
    assert.deepEqual(SERVICES.filter((service) => societies.has(service.name.toLowerCase())).map((service) => service.name), []);
  }],
  ['Everyday phrases are not', () => {
    for (const text of [
      'This essay is killing me',
      'I\'m in danger of failing my module',
      'I\'m dying to try the climbing society',
      'Had a really good day, thanks',
      'Not sure which society to join'
    ]) assert.equal(isCrisis(text), false, text);
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
