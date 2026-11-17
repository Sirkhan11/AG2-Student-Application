// Checks the check-in chat's first message and what Gemini is told (src/lib/checkin/opener.js), the
// crisis check that runs before anything is sent to Gemini (src/lib/checkin/safety.js), how the
// chat answers when Gemini fails (src/lib/checkin/chat-turns.js, with made-up models), and its
// checklist reminders (src/lib/checkin/task-suggestions.js, with a made-up checklist store).
// Nothing here needs Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-checkin.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOpener, describeForGemini, tidyProfile } from '#lib/checkin/opener.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isCrisis } from '#lib/checkin/safety.js';
import { chatInstructions, CLUB_LIST, SERVICE_LIST, SOCIETY_LIST } from '#lib/checkin/chat-prompt.js';
import { CLUBS } from '#lib/sport/clubs.js';
import { linksInReply, MAX_LINKS } from '#lib/checkin/reply-links.js';
import { startsAfresh } from '#lib/checkin/keep-chat.js';
import { chatWith, ERROR_MESSAGE, UNAVAILABLE_MESSAGE } from '#lib/checkin/chat-turns.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import { APP_PAGES, findPage } from '#lib/checkin/app-pages.js';
import { opensChatFromHome, WAIT_FOR_CHAT_MS } from '#lib/page-transitions.js';
import { SERVICES } from '#lib/nsu/services.js';
import { SOCIETIES } from '#lib/societies/societies.js';
import { addSuggestedTask, existingTask, sameTask, stateFor, tasksInReply } from '#lib/checkin/task-suggestions.js';
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

/** @type {[string, () => void | Promise<void>][]} */
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
  ['A checklist they\'ve never saved: the first message points to it, and Gemini is told not to say they haven\'t done things', () => {
    const { messages, links } = buildOpener({ match: null, tasks: tasks(), checklistSaved: false, justSignedUp: false });
    assert.match(messages[1], /Your checklist has a few things/);
    assert.ok(!messages.join(' ').includes('haven’t registered'), 'no claim about what they haven\'t done');
    assert.ok(links.some((link) => link.href === '/checklist'));
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
  // ---------- The societies Gemini may suggest ----------
  ['Gemini\'s society list: one per line, with categories, group notes and notes on misleading names, and no women-only societies', () => {
    const lines = SOCIETY_LIST.split('\n');
    assert.ok(lines.includes('Climbing (Recreational Sport)'));
    assert.ok(lines.includes('Conservation of Fine Art (Academic; conserving artworks)'));
    assert.ok(lines.includes('Formula Student (Recreational Sport; building a racing car for an engineering competition)'));
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
  ['A club name gives a club card (in the app at /sport/<slug>); Hockey is the club and Ice Hockey the society', () => {
    const { text, links } = linksInReply('Try [[Swimming]], [[Hockey]] or [[Ice Hockey]].', 'Newcastle');
    assert.equal(text, 'Try Swimming, Hockey or Ice Hockey.');
    assert.deepEqual(links.map((link) => [link.label, link.kind, link.href]), [
      ['Swimming', 'club', '/sport/swimming'],
      ['Hockey', 'club', '/sport/hockey'],
      ['Ice Hockey', 'society', `/societies/${links[2].nsuId}`]
    ]);
    assert.equal(links[0].slug, 'swimming');
  }],
  ['Gemini\'s club list is exactly the 38 clubs\' names, one per line, and nothing else', () => {
    assert.deepEqual(CLUB_LIST.split('\n'), CLUBS.map((club) => club.name));
    assert.ok(!CLUB_LIST.includes('@'));
  }],
  [`At most ${MAX_LINKS} links (so at most ${MAX_LINKS} cards), societies, clubs and services together; made-up names give none`, () => {
    const mixed = linksInReply('[[Swimming]], [[Climbing]], [[Food Pantry]], [[Rowing]] and [[Underwater Hockey]]', 'Newcastle');
    assert.deepEqual(mixed.links.map((link) => link.kind), ['club', 'society', 'service']);
    assert.ok(!mixed.links.some((link) => link.label === 'Underwater Hockey'));
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
  ['App pages link like societies, by name or an obvious variant, as buttons that keep Gemini\'s words', () => {
    const { text, links } = linksInReply('Have a look at your [[Checklist]], then the [[GP and Dentist Finder]] and your [[mentor]] page.', 'Newcastle');
    assert.equal(text, 'Have a look at your Checklist, then the GP and Dentist Finder and your mentor page.');
    assert.deepEqual(links, [
      { label: 'Checklist', href: '/checklist', external: false },
      { label: 'GP Finder', href: '/gp-finder', external: false },
      { label: 'Your Mentor', href: '/mentor', external: false }
    ]);
    assert.equal(findPage('  need   HELP now '), APP_PAGES.find((page) => page.href === '/need-help'));
    assert.equal(findPage('Find a GP')?.href, '/gp-finder');
    assert.equal(findPage('Checklists'), null, 'only the names and their variants');
  }],
  ['App pages share the limit of 3 with societies, clubs and services', () => {
    const { links } = linksInReply('[[Film]], [[Swimming]], [[Food Pantry]] and your [[Checklist]]', 'Newcastle');
    assert.deepEqual(links.map((link) => link.label), ['Film', 'Swimming', 'Food Pantry']);
  }],
  ['The student never sees the [[ ]] format: stray or unclosed brackets are taken out, and an unclosed one never swallows the next name', () => {
    const { text, links } = linksInReply('See [[Checklist and [[Film]]. Or [[Unknown Thing]].]] [[]]', 'Newcastle');
    assert.equal(text, 'See Checklist and Film. Or Unknown Thing.');
    assert.deepEqual(links.map((link) => link.label), ['Film']);
  }],
  ['No app page (or its variants) has the same name as a society, club or service', () => {
    const names = APP_PAGES.flatMap((page) => [page.name, ...page.also]);
    const key = (/** @type {string} */ name) => name.toLowerCase().replace(/\s+/g, ' ').trim();
    const taken = new Set([...SOCIETIES.map((society) => key(society.name)), ...SERVICES.map((service) => key(service.name)), ...CLUBS.map((club) => key(club.name))]);
    assert.deepEqual(names.filter((name) => taken.has(key(name))), []);
  }],
  ['The chat is told the app pages as [[ ]] links, and never to mention, explain or show the brackets', () => {
    const instructions = chatInstructions('(about)', ['(opener)']);
    for (const page of APP_PAGES) assert.ok(instructions.includes(`[[${page.name}]]`), page.name);
    assert.match(instructions, /Never mention, explain or show them to the student/);
    assert.ok(!/Pointing them to pages in the app by name: GP and Dentist Finder/.test(instructions), 'the old plain-text page list is gone');
  }],
  ['Opening the chat from Home slides it down (not with reduced motion); the bottom bar stays still; other pages just open', () => {
    assert.equal(opensChatFromHome('/home', '/check-in'), true);
    assert.equal(opensChatFromHome('/home', '/gp-finder'), false);
    assert.equal(opensChatFromHome('/checklist', '/check-in'), false);
    assert.equal(opensChatFromHome(undefined, '/check-in'), false);
    assert.ok(WAIT_FOR_CHAT_MS <= 250, 'never waits long for the chat before sliding');
    assert.match(readFileSync('src/app.css', 'utf8'), /chat-open'\]::view-transition \{\s*background: #ffffff;/, 'a plain white screen behind the slide');
    assert.match(readFileSync('src/app.css', 'utf8'), /::view-transition-new\(root\) \{\s*animation: 800ms /, 'slow enough to look smooth');
    const css = readFileSync('src/app.css', 'utf8');
    assert.match(css, /prefers-reduced-motion: no-preference\)[\s\S]*chat-open'\]::view-transition-new\(root\)[\s\S]*ag2-slide-down/);
    assert.match(css, /@keyframes ag2-slide-down \{\s*from \{\s*transform: translateY\(-100%\);/);
    assert.match(readFileSync('src/lib/components/BottomNav.svelte', 'utf8'), /view-transition-name: bottom-nav;/);
    const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
    assert.match(layout, /opensChatFromHome\(navigation\.from\?\.url\.pathname, navigation\.to\?\.url\.pathname\)/);
    assert.match(layout, /prefers-reduced-motion: reduce/);
    assert.match(readFileSync('src/routes/check-in/+page.svelte', 'utf8'), /data-chat-ready/);
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
  }],
  // ---------- Checklist reminders: {{task: }} suggestions and the Add card ----------
  ['A suggested task: the student sees it in quotes, never the {{task: }} marker, and it\'s offered for the card', () => {
    const { text, tasks } = tasksInReply('Shall I add {{task: Open a bank account}} to your checklist?');
    assert.equal(text, 'Shall I add “Open a bank account” to your checklist?');
    assert.deepEqual(tasks, ['Open a bank account']);
  }],
  ['However the marker is written, the student never sees it, and only the first task is offered (one at a time)', () => {
    assert.deepEqual(tasksInReply('{{ Task : "Buy a bus pass." }}').tasks, ['Buy a bus pass']);
    const two = tasksInReply('First {{task: Open a bank account}}, then {{task: Get a bus pass}}.');
    assert.deepEqual(two.tasks, ['Open a bank account']);
    assert.equal(two.text, 'First “Open a bank account”, then “Get a bus pass”.');
    for (const reply of ['Try {{task: Open a bank', 'Done }} and {{ and {{task:', 'Empty {{task: }} here', 'Odd {{task:}}', '{{TASK:Call home}}']) {
      const { text } = tasksInReply(reply);
      assert.ok(!/\{\{|\}\}|task\s*:/i.test(text), `${reply} -> ${text}`);
    }
    assert.equal(tasksInReply('Empty {{task: }} here').text, 'Empty here');
    assert.deepEqual(tasksInReply('Empty {{task: }} here').tasks, []);
  }],
  ['A task over 100 characters or with a blanked contact detail is shown but not offered; a [[Name]] inside keeps its name', () => {
    assert.deepEqual(tasksInReply(`{{task: Do ${'x'.repeat(100)}}}`).tasks, []);
    assert.deepEqual(tasksInReply('{{task: Call [phone number]}}').tasks, []);
    assert.deepEqual(tasksInReply('{{task: Go to a [[Chess]] meet}}').tasks, ['Go to a Chess meet']);
  }],
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
    assert.match(note, /If it suggests a reminder and you tap Add, that task is saved to your checklist\./);
  }],
  ['The chat is told to ask about reminders once at a natural point, one {{task: }} at a time, never to say it\'s added, and to point to a task already there', () => {
    const instructions = chatInstructions('(about)', ['(opener)']);
    assert.match(instructions, /Once in the conversation, at a natural point, ask whether there's anything they'd like reminding about while they settle in/);
    assert.match(instructions, /Not while they're worried or upset\. Ask this only once/);
    assert.match(instructions, /written as \{\{task: Open a bank account\}\}/);
    assert.match(instructions, /Suggest one task at a time/);
    assert.match(instructions, /Never say you've added a task or that you will: only they can, with the card's Add button\./);
    assert.match(instructions, /If it's already on their checklist .* don't suggest it again: say it's already there and point them to their \[\[Checklist\]\]\./);
    assert.match(instructions, /The double square brackets and the \{\{ \}\} markers are only for the app/);
  }],
  ['chatWith gives the page the suggested task without its marker, and Gemini keeps seeing its own marker (so it knows it asked)', async () => {
    /** @type {any[]} */
    const requests = [];
    const chat = chatWith({
      generateContent: async (/** @type {any} */ request) => {
        requests.push(structuredClone(request));
        return /** @type {any} */ ({ response: { text: () => 'Shall I add {{task: Buy a winter coat}}? Your [[Checklist]] has the rest.', candidates: [{ finishReason: 'STOP' }] } });
      }
    });
    const reply = await chat.send('Can you remind me to buy a coat?');
    assert.equal(reply.text, 'Shall I add “Buy a winter coat”? Your Checklist has the rest.');
    assert.deepEqual(reply.tasks, ['Buy a winter coat']);
    assert.deepEqual(reply.links?.map((link) => link.href), ['/checklist']);
    await chat.send('Thanks');
    assert.match(requests[1].contents[1].parts[0].text, /\{\{task: Buy a winter coat\}\}/);
  }],

  // ---------- When Gemini answers or fails (made-up models) ----------
  ['A reply comes back as a reply, and the conversation so far is sent with each message', async () => {
    /** @type {number[]} */
    const sent = [];
    const chat = chatWith({
      generateContent: async (/** @type {any} */ request) => {
        sent.push(request.contents.length);
        return /** @type {any} */ ({ response: { text: () => 'Hello there.', candidates: [{ finishReason: 'STOP' }] } });
      }
    });
    assert.deepEqual(await chat.send('Hi'), { kind: 'reply', text: 'Hello there.', links: [], tasks: [], offers: [] });
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
    const outOfCredit = chatWith({
      generateContent: async () => {
        calls++;
        throw Object.assign(new Error('[402 Payment Required]'), { customErrorData: { status: 402 } });
      }
    });
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
    const busy = chatWith({
      generateContent: async () => {
        calls++;
        throw Object.assign(new Error('[429 Too Many Requests]'), { customErrorData: { status: 429 } });
      }
    });
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await busy.send('Hi'), { kind: 'error', text: ERROR_MESSAGE });
      assert.deepEqual(await busy.send('Hi again'), { kind: 'error', text: ERROR_MESSAGE });
      assert.equal(calls, 2);
    } finally {
      console.error = quiet;
    }
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
