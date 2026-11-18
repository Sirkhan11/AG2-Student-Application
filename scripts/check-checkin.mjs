// Checks what the check-in chat's Gemini is told (src/lib/checkin/opener.js, chat-prompt.js), the
// crisis check that runs before anything is sent to Gemini (src/lib/checkin/safety.js), what the
// student is shown (cards, pages), how the chat answers when Gemini fails (chat-turns.js, with
// made-up models), page changes, and its checklist reminders (task-suggestions.js, with a made-up
// checklist store). The tools themselves have their own check (check-chat-tools.mjs), as does the
// short list behind the search (check-shortlist.mjs).
// Nothing here needs Gemini or Firebase.
//
// Run from the project folder:
//   node scripts/check-checkin.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeForGemini, tidyProfile } from '#lib/checkin/opener.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { isCrisis } from '#lib/checkin/safety.js';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { cardsFor, CHAT_PAGES, chatTools, searchCatalogue } from '#lib/checkin/chat-tools.js';
import { FINDER_LINES } from '#lib/checklist/how-to.js';
import { scriptedGemini } from './lib/scripted-gemini.mjs';
import { startsAfresh } from '#lib/checkin/keep-chat.js';
import { chatWith, ERROR_MESSAGE, UNAVAILABLE_MESSAGE } from '#lib/checkin/chat-turns.js';
import { isOutOfCredit } from '#lib/firebase/ai-errors.js';
import { transitionFor, WAIT_FOR_CHAT_MS } from '#lib/page-transitions.js';
import { suggestionNamed } from '#lib/suggestions/catalogue.js';
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

/** Facts for a made-up chat with no records. */
const noFacts = { match: null, tasks: null };

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
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
  ['A checklist they\'ve never saved: Gemini is told not to say they haven\'t done things', () => {
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
  // ---------- Keeping the conversation when they visit another page ----------
  ['The chat keeps its conversation when they come back, but starts afresh for someone else, after logging out, or after Find a mentor', () => {
    const back = { keptUid: 'student-1', started: true, uid: 'student-1', fromFindMentor: false };
    assert.equal(startsAfresh(back), false, 'the same student coming back');
    assert.equal(startsAfresh({ ...back, started: false }), true, 'nothing kept yet');
    assert.equal(startsAfresh({ ...back, uid: 'student-2' }), true, 'someone else logged in');
    assert.equal(startsAfresh({ ...back, keptUid: null }), true, 'cleared when they logged out');
    assert.equal(startsAfresh({ ...back, fromFindMentor: true }), true, 'they\'ve just asked for a mentor');
  }],

  // ---------- What the student is shown ----------
  ['Each card says which society, club or service it is; societies and clubs open in the app, services on NSU\'s site, Societies at /societies', () => {
    const found = new Set(['Climbing', 'Food Pantry', 'Societies', 'Swimming']);
    assert.deepEqual(cardsFor('Try Climbing, the Food Pantry or Societies.', found), [
      { label: 'Climbing', href: '/societies/15', external: false, kind: 'society', nsuId: 15 },
      { label: 'Food Pantry', href: 'https://mynsu.co.uk/foodpantry', external: true, kind: 'service', serviceId: 'food-pantry' },
      { label: 'Societies', href: '/societies', external: false, kind: 'service', serviceId: 'societies' }
    ]);
    assert.deepEqual(cardsFor('Swimming.', found), [{ label: 'Swimming', href: '/sport/swimming', external: false, kind: 'club', slug: 'swimming' }]);
  }],
  ['A name no search found never becomes a card, however it\'s written; each once, at most three, in the order named', () => {
    const found = new Set(searchCatalogue('climbing').map((result) => result.name));
    assert.deepEqual(cardsFor('Climbing, climbing, Underwater Basket Weaving, Girls Who Run, Film.', found).map((link) => link.label), ['Climbing']);
    const many = new Set(['Film', 'Swimming', 'Food Pantry', 'Music']);
    assert.deepEqual(cardsFor('Music, Film, Swimming or the Food Pantry.', many).map((link) => link.label), ['Music', 'Film', 'Swimming']);
  }],
  ['A page is a button under the reply, only for what helps: the NHS guide, arriving late, Need help now, what the chat knows; never the Checklist or a page for something the chat does', () => {
    assert.deepEqual(Object.keys(CHAT_PAGES), ['NHS guide', 'Arriving late', 'Need help now', 'What the chat knows about you']);
    const page = chatTools(noFacts)[0].functionDeclarations.find((/** @type {any} */ tool) => tool.name === 'show_page');
    assert.deepEqual(page.parameters.properties.page.enum, Object.keys(CHAT_PAGES));
  }],
  ['Finding a GP or dentist comes with the app’s own words on how it works, for Gemini to explain, so the chat never refuses it', async () => {
    const gemini = scriptedGemini([{ calls: [{ name: 'show_finder', args: { which: 'gp' } }] }, { text: 'Here you go.' }]);
    const reply = await chatWith(gemini.model, { facts: noFacts }).send('where is the closest gp');
    assert.equal(reply.tool, 'gp-finder');
    assert.equal(gemini.requests[1].contents.at(-1).parts[0].functionResponse.response.how_it_works, FINDER_LINES.gp);
    const instructions = chatInstructions('');
    assert.match(instructions, /Don't send them to a page or to Ask4Help for something you can look up or do here\./);
    assert.doesNotMatch(instructions, /only (when|their) (the student )?taps?|only their tap/i, 'no rule that only their tap can do it');
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
  ['A suggested reminder adds only from its card\'s Add button; the chat changes the checklist only when asked, through chat-do.js (with Undo), never from Firebase itself', () => {
    for (const file of ['src/lib/checkin/chat-turns.js', 'src/lib/checkin/chat-do.js', 'src/lib/checkin/task-suggestions.js']) {
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
  ['Reminders: a reminder is a task on their checklist; one they ask for is added straight away (change_checklist); one the chat suggests has an Add card; the calendar for their own calendar', () => {
    const tools = Object.fromEntries(chatTools({ match: null, tasks: defaultTasks() })[0].functionDeclarations.map((/** @type {any} */ tool) => [tool.name, tool.description]));
    assert.match(tools.change_checklist, /add one \(a reminder is a task on their checklist\)/);
    assert.match(tools.suggest_reminder, /that they didn't ask for\. They tap Add .* When they ask for one, use change_checklist instead\./);
    assert.match(tools.show_calendar, /put something in their own calendar \(Outlook on the web, or a calendar file\)\. The app keeps nothing\./);
    assert.doesNotMatch(chatInstructions(''), /reminding about while they settle in/, 'no stock reminder question');
  }],
  ['The chat gives the page a suggested reminder for its card (only the tap adds it), and Gemini sees what the student saw', async () => {
    const gemini = scriptedGemini([{ calls: [{ name: 'suggest_reminder', args: { task: 'Buy a winter coat' } }] }, { text: 'Good idea.' }, { text: 'Stay warm.' }]);
    const chat = chatWith(gemini.model, { facts: { match: null, tasks: defaultTasks() } });
    const reply = await chat.send('It’s getting cold up here');
    assert.equal(reply.text, 'Good idea.');
    assert.deepEqual(reply.tasks, ['Buy a winter coat']);
    await chat.send('Thanks');
    assert.equal(gemini.requests[2].contents[3].parts[0].text, 'Good idea.');
  }],

  // ---------- When Gemini answers or fails (made-up models) ----------
  ['A reply comes back as a reply, and the conversation so far is sent with each message', async () => {
    const gemini = scriptedGemini([{ text: 'Hello there.' }, { text: 'Good, thanks.' }]);
    const chat = chatWith(gemini.model, { facts: noFacts });
    assert.deepEqual(await chat.send('Hi'), { kind: 'reply', text: 'Hello there.', links: [] });
    await chat.send('How are you?');
    assert.deepEqual(gemini.requests.map((request) => request.contents.length), [1, 3]);
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
      { facts: noFacts }
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
      { facts: noFacts }
    );
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await busy.send('Hi'), { kind: 'error', text: ERROR_MESSAGE });
      assert.deepEqual(await busy.send('Hi again'), { kind: 'error', text: ERROR_MESSAGE });
      assert.equal(calls, 2);
      const empty = chatWith(scriptedGemini([{ text: '   ' }]).model, { facts: noFacts });
      assert.deepEqual(await empty.send('Hi'), { kind: 'error', text: ERROR_MESSAGE }, 'nothing to say or show is never shown as a reply');
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
          : { status: 200, text: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Hello!' }] }, finishReason: 'STOP' }] }) };
      }
    };
    const model = restModel(gemini);
    const asked = { contents: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], systemInstruction: 'Be kind.', generationConfig: { responseMimeType: 'application/json' } };
    const answer = await model.generateContent(/** @type {any} */ (asked));
    assert.equal(answer.response.text(), 'Hello!');
    assert.deepEqual(bodies[0].systemInstruction, { role: 'system', parts: [{ text: 'Be kind.' }] }, 'as the SDK shapes it');
    assert.deepEqual(bodies[0].contents, [{ role: 'user', parts: [{ text: 'hi' }] }], 'as the SDK shapes it');
    await assert.rejects(model.generateContent(/** @type {any} */ ({ ...asked, tasks: ['Enrol'] })), /400/);
    assert.deepEqual(bodies[1].tasks, ['Enrol'], 'sent on, as the app’s SDK would');
    // And the chat itself sends only what Gemini accepts.
    const chat = chatWith(model, { facts: { match: null, tasks: defaultTasks(), checklistSaved: true, profile: null, isMentor: false, mentorNote: null, today: '2026-11-18' } });
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
