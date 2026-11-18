// Checks the check-in chat's first message and what Gemini is told (src/lib/checkin/opener.js), the
// crisis check that runs before anything is sent to Gemini (src/lib/checkin/safety.js), how each
// JSON reply is checked before the student sees it (chat-replies.js), how the chat answers when
// Gemini fails (src/lib/checkin/chat-turns.js, with made-up models), and its checklist reminders
// (src/lib/checkin/task-suggestions.js, with a made-up checklist store). The short list of
// suggestions has its own check (check-shortlist.mjs).
// Nothing here needs Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-checkin.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOpener, describeForGemini, tidyProfile } from '#lib/checkin/opener.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isCrisis } from '#lib/checkin/safety.js';
import { chatRequest, CHAT_PAGES } from '#lib/checkin/chat-prompt.js';
import { MAX_LINKS, NOT_REMEMBERED, readChatReply, REMINDER_OFFER, tidySay } from '#lib/checkin/chat-replies.js';
import { FINDER_LINES } from '#lib/checklist/how-to.js';
import { startsAfresh } from '#lib/checkin/keep-chat.js';
import { chatWith, ERROR_MESSAGE, UNAVAILABLE_MESSAGE } from '#lib/checkin/chat-turns.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import { APP_PAGES, findPage } from '#lib/checkin/app-pages.js';
import { transitionFor, WAIT_FOR_CHAT_MS } from '#lib/page-transitions.js';
import { suggestionNamed } from '#lib/suggestions/catalogue.js';
import { shortlist } from '#lib/suggestions/shortlist.js';
import { addSuggestedTask, existingTask, sameTask, stateFor } from '#lib/checkin/task-suggestions.js';
import { ChecklistError, defaultTasks, MAX_TASKS } from '#lib/checklist/tasks.js';

/** The five default tasks (see DEFAULT_TASKS in src/lib/checklist/tasks.js), with the given ids ticked. @param {string[]} [done] */
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

/** A made-up Gemini reply, as JSON. @param {Record<string, unknown>} reply */
const json = (reply) => JSON.stringify({ action: 'none', page: 'none', ...reply });
/** A short list, as the app would pick it, for these names. @param {string[]} names */
const listOf = (names) => names.map((name) => ({ suggestion: /** @type {import('#lib/suggestions/catalogue.js').Suggestion} */ (suggestionNamed(name)), why: ['they said "x"'] }));
/** Facts for a made-up chat with no records. */
const noFacts = { match: null, tasks: null };

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  // ---------- The first message ----------
  ['Matched, with tasks left: the mentor news, then the first task still to do as the only question, with no task page buttons', () => {
    const { messages, links, asks } = buildOpener({ match: matched, tasks: tasks(), justSignedUp: false });
    assert.deepEqual(messages, ['Hi! You’ve been matched with Alex, and your coordinator will introduce you.', 'Let’s go through your checklist, one task at a time. Have you registered with a GP yet?']);
    assert.equal(asks, 'gp');
    assert.deepEqual(links.map((link) => link.label), ['Your mentor']);
  }],
  ['Straight after finding a mentor: no checklist question (the chat’s next message asks something), and no day question', () => {
    const { messages, asks } = buildOpener({ match: matched, tasks: tasks(), justSignedUp: true });
    assert.deepEqual(messages, ['Thanks for answering those questions. You’ve been matched with Alex, and your coordinator will introduce you.']);
    assert.equal(asks, null);
  }],
  ['Waiting for the coordinator, only a society left: the question about it', () => {
    const { messages, links, asks } = buildOpener({ match: waiting, tasks: tasks(['gp', 'student-id', 'dentist', 'contacts']), justSignedUp: false });
    assert.deepEqual(messages, ['Hi! We’re finding you a mentor, and we’ll let you know soon.', 'Let’s go through your checklist, one task at a time. Have you joined a society yet?']);
    assert.deepEqual([links, asks], [[], 'society']);
  }],
  ['Everything ticked: well done, how’s your day been, and no task buttons', () => {
    const { messages, links, asks } = buildOpener({ match: waiting, tasks: tasks(allDone), justSignedUp: false });
    assert.deepEqual(messages, ['Hi! We’re finding you a mentor, and we’ll let you know soon. While you wait, how’s your day been?', 'I can see your checklist’s all done. Nice work!']);
    assert.deepEqual([links, asks], [[], null]);
  }],
  ['Only their own tasks left: asked about the first, in their words on screen, never in Gemini’s copy', () => {
    const own = [...tasks(allDone), { id: 'own-1', title: 'Call home about rent', done: false }];
    assert.equal(buildOpener({ match: waiting, tasks: own, justSignedUp: false }).messages.at(-1), 'Let’s go through your checklist, one task at a time. Have you done “Call home about rent” yet?');
    assert.doesNotMatch(buildOpener({ match: waiting, tasks: own, justSignedUp: false, forGemini: true }).messages.join(' '), /rent/);
  }],
  ['No mentor request yet: suggests one, with a Find a mentor button, and no second question when there’s a task to ask about', () => {
    const done = buildOpener({ match: null, tasks: tasks(allDone), justSignedUp: false });
    assert.equal(done.messages[0], 'Hi! How’s your day been? If you’d like a student mentor, you can answer a few questions to be matched.');
    assert.equal(done.links[0].href, '/find-mentor');
    const left = buildOpener({ match: null, tasks: tasks(), justSignedUp: false });
    assert.equal(left.messages[0], 'Hi! If you’d like a student mentor, you can answer a few questions to be matched.');
    assert.equal(left.messages.join(' ').match(/\?/g)?.length, 1);
  }],
  ['Nothing could be loaded: just a greeting', () => {
    assert.deepEqual(buildOpener({ match: undefined, tasks: null, justSignedUp: false }), { messages: ['Hi! How’s your day been?'], links: [], asks: null });
  }],
  ['Not a mentor, nothing known about a match, but tasks left: one message with the question', () => {
    assert.deepEqual(buildOpener({ match: undefined, tasks: tasks(), justSignedUp: false }).messages, ['Hi! Let’s go through your checklist, one task at a time. Have you registered with a GP yet?']);
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
  ['A checklist they\'ve never saved: the first message asks about the first task (claiming nothing), and Gemini is told not to say they haven\'t done things', () => {
    const { messages } = buildOpener({ match: null, tasks: tasks(), checklistSaved: false, justSignedUp: false });
    assert.equal(messages.at(-1), 'Let’s go through your checklist, one task at a time. Have you registered with a GP yet?');
    assert.ok(!messages.join(' ').includes('haven’t registered'), 'no claim about what they haven\'t done');
    const about = describeForGemini({ match: null, tasks: tasks(), checklistSaved: false });
    assert.match(about, /haven’t ticked anything off yet, and may not have opened it/);
    assert.ok(!about.includes('Checklist, not done yet'));
  }],
  ['Gemini knows why they were matched, how often they asked to meet, and the course and interests from sign-up', () => {
    const match = { ...matched, reasons: ['You share interests: gigs', 'You like similar weekends: cinema'], meetingFrequency: 'every two weeks' };
    const about = describeForGemini({ match, tasks: null, profile: { course: ' BA  English ', interests: [' reading', '', 'Reading', 'gigs'] } });
    assert.match(about, /Why the app matched them \(they see the same reasons on the Your Mentor page\): You share interests: gigs; You like similar weekends: cinema\./);
    assert.match(about, /How often they asked to meet their mentor: every two weeks\./);
    assert.match(about, /Their course \(from when they signed up\): BA English\./);
    assert.match(about, /Interests they gave when they signed up: reading, gigs\./);
    assert.match(describeForGemini({ match: { ...matched, reasons: [] }, tasks: null }), /Why the app matched them: not recorded/);
    const waiting = describeForGemini({ match: { status: 'coordinator', meetingFrequency: 'weekly', availability: null }, tasks: null });
    assert.match(waiting, /How often they asked to meet their mentor: weekly\./);
    assert.ok(!/Why the app matched them/.test(waiting), 'no reasons before there\'s a match');
  }],
  ['Gemini is never told a name, an email, the mentor\'s id or their availability note, whatever the records hold', () => {
    const match = {
      ...matched,
      mentorId: 'mentor-id-123',
      mentorName: 'Morgan Testperson',
      reasons: ['You share interests: gigs, write to morgan@example.org'],
      meetingFrequency: 'weekly',
      availability: 'Tuesday evenings, text 07700 900123'
    };
    const profile = /** @type {any} */ ({ course: 'Law', interests: ['chess', 'me@example.org'], name: 'Sam Student', email: 'sam@example.org' });
    const about = describeForGemini({ match, tasks: null, profile });
    for (const secret of ['Morgan', 'Testperson', 'mentor-id-123', 'Tuesday', '07700', 'example.org', 'Sam Student']) {
      assert.ok(!about.includes(secret), `${secret} leaked`);
    }
    assert.match(about, /\[email\]/, 'an email typed into a record is blanked, not passed on');
  }],
  ['Sign-up details are tidied: interests from a list or a comma list, trimmed, no blanks or repeats, at most 10, kept short', () => {
    assert.deepEqual(tidyProfile({ course: '', interests: 'chess, gigs,, Chess , films' }), { course: null, interests: ['chess', 'gigs', 'films'] });
    assert.equal(tidyProfile({ interests: Array.from({ length: 15 }, (_, i) => `interest ${i}`) }).interests.length, 10);
    assert.equal(tidyProfile({ interests: ['y'.repeat(100)] }).interests[0].length, 40);
    assert.deepEqual(tidyProfile(null), { course: null, interests: [] });
    assert.equal(blankContactDetails('call 07700 900123 or a.b@example.org'), 'call [phone number] or [email]');
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
  // ---------- What Gemini is told about what it may suggest ----------
  ['Each suggestion is told with what it is: a society’s category and notes, a club, a service’s group, summary and topics', () => {
    assert.equal(suggestionNamed('Climbing')?.about, "a Students' Union society (Recreational Sport)");
    assert.equal(suggestionNamed('Conservation of Fine Art')?.about, "a Students' Union society (Academic; conserving artworks)");
    assert.equal(suggestionNamed('Ukrainian')?.about, "a Students' Union society (International and Cultural; Ukrainian community, everyone welcome)");
    assert.equal(suggestionNamed('Christian Union')?.about, "a Students' Union society (Faith and Belief; for Christians: only for someone who has said they are)");
    assert.match(String(suggestionNamed('Swimming')?.about), /^a Northumbria Sport club \(joining needs a paid membership/);
    assert.match(String(suggestionNamed('Food Pantry')?.about), /^an NSU service \(Money and food\): /);
    assert.match(String(suggestionNamed('Advice Centre')?.about), /It covers: .*Academic misconduct/);
    assert.equal(suggestionNamed('Girls Who Run'), null, 'women-only societies are never suggested');
    assert.equal(suggestionNamed('Freshers Week wristband'), null);
  }],
  ['Gemini is told only this turn\'s short list, with why each is on it, and the schema allows no other name', () => {
    const list = shortlist({ message: 'I love swimming' });
    const request = chatRequest({ about: '(about)', opener: ['(opener)'], shortlist: list, options: { mentor: 'no', checklist: 'no', hasMentor: false } });
    assert.match(request.systemInstruction, /You may suggest:\n- Swimming: a Northumbria Sport club .*Picked because: they said "swimming"\./);
    assert.ok(!request.systemInstruction.includes('Climbing'), 'nothing that isn\'t on the list');
    const schema = /** @type {any} */ (request.generationConfig.responseSchema);
    assert.deepEqual(schema.properties.suggest.items.enum, list.map(({ suggestion }) => suggestion.name));
    assert.equal(schema.properties.suggest.maxItems, 3);
    assert.deepEqual(schema.propertyOrdering.at(-1), 'say', 'the words come after the decisions');
    const none = chatRequest({ about: '(about)', opener: ['(opener)'], shortlist: [], options: { mentor: 'no', checklist: 'no', hasMentor: false } });
    assert.equal(/** @type {any} */ (none.generationConfig.responseSchema).properties.suggest, undefined, 'nothing to suggest: no suggest at all');
    assert.match(none.systemInstruction, /You may suggest:\n\(none this time\)/);
  }],
  ['Only the actions the app allows now are offered: a mentor only without one, their mentor only when matched, the checklist only with tasks left', () => {
    const actions = (/** @type {any} */ options) => chatRequest({ about: '', opener: [], shortlist: [], options }).actions;
    const always = ['gp-finder', 'dentist-finder', 'contacts', 'ask4help'];
    const checklist = ['tick', 'untick', 'add-task', 'remove-task', 'reminder', 'calendar'];
    assert.deepEqual(actions({ mentor: 'yes', checklist: 'yes', hasMentor: false }), [...checklist, 'checklist', 'checklist-offer', ...always, 'mentor', 'remember', 'offer-to-remember']);
    assert.deepEqual(actions({ mentor: 'no', checklist: 'no', hasMentor: true, checklistKnown: false }), [...always, 'your-mentor', 'change-mentor', 'remember', 'offer-to-remember'], 'no checklist: nothing to change on it');
    assert.ok(actions({ mentor: 'no', checklist: 'no', hasMentor: false, ownTasks: true }).includes('rename-task'), 'renaming only with tasks of their own');
    assert.ok(actions({ mentor: 'no', checklist: 'no', hasMentor: false, notes: ['Likes salsa'] }).includes('forget'), 'forgetting only with something remembered');
    assert.ok(actions({ mentor: 'no', checklist: 'no', hasMentor: false, howTo: ['Enrol: online'] }).includes('how-to'));
    const asked = chatRequest({ about: '', opener: [], shortlist: [], options: { mentor: 'if-asked', checklist: 'if-asked', hasMentor: false } }).systemInstruction;
    assert.equal(asked.match(/they said not now earlier, so only if they ask/gi)?.length, 2);
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

  // ---------- Reading a reply: only what the app allowed ----------
  ['Each card says which society, club or service it is; societies and clubs open in the app, services on NSU\'s site, Societies at /societies', () => {
    const reply = readChatReply(json({ suggest: ['Climbing', 'Food Pantry', 'Societies'], say: 'Try Climbing, the Food Pantry or Societies.' }), { shortlist: listOf(['Climbing', 'Food Pantry', 'Societies']), actions: [] });
    assert.deepEqual(reply?.links, [
      { label: 'Climbing', href: '/societies/15', external: false, kind: 'society', nsuId: 15 },
      { label: 'Food Pantry', href: 'https://mynsu.co.uk/foodpantry', external: true, kind: 'service', serviceId: 'food-pantry' },
      { label: 'Societies', href: '/societies', external: false, kind: 'service', serviceId: 'societies' }
    ]);
    const club = readChatReply(json({ suggest: ['Swimming'], say: 'Swimming.' }), { shortlist: listOf(['Swimming']), actions: [] });
    assert.deepEqual(club?.links, [{ label: 'Swimming', href: '/sport/swimming', external: false, kind: 'club', slug: 'swimming' }]);
  }],
  ['A name that isn\'t on this turn\'s short list never becomes a card, however it\'s written; each once', () => {
    const reply = readChatReply(json({ suggest: ['Climbing', 'climbing', 'Underwater Basket Weaving', 'Girls Who Run', 'Cost of Location', 'Music'], say: 'Ideas.' }), { shortlist: listOf(['Climbing', 'Film']), actions: [] });
    assert.deepEqual(reply?.links.map((link) => link.label), ['Climbing']);
    assert.deepEqual(reply?.suggested, ['Climbing']);
  }],
  [`At most ${MAX_LINKS} links, cards and the page button together`, () => {
    const many = readChatReply(json({ suggest: ['Film', 'Swimming', 'Food Pantry', 'Music'], page: 'NHS Guide', say: 'Ideas.' }), { shortlist: listOf(['Film', 'Swimming', 'Food Pantry', 'Music']), actions: [] });
    assert.deepEqual(many?.links.map((link) => link.label), ['Film', 'Swimming', 'Food Pantry']);
  }],
  ['A page is a button under the reply, only for what the chat can’t show itself: never the Checklist, the GP finder, their mentor or what it knows', () => {
    const page = (/** @type {string} */ name) => readChatReply(json({ page: name, say: 'See here.' }), { shortlist: [], actions: [] })?.links ?? [];
    assert.deepEqual(page('NHS Guide'), [{ label: 'NHS Guide', href: '/nhs-guide', external: false }]);
    for (const name of ['Checklist', 'GP Finder', 'Your Mentor', 'What the chat knows', 'Find a mentor']) assert.deepEqual(page(name), [], name);
    assert.deepEqual(CHAT_PAGES, ['NHS Guide', 'Need Help Now']);
    assert.equal(findPage('  need   HELP now '), APP_PAGES.find((page) => page.href === '/need-help'));
  }],
  ['Only an action the app allowed counts; a task must be one really on their checklist; a reminder must fit; a note must pass the screen', () => {
    const list = defaultTasks();
    const read = (/** @type {Record<string, unknown>} */ reply, actions = ['reminder', 'remember', 'mentor', 'tick', 'add-task', 'forget', 'how-to']) =>
      readChatReply(json({ say: 'Okay.', ...reply }), { shortlist: [], actions, tasks: list, notes: ['Likes salsa'] })?.action ?? null;
    assert.deepEqual(read({ action: 'mentor' }), { id: 'mentor' });
    assert.equal(read({ action: 'your-mentor' }), null, 'not allowed this turn');
    assert.deepEqual(read({ action: 'tick', task: 'Join a society' }), { id: 'tick', taskId: 'society' });
    assert.deepEqual(read({ action: 'tick', task: 'one of their own' }), { id: 'tick', own: true }, 'matched by the app, on their words');
    assert.deepEqual(read({ action: 'tick', task: 'Learn Mandarin' }), { id: 'tick' }, 'not on their checklist: the app asks which');
    assert.deepEqual(read({ action: 'add-task', title: ' "Open a bank account." ' }), { id: 'add-task', title: 'Open a bank account' });
    assert.deepEqual(read({ action: 'reminder', title: ' "Buy a bus pass." ' }), { id: 'reminder', text: 'Buy a bus pass' });
    assert.equal(read({ action: 'reminder', title: `Do ${'x'.repeat(100)}` }), null, 'too long for the checklist');
    assert.equal(read({ action: 'reminder', title: 'Call [phone number]' }), null, 'a blanked contact detail');
    assert.deepEqual(read({ action: 'remember', note: 'Plans the week every Sunday' }), { id: 'remember', text: 'Plans the week every Sunday' });
    assert.equal(read({ action: 'remember', note: 'Worried about money' }), null, 'never money or worries');
    assert.deepEqual(read({ action: 'forget', forget: 'Likes salsa' }), { id: 'forget', which: 'Likes salsa' });
    assert.equal(read({ action: 'forget', forget: 'Something else' }), null, 'only what it remembers');
    assert.deepEqual(read({ action: 'how-to', task: 'Enrol' }), { id: 'how-to', taskId: 'enrol' });
    assert.equal(readChatReply(json({ action: 'remember', note: 'Has asthma', say: 'Sure!' }), { shortlist: [], actions: ['remember'] })?.say, NOT_REMEMBERED);
  }],
  ['Finding a GP or dentist always comes with the app’s own words on how it works, so the chat never refuses it', () => {
    const say = (/** @type {string} */ id) => readChatReply(json({ action: id, say: 'I cannot tell you where the closest dentist is.' }), { shortlist: [], actions: [id] })?.say;
    assert.equal(say('dentist-finder'), FINDER_LINES.dentist);
    assert.equal(say('gp-finder'), FINDER_LINES.gp);
    const instructions = chatRequest({ about: '', opener: [], shortlist: [], options: { mentor: 'no', checklist: 'no', hasMentor: false } }).systemInstruction;
    assert.match(instructions, /Finding a GP, a dentist or any other service isn't medical advice: never refuse it\./);
    assert.match(instructions, /Everything the app can do is an action below, from any message, so never send them to a page or tell them to tap something to do it\./);
    assert.doesNotMatch(instructions, /only (when|their) (the student )?taps?|only their tap/i, 'no rule that only their tap can do it');
  }],
  ['The student never sees a marker, and a last sentence offering to remember goes (the card asks that); "Remember to…" stays', () => {
    assert.equal(tidySay('See [[Checklist and {{task: x}} [[Film]]. {{mentor}}'), 'See Checklist and Film.');
    const say = (/** @type {string} */ text, action = 'none') => readChatReply(json({ action, note: 'Plans on Sundays', say: text }), { shortlist: [], actions: ['offer-to-remember'] })?.say;
    assert.equal(say('Nice plan! Want me to remember that for next time?', 'offer-to-remember'), 'Nice plan!');
    assert.equal(say('Nice plan! I can remember that if you like.'), 'Nice plan!');
    assert.equal(say('Remember to bring photo ID.'), 'Remember to bring photo ID.');
  }],
  ['A reply that isn\'t JSON, or has nothing to say or show, isn\'t read as a reply', () => {
    assert.equal(readChatReply('Hello there.', { shortlist: [], actions: [] }), null);
    assert.equal(readChatReply('[]', { shortlist: [], actions: [] }), null);
    assert.equal(readChatReply(json({ say: '  ' }), { shortlist: [], actions: [] }), null);
    assert.deepEqual(readChatReply(json({ action: 'mentor', say: '' }), { shortlist: [], actions: ['mentor'] })?.action, { id: 'mentor' }, 'a card on its own is fine');
  }],
  ['Every page change animates: the chat grows out of where they tapped, the bar’s pages crossfade, deeper pages slide; with Reduce Motion, a short fade', () => {
    assert.equal(transitionFor('/home', '/check-in'), 'chat');
    assert.equal(transitionFor('/checklist', '/check-in'), 'chat', 'from any page, not only Home');
    assert.equal(transitionFor('/home', '/checklist'), 'tab');
    assert.equal(transitionFor('/more', '/nhs-guide'), 'forward');
    assert.equal(transitionFor('/societies/91', '/societies'), 'back');
    assert.equal(transitionFor('/nhs-guide', '/more', 'popstate', -1), 'back');
    assert.equal(transitionFor(undefined, '/home'), null, 'not the first page');
    assert.equal(transitionFor('/home', '/home'), null);
    assert.ok(WAIT_FOR_CHAT_MS <= 250, 'never waits long for the chat before it grows');
    const css = readFileSync('src/app.css', 'utf8');
    assert.match(css, /prefers-reduced-motion: no-preference\)[\s\S]*\[data-page-transition='chat'\]::view-transition-new\(root\) \{\s*animation: ag2-reveal /);
    assert.match(css, /@keyframes ag2-reveal \{\s*from \{\s*clip-path: circle\(0 at var\(--reveal-x/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{\s*:root\[data-page-transition\]::view-transition-old\(root\) \{\s*animation: 120ms ease-out both ag2-fade-away;/, 'with Reduce Motion: a short fade, nothing moving');
    const nav = readFileSync('src/lib/components/BottomNav.svelte', 'utf8');
    assert.match(nav, /view-transition-name: bottom-nav;/, 'the bar stays still');
    assert.match(nav, /view-transition-name: nav-pill;/, 'its highlight glides to the new tab');
    const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
    assert.match(layout, /transitionFor\(navigation\.from\?\.url\.pathname, navigation\.to\?\.url\.pathname, navigation\.type, delta\)/);
    assert.match(layout, /root\.style\.setProperty\('--reveal-x'/);
    assert.match(readFileSync('src/routes/check-in/+page.svelte', 'utf8'), /data-chat-ready/);
  }],
  ['Everyday phrases are not', () => {
    for (const text of [
      'This essay is killing me',
      'I\'m in danger of failing my module',
      'I\'m dying to try the climbing society',
      'Had a really good day, thanks',
      'Not sure which society to join'
    ]) assert.equal(isCrisis(text), false, text);
  }],
  // ---------- Checklist reminders: the Add card ----------
  ['A suggestion that\'s already on the checklist points to that task (a standard one or their own); a full list has no room', () => {
    const list = [...defaultTasks(), { id: 'own-1', title: 'Call home about rent', done: false }];
    assert.deepEqual(stateFor(list, 'Register with a GP surgery'), { state: 'exists', existing: 'Register with a GP' });
    assert.deepEqual(stateFor(list, 'call home about rent.'), { state: 'exists', existing: 'Call home about rent' });
    assert.deepEqual(stateFor(list, 'Open a bank account'), { state: 'offered' });
    assert.deepEqual(stateFor(list, 'Join the chess society'), { state: 'offered' }, 'a more specific task is new');
    assert.equal(sameTask('Rent', 'Pay rent'), false, 'one word is too little to call it the same');
    assert.equal(existingTask(list, 'Find a dentist')?.id, 'dentist');
    const full = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `own-${i}`, title: `Task ${i}`, done: false }));
    assert.deepEqual(stateFor(full, 'Open a bank account'), { state: 'full' });
  }],
  ['Add saves one own- task through the checklist\'s "add" change, with the list on screen for offline', async () => {
    /** @type {any[]} */
    const saved = [];
    const list = defaultTasks();
    const store = { loadChecklist: async () => list, saveChange: async (/** @type {any} */ change, /** @type {any} */ listOnScreen) => {
      saved.push({ change, listOnScreen });
      return { status: /** @type {const} */ ('saved') };
    } };
    assert.deepEqual(await addSuggestedTask('Open a bank account', store), { state: 'added' });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].change.type, 'add');
    assert.match(saved[0].change.task.id, /^own-/);
    assert.deepEqual({ ...saved[0].change.task, id: 'x' }, { id: 'x', title: 'Open a bank account', done: false });
    assert.deepEqual(saved[0].listOnScreen.map((/** @type {any} */ task) => task.title), [...list.map((task) => task.title), 'Open a bank account']);
  }],
  ['Add checks the latest list first: already there (added on another device) or full saves nothing; offline it\'s queued; the checklist\'s limits apply', async () => {
    let saves = 0;
    const store = (/** @type {any[]} */ list, status = 'saved') => ({ loadChecklist: async () => list, saveChange: async () => {
      saves++;
      return { status: /** @type {'saved' | 'queued'} */ (status) };
    } });
    const now = [...defaultTasks(), { id: 'own-2', title: 'Open a bank account', done: false }];
    assert.deepEqual(await addSuggestedTask('open a bank account', store(now)), { state: 'exists', existing: 'Open a bank account' });
    const full = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `own-${i}`, title: `Task ${i}`, done: false }));
    assert.deepEqual(await addSuggestedTask('Open a bank account', store(full)), { state: 'full' });
    assert.equal(saves, 0, 'nothing saved');
    assert.deepEqual(await addSuggestedTask('Buy a bus pass', store(defaultTasks(), 'queued')), { state: 'queued' });
    await assert.rejects(addSuggestedTask('   ', store(defaultTasks())), ChecklistError);
  }],
  ['Only the student\'s tap adds a task: the chat code never touches the checklist, and the card adds only from its Add button', () => {
    for (const file of ['src/lib/checkin/chat-turns.js', 'src/lib/checkin/task-suggestions.js']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from '#lib\/checklist\/store\.js'|from 'firebase\//, file);
    }
    const card = readFileSync('src/lib/components/TaskSuggestionCard.svelte', 'utf8');
    assert.equal(card.match(/addSuggestedTask\(/g)?.length, 1, 'called in one place');
    assert.match(card, /async function add\(\) \{[^}]*?addSuggestedTask\(task\.title, \{ loadChecklist, saveChange \}\)/);
    assert.match(card, /onclick=\{add\}[^>]*>\{busy \? 'Adding…' : 'Add'\}<\/button>/);
    assert.match(card, />No thanks<\/button>/);
    const onMount = card.slice(card.indexOf('onMount(async'), card.indexOf('async function add'));
    assert.doesNotMatch(onMount, /addSuggestedTask|saveChange\(/, 'nothing is added when the card appears');
  }],
  ['The chat page shows the card under its reply, and the note at the top stays true', () => {
    const page = readFileSync('src/routes/check-in/+page.svelte', 'utf8');
    assert.match(page, /task: reply\.tasks\?\.\[0\] \? \{ title: reply\.tasks\[0\], state: 'offered' \} : undefined/);
    assert.match(page, /<TaskSuggestionCard bind:task=\{item\.task\} \/>/);
    const note = page.replace(/\s+/g, ' ');
    assert.match(note, /This chat isn’t saved: it stays while the app is open in this tab, until you log out/);
    assert.match(note, /If it suggests a reminder and you tap Add, that task is saved to your checklist,/);
  }],
  ['Reminders: what one is (a task on their checklist), asked once at a natural point; one they ask for is added straight away; one the chat suggests has an Add card', () => {
    const { systemInstruction } = chatRequest({ about: '(about)', opener: ['(opener)'], shortlist: [], options: { mentor: 'no', checklist: 'no', hasMentor: false } });
    assert.match(systemInstruction, /A reminder here is a task on their checklist: if they ask what reminders are, say so in one line and offer to add one now\./);
    assert.match(systemInstruction, /Once in the conversation, at a natural point .* ask whether there's anything they'd like reminding about while they settle in\. Only once\./);
    assert.match(systemInstruction, /"add-task": they ask you to add something to their checklist, or to remind them about something/);
    assert.match(systemInstruction, /"reminder": a task would help with what they’ve said, and they haven’t asked for one: the app shows it with an Add button\./);
    assert.match(systemInstruction, /"calendar": they’d rather keep things in their own calendar, such as Outlook/);
  }],
  ['Whatever Gemini says: a suggested reminder already on their checklist says so instead of a card, and "I’ve added it" never shows with an Add card', () => {
    const read = (/** @type {Record<string, unknown>} */ reply) => readChatReply(json({ action: 'reminder', ...reply }), { shortlist: [], actions: ['reminder'], tasks: defaultTasks() });
    const there = read({ title: 'Register with a GP', say: 'I have set a reminder for you to register with a GP.' });
    assert.deepEqual([there?.say, there?.action], ['That’s already on your checklist: “Register with a GP”.', null]);
    assert.deepEqual([read({ title: 'Open a bank account', say: 'I’ve added that to your list.' })?.say], [REMINDER_OFFER]);
    assert.equal(read({ title: 'Open a bank account', say: 'Good idea. I have added opening a bank account to your reminders. Anything else?' })?.say, 'Good idea. Anything else?');
  }],
  ['No Remember card offered while they’re asking something, and no Your Mentor button with their mentor’s card', async () => {
    /** @type {any[]} */
    const requests = [];
    const chat = chatWith({ generateContent: async (/** @type {any} */ request) => (requests.push(request), /** @type {any} */ ({ response: { text: () => json({ say: 'Nice.' }), candidates: [] } })) }, { facts: noFacts, opener: ['Hi!'] });
    await chat.send('I love films. Any societies?');
    await chat.send('I plan my week every Sunday.');
    assert.ok(!requests[0].generationConfig.responseSchema.properties.action.enum.includes('offer-to-remember'));
    assert.ok(requests[1].generationConfig.responseSchema.properties.action.enum.includes('offer-to-remember'));
    assert.ok(requests[0].generationConfig.responseSchema.properties.action.enum.includes('remember'), 'they can always ask it to remember something');
    const card = readChatReply(json({ action: 'your-mentor', page: 'Your Mentor', say: 'Here they are.' }), { shortlist: [], actions: ['your-mentor'] });
    assert.deepEqual(card?.links, []);
  }],
  ['chatWith gives the page a suggested reminder for its card, and Gemini sees only what it said', async () => {
    /** @type {any[]} */
    const requests = [];
    const chat = chatWith(
      {
        generateContent: async (/** @type {any} */ request) => {
          requests.push(structuredClone(request));
          return /** @type {any} */ ({ response: { text: () => json({ action: 'reminder', title: 'Buy a winter coat', say: 'Good idea, here it is.' }), candidates: [{ finishReason: 'STOP' }] } });
        }
      },
      { facts: { match: null, tasks: defaultTasks() }, opener: ['Hi!'] }
    );
    const reply = await chat.send('It’s getting cold up here');
    assert.equal(reply.text, 'Good idea, here it is.');
    assert.deepEqual(reply.tasks, ['Buy a winter coat']);
    await chat.send('Thanks');
    assert.equal(requests[1].contents[1].parts[0].text, 'Good idea, here it is.');
    assert.equal(requests[1].generationConfig.responseMimeType, 'application/json');
  }],

  // ---------- When Gemini answers or fails (made-up models) ----------
  ['A reply comes back as a reply, and the conversation so far is sent with each message', async () => {
    /** @type {number[]} */
    const sent = [];
    const chat = chatWith(
      {
        generateContent: async (/** @type {any} */ request) => {
          sent.push(request.contents.length);
          return /** @type {any} */ ({ response: { text: () => json({ say: 'Hello there.' }), candidates: [{ finishReason: 'STOP' }] } });
        }
      },
      { facts: noFacts, opener: ['Hi!'] }
    );
    assert.deepEqual(await chat.send('Hi'), { kind: 'reply', text: 'Hello there.', links: [], tasks: [], offers: [], notes: [] });
    await chat.send('How are you?');
    assert.deepEqual(sent, [1, 3]);
  }],
  ['A 402 (Gemini\'s credit has run out): "isn\'t available", Need help now, and nothing more sent; the crisis check still answers', async () => {
    assert.equal(isOutOfCredit({ customErrorData: { status: 402 } }), true);
    assert.equal(isOutOfCredit({ customErrorData: { status: 429 } }), false);
    assert.equal(isOutOfCredit(new Error('no status')), false);
    assert.equal(isOutOfCredit(null), false);
    assert.match(UNAVAILABLE_MESSAGE, /the chat isn’t available right now/);
    assert.match(UNAVAILABLE_MESSAGE, /Need help now/);
    assert.doesNotMatch(UNAVAILABLE_MESSAGE, /try again/i);

    let calls = 0;
    const outOfCredit = chatWith(
      {
        generateContent: async () => {
          calls++;
          throw Object.assign(new Error('[402 Payment Required]'), { customErrorData: { status: 402 } });
        }
      },
      { facts: noFacts, opener: ['Hi!'] }
    );
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await outOfCredit.send('Any chess societies?'), { kind: 'unavailable', text: UNAVAILABLE_MESSAGE });
      assert.deepEqual(await outOfCredit.send('Hello?'), { kind: 'unavailable', text: UNAVAILABLE_MESSAGE });
      assert.equal(calls, 1, 'not tried again, and nothing more sent');
      assert.equal((await outOfCredit.send('I want to die')).kind, 'safety');
      assert.equal(calls, 1, 'the crisis check never needs Gemini');
    } finally {
      console.error = quiet;
    }
  }],
  ['Any other failure (such as too many requests) says try again in a minute, and the next message is sent as normal', async () => {
    let calls = 0;
    const busy = chatWith(
      {
        generateContent: async () => {
          calls++;
          throw Object.assign(new Error('[429 Too Many Requests]'), { customErrorData: { status: 429 } });
        }
      },
      { facts: noFacts, opener: ['Hi!'] }
    );
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await busy.send('Hi'), { kind: 'error', text: ERROR_MESSAGE });
      assert.deepEqual(await busy.send('Hi again'), { kind: 'error', text: ERROR_MESSAGE });
      assert.equal(calls, 2);
      const garbled = chatWith({ generateContent: async () => /** @type {any} */ ({ response: { text: () => 'Not JSON at all', candidates: [] } }) }, { facts: noFacts, opener: ['Hi!'] });
      assert.deepEqual(await garbled.send('Hi'), { kind: 'error', text: ERROR_MESSAGE }, 'a reply the app can\'t read is never shown');
    } finally {
      console.error = quiet;
    }
  }],
  ['The measurements ask Gemini through the Firebase SDK, so Gemini gets exactly the body the app sends: a field Gemini doesn’t accept reaches it and is refused, as on the live site on 18 November', async () => {
    const { restModel } = await import('./lib/chat-over-rest.mjs');
    const { unknownFields } = await import('./lib/stand-in-gemini.mjs');
    /** @type {any[]} */
    const bodies = [];
    // A made-up Gemini that refuses unknown fields as the real one does.
    const gemini = {
      config: { apiKey: 'made-up-key', projectId: 'demo-ag2', appId: '1:1:web:1' },
      /** @param {string} _model @param {string} body */
      send: async (_model, body) => {
        const sent = JSON.parse(body);
        bodies.push(sent);
        const unknown = unknownFields(sent);
        return unknown.length
          ? { status: 400, text: JSON.stringify({ error: { code: 400, message: `Invalid JSON payload received. Unknown name "${unknown[0]}": Cannot find field.`, status: 'INVALID_ARGUMENT' } }) }
          : { status: 200, text: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"action":"none","page":"none","say":"Hello!"}' }] }, finishReason: 'STOP' }] }) };
      }
    };
    const model = restModel(gemini);
    const asked = { contents: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], systemInstruction: 'Be kind.', generationConfig: { responseMimeType: 'application/json' } };
    const answer = await model.generateContent(/** @type {any} */ (asked));
    assert.equal(answer.response.text(), '{"action":"none","page":"none","say":"Hello!"}');
    assert.deepEqual(bodies[0].systemInstruction, { role: 'system', parts: [{ text: 'Be kind.' }] }, 'as the SDK shapes it');
    assert.deepEqual(bodies[0].contents, [{ role: 'user', parts: [{ text: 'hi' }] }], 'as the SDK shapes it');
    await assert.rejects(model.generateContent(/** @type {any} */ ({ ...asked, tasks: ['Enrol'] })), /400/);
    assert.deepEqual(bodies[1].tasks, ['Enrol'], 'sent on, as the app’s SDK would');
    // And the chat itself sends only what Gemini accepts.
    const chat = chatWith(model, { facts: { match: null, tasks: defaultTasks(), checklistSaved: true, profile: null, isMentor: false, mentorNote: null, today: '2026-11-18' }, opener: ['Hi!'] });
    const reply = await chat.send('hello');
    assert.equal(reply.text, 'Hello!');
    assert.deepEqual(unknownFields(bodies.at(-1)), []);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
