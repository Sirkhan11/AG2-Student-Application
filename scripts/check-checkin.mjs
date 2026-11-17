// Checks the check-in chat's first message and what Gemini is told (src/lib/checkin/opener.js), and
// the crisis check that runs before anything is sent to Gemini (src/lib/checkin/safety.js).
// Nothing here needs Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-checkin.mjs

import assert from 'node:assert/strict';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { isCrisis } from '#lib/checkin/safety.js';
import { SOCIETY_LIST } from '#lib/checkin/chat-prompt.js';

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
