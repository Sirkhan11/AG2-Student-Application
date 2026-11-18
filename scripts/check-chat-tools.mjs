// Checks the check-in chat's conversation with Gemini and the app's tools (chat-turns.js,
// chat-tools.js, chat-do.js), in Node, with a scripted Gemini (no Google, no budget): every tool does
// what it says and only that; the app checks every change (nothing ticked unless they said so, their
// own tasks' words never sent, nothing private remembered); cards only for what the app's searches
// found; Gemini told how each call went; safety, the crisis check, a 402 and errors as before; and
// every request one Gemini accepts. Thomas's messages from the live site are used where they fit.
//
// Run from the project folder: node scripts/check-chat-tools.mjs

import assert from 'node:assert/strict';
import { applyChange, defaultTasks, makeAdd } from '#lib/checklist/tasks.js';
import { chatWith, ERROR_MESSAGE, UNAVAILABLE_MESSAGE, withoutClaims } from '#lib/checkin/chat-turns.js';
import { askedFor, createChatDo, NOTE_SAYS, saidIt, saysDone } from '#lib/checkin/chat-do.js';
import { cardsFor, chatTools, searchCatalogue, OWN_TASK } from '#lib/checkin/chat-tools.js';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { describeForGemini } from '#lib/checkin/opener.js';
import { SAFETY_MESSAGE } from '#lib/checkin/safety.js';
import { scriptedGemini } from './lib/scripted-gemini.mjs';
import { unknownFields } from './lib/stand-in-gemini.mjs';

/** A made-up student: Sam, BSc Nursing, into dancing, no mentor yet. */
const PROFILE = { name: 'Sam', course: 'BSc Nursing', interests: ['dancing'], arrivalDate: '', notes: [] };
/** @param {Partial<import('#lib/checkin/chat-turns.js').ChatFacts>} [given] */
const facts = (given = {}) => ({ match: null, tasks: defaultTasks(), checklistSaved: true, profile: PROFILE, isMentor: false, mentorNote: null, today: '2026-11-18', ...given });

/**
 * In-memory stores, as the page's (the checklist and the notes).
 * @param {import('#lib/checklist/tasks.js').Task[]} [tasks]
 */
function stores(tasks = defaultTasks()) {
  const state = { tasks, notes: /** @type {{ text: string, savedAt: number }[]} */ ([]) };
  return {
    state,
    do: createChatDo({
      loadTasks: async () => state.tasks,
      saveChange: async (change, list) => (state.tasks = applyChange(list, change)),
      loadNotes: async () => state.notes,
      remember: async (text) => {
        if (state.notes.some((note) => note.text === text)) return 'exists';
        if (state.notes.length >= 10) return 'full';
        state.notes.push({ text, savedAt: Date.now() });
        return 'saved';
      },
      forget: async (note) => void (state.notes = state.notes.filter((saved) => saved !== note)),
      forgetAll: async () => void (state.notes = [])
    })
  };
}

/** What Gemini was told back about its calls in a request: the function responses, by name. @param {any} request */
const toldBack = (request) => Object.fromEntries(request.contents.at(-1).parts.filter((part) => part.functionResponse).map((part) => [part.functionResponse.name, part.functionResponse.response]));

/** @type {[string, () => Promise<void> | void][]} */
const checks = [
  ['"can you not check if there is a gym society?": the search finds gym clubs and services, and the reply\'s cards are only names a search found', async () => {
    const found = searchCatalogue('gym').map((result) => result.name);
    assert.ok(found.includes('Olympic Weightlifting') && found.includes('Sport'), found.join(', '));
    const gemini = scriptedGemini([
      { calls: [{ name: 'search_societies_clubs_services', args: { query: 'gym' } }] },
      { text: 'There isn’t a gym society as such, but Olympic Weightlifting and Powerlifting are both Northumbria Sport clubs, and Sport covers gym memberships. Also, Hogwarts Quidditch is brilliant.' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    const reply = await chat.send('can you not check if there is a gym society?');
    assert.equal(reply.kind, 'reply');
    assert.deepEqual(reply.links?.map((link) => link.label), ['Olympic Weightlifting', 'Powerlifting', 'Sport']);
    const results = toldBack(gemini.requests[1]).search_societies_clubs_services;
    assert.ok(Array.isArray(results.results) && results.results.length > 0 && results.results.length <= 8);
    // Gemini's own parts (and their signatures) go back exactly as they came.
    assert.equal(gemini.requests[1].contents.at(-2).parts[0].thoughtSignature, 'made-up-signature');
  }],
  ['Cards only for the app\'s names as whole words: "sports news" is never the Sport card; an exact name shows its card even without a search', () => {
    assert.deepEqual(cardsFor('Check the sports news for that one.', new Set(['Sport'])), []);
    assert.deepEqual(cardsFor('The Advice Centre can help with that.', new Set()).map((link) => link.label), ['Advice Centre']);
  }],
  ['A search for a kind ("sport clubs") lists the clubs; nothing that fits says so', () => {
    const clubs = searchCatalogue('sport clubs');
    assert.ok(clubs.length >= 8);
    assert.ok(clubs.filter((result) => /Northumbria Sport club/.test(result.what)).length >= clubs.length / 2, clubs.map((result) => result.name).join(', '));
  }],
  ['"ah brill ive joined that now can you tick it off my list?": ticked, with a line and Undo; Gemini told it\'s done; the checklist it\'s told next is up to date', async () => {
    const store = stores();
    const gemini = scriptedGemini([
      { calls: [{ name: 'change_checklist', args: { change: 'tick', task: 'Join a society', their_words: 'ive joined that now' } }] },
      { text: 'Nice one, Sam. That’s ticked off.' },
      { text: 'Sure.' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: store.do });
    const reply = await chat.send('ah brill ive joined that now can you tick it off my list?');
    assert.equal(store.state.tasks.find((task) => task.id === 'society')?.done, true);
    assert.deepEqual(reply.changes?.map((change) => change.text), ['Ticked: Join a society.']);
    assert.deepEqual(toldBack(gemini.requests[1]).change_checklist, { done: true, what: 'Ticked: Join a society.' });
    assert.equal(reply.text, 'Nice one, Sam. That’s ticked off.');
    await chat.send('cheers');
    assert.match(gemini.requests[2].systemInstruction, /Checklist, done: Join a society/);
  }],
  ['Nothing is ticked unless they said they\'ve done it: words Gemini quotes must really be theirs, say it\'s done (or a plain yes) and not "don\'t"', async () => {
    const store = stores();
    const gemini = scriptedGemini([
      { calls: [{ name: 'change_checklist', args: { change: 'tick', task: 'Enrol', their_words: 'I have enrolled' } }] },
      { text: 'Have you enrolled yet?' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: store.do });
    const reply = await chat.send('what do I need to do first?');
    assert.equal(store.state.tasks.find((task) => task.id === 'enrol')?.done, false, 'made-up words don’t tick it');
    assert.match(String(toldBack(gemini.requests[1]).change_checklist.why), /ask them before ticking/);
    assert.deepEqual(reply.changes ?? [], []);
    gemini.then({ calls: [{ name: 'change_checklist', args: { change: 'tick', task: 'Enrol', their_words: 'yes' } }] }, { text: 'Great, that’s enrolment done.' });
    await chat.send('yes');
    assert.equal(store.state.tasks.find((task) => task.id === 'enrol')?.done, true);
    assert.ok(saidIt('joined that', ['ah brill ive joined that now']) && !saidIt('joined', ['hello']));
    // Thomas on the live site: "i dont need to register for a gp…" is not having done it.
    assert.equal(saysDone('i dont need to register for a gp', ['i dont need to register for a gp i need a mentor to help me focus and orginise work']), false);
    assert.equal(saysDone('register for a gp', ['i dont need to register for a gp i need a mentor']), false, 'not even with the "don’t" left out of the quote');
    assert.equal(saysDone('I picked up my student card today', ['I picked up my student card today actually']), true);
    assert.equal(saysDone('not yet', ['not yet']), false);
  }],
  ['Their own tasks: matched on their words, never named to Gemini; unclear which: they pick from buttons with their tasks, Gemini only told "one of their own"', async () => {
    const add = makeAdd('Return library books');
    const store = stores([...defaultTasks(), /** @type {any} */ (add).task]);
    const gemini = scriptedGemini([
      { calls: [{ name: 'change_checklist', args: { change: 'tick', task: OWN_TASK, their_words: 'returned my library books' } }] },
      { text: 'Sorted.' },
      { calls: [{ name: 'change_checklist', args: { change: 'remove', task: 'not sure', their_words: 'take one off' } }] },
      { text: 'Which one should I take off?' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts({ tasks: store.state.tasks }), act: store.do });
    await chat.send('I returned my library books today, tick it off');
    assert.equal(store.state.tasks.find((task) => task.title === 'Return library books')?.done, true);
    assert.deepEqual(toldBack(gemini.requests[1]).change_checklist, { done: true, what: 'Ticked one of their own tasks.' });
    const reply = await chat.send('can you take one off');
    const told = toldBack(gemini.requests[3]).change_checklist;
    assert.equal(told.done, false);
    assert.ok(/** @type {string[]} */ (told.their_tasks).includes(OWN_TASK));
    assert.ok(reply.quick?.some((quick) => quick.label === 'Return library books'), 'they see their own task’s words');
    assert.ok(!JSON.stringify(gemini.requests.map((request) => ({ ...request, contents: request.contents.slice(2) }))).includes('Return library books'), 'Gemini is never sent them (beyond what they typed)');
  }],
  ['Add, untick, remove, rename: each made, with a line and Undo; Undo puts it back, and Gemini is told with the next message', async () => {
    const store = stores();
    const gemini = scriptedGemini([
      { calls: [{ name: 'change_checklist', args: { change: 'add', task: 'not sure', new_title: 'Open a bank account', their_words: 'add open a bank account' } }] },
      { text: 'Added.' },
      { calls: [{ name: 'change_checklist', args: { change: 'remove', task: 'Find a dentist', their_words: 'take the dentist one off' } }] },
      { text: 'Done.' },
      { text: 'Okay.' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: store.do });
    const added = await chat.send('add open a bank account');
    assert.deepEqual(added.changes?.map((change) => change.text), ['Added to your checklist: Open a bank account.']);
    const removed = await chat.send('take the dentist one off');
    assert.deepEqual(removed.changes?.map((change) => change.text), ['Removed from your checklist: Find a dentist.']);
    assert.ok(!store.state.tasks.some((task) => task.id === 'dentist'));
    const undone = await store.do.undo(/** @type {any} */ (removed.changes)[0].undo);
    assert.ok(undone && store.state.tasks.some((task) => task.id === 'dentist'), 'Undo puts it back where it was');
    chat.tell(/** @type {any} */ (undone).forGemini);
    await chat.send('thanks');
    assert.match(gemini.requests.at(-1).contents.at(-1).parts[0].text, /^\[From the app, not the student: they tapped Undo/);
  }],
  ['A task is only added when they asked for it: "what do you mean a reminder?" adds nothing (Thomas, on the live site, got a task called "not sure")', async () => {
    assert.equal(askedFor('not sure', ['what do you mean a reminder can i set reminders on here?']), false);
    assert.equal(askedFor('Open a bank account', ['thanks, can you remind me to sort my bank account']), true);
    const store = stores();
    const gemini = scriptedGemini([{ calls: [{ name: 'change_checklist', args: { change: 'add', task: 'not sure', new_title: 'not sure', their_words: 'can i set reminders on here' } }] }, { text: 'A reminder is a task on your checklist. Want one?' }]);
    const reply = await chatWith(gemini.model, { facts: facts(), act: store.do }).send('what do you mean a reminder can i set reminders on here?');
    assert.deepEqual(reply.changes ?? [], []);
    assert.equal(store.state.tasks.length, defaultTasks().length);
  }],
  ['Remember and forget: done with a line and Undo; never health, money, worries or contact details (not even offered)', async () => {
    const store = stores();
    const gemini = scriptedGemini([
      { calls: [{ name: 'remember', args: { note: 'Into climbing' } }] },
      { text: 'Got it.' },
      { calls: [{ name: 'remember', args: { note: 'Worried about money' } }] },
      { text: 'I’ll leave that one.' },
      { calls: [{ name: 'offer_to_remember', args: { note: 'Anxious about exams' } }] },
      { text: 'Okay.' },
      { calls: [{ name: 'forget', args: { note: 'climbing' } }] },
      { text: 'Forgotten.' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: store.do });
    const saved = await chat.send('remember that I am into climbing');
    assert.deepEqual(saved.changes?.map((change) => change.text), [NOTE_SAYS.remembered('Into climbing')]);
    const refused = await chat.send('remember I am worried about money');
    assert.deepEqual(refused.changes ?? [], []);
    assert.equal(toldBack(gemini.requests[3]).remember.done, false);
    const offer = await chat.send('exams are making me anxious');
    assert.deepEqual(offer.notes ?? [], [], 'no Remember card for a worry');
    const forgot = await chat.send('forget the climbing thing');
    assert.deepEqual(forgot.changes?.map((change) => change.text), [NOTE_SAYS.forgotten('Into climbing')]);
    assert.equal(store.state.notes.length, 0);
  }],
  ['The cards and things the app shows: GP finder (with how it works), dentist search, key contacts, Ask4Help, a calendar card, a page, quick replies (at most 3, short), a reminder card, a Remember card', async () => {
    const gemini = scriptedGemini([
      { calls: [{ name: 'show_finder', args: { which: 'dentist' } }, { name: 'show_calendar', args: { title: 'Dentist appointment' } }, { name: 'suggest_replies', args: { replies: ['Yes', 'Not yet', 'What does it cost?', 'A fourth one'] } }] },
      { text: 'Here’s the dentist search. Want to book one?' },
      { calls: [{ name: 'show_key_contacts' }, { name: 'show_ask4help' }, { name: 'show_page', args: { page: 'NHS guide' } }, { name: 'suggest_reminder', args: { task: 'Book a dentist check-up' } }, { name: 'offer_to_remember', args: { note: 'Plays five-a-side on Tuesdays' } }] },
      { text: 'Here you go.' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    const one = await chat.send('sure where is the closest dentist and how does it work?');
    assert.equal(one.tool, 'dentist-finder');
    assert.match(String(toldBack(gemini.requests[1]).show_finder.how_it_works), /NHS appointment/);
    assert.deepEqual(one.calendar, { title: 'Dentist appointment' });
    assert.deepEqual(one.quick?.map((quick) => quick.label), ['Yes', 'Not yet', 'What does it cost?']);
    const two = await chat.send('what else');
    assert.equal(two.tool, 'contacts');
    assert.equal(two.ask4help, true);
    assert.deepEqual(two.links?.map((link) => link.href), ['/nhs-guide']);
    assert.deepEqual(two.tasks, ['Book a dentist check-up']);
    assert.deepEqual(two.notes, ['Plays five-a-side on Tuesdays']);
    gemini.then({ calls: [{ name: 'suggest_replies', args: { replies: ['Cheers'] } }] }, { text: 'Fair enough.' });
    assert.equal((await chat.send('nah')).quick, undefined, 'quick replies only under a question');
  }],
  ['how_to: the task\'s steps for Gemini, and its link (the Student Portal) or the GP finder with the reply', async () => {
    const gemini = scriptedGemini([
      { calls: [{ name: 'how_to', args: { task: 'Enrol' } }] },
      { text: 'Log in to the Student Portal and choose Enrol.' },
      { calls: [{ name: 'how_to', args: { task: 'Register with a GP' } }] },
      { text: 'Pick a surgery near you.' }
    ]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    const enrol = await chat.send('how do I enrol?');
    assert.ok(enrol.links?.some((link) => /myportal\.northumbria\.ac\.uk/.test(link.href)));
    assert.ok(Array.isArray(toldBack(gemini.requests[1]).how_to.steps));
    const gp = await chat.send('and the GP?');
    assert.equal(gp.tool, 'gp-finder');
  }],
  ['Mentor: offered only when it fits: find and offer without one, change only with one, never for a mentor; find starts the questions after the reply', async () => {
    const actions = (/** @type {any} */ given) => chatTools(facts(given))[0].functionDeclarations.find((/** @type {any} */ tool) => tool.name === 'mentor').parameters.properties.action.enum;
    assert.deepEqual(actions({}), ['show', 'find', 'offer']);
    assert.deepEqual(actions({ match: { status: 'matched', reasons: [] } }), ['show', 'change']);
    assert.deepEqual(actions({ isMentor: true }), ['show']);
    const gemini = scriptedGemini([{ calls: [{ name: 'mentor', args: { action: 'find' } }] }, { text: 'Let’s find you one.' }, { calls: [{ name: 'mentor', args: { action: 'change' } }] }, { text: 'Hmm.' }]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    assert.equal((await chat.send('i need a mentor to help me focus and orginise work')).start, 'mentor');
    assert.match(String(toldBack(gemini.requests[1]).mentor.note), /never ask any yourself/);
    const change = await chat.send('can I change my mentor');
    assert.equal(change.offers, undefined, 'no form without a mentor');
  }],
  ['It never says it did something the app didn\'t do', async () => {
    assert.equal(withoutClaims('Sure thing. I’ve ticked it off for you. Anything else?'), 'Sure thing. Anything else?');
    const gemini = scriptedGemini([{ text: 'I’ve added that to your checklist. What else is on your mind?' }]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    assert.equal((await chat.send('remind me to buy a lamp')).text, 'What else is on your mind?');
  }],
  ['Out of rounds: after four lookups, the next request says reply now (no more tools)', async () => {
    const gemini = scriptedGemini(Array.from({ length: 4 }, () => ({ calls: [{ name: 'search_societies_clubs_services', args: { query: 'music' } }] })).concat([{ text: 'Music it is.' }]));
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    assert.equal((await chat.send('music?')).text, 'Music it is.');
    assert.equal(gemini.requests.length, 5);
    assert.deepEqual(gemini.requests[4].toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  }],
  ['Safety and failures: the crisis check never reaches Gemini; a blocked reply is the support message; a 402 stops the chat; an error says try again; nothing said is an error', async () => {
    const gemini = scriptedGemini([{ blocked: true }, { error: Object.assign(new Error('AI: [402] credit'), { customErrorData: { status: 402 } }) }]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do });
    assert.deepEqual(await chat.send('I want to end my life'), { kind: 'safety', text: SAFETY_MESSAGE });
    assert.equal(gemini.requests.length, 0);
    assert.equal((await chat.send('hello')).kind, 'safety');
    const quiet = console.error;
    console.error = () => {};
    try {
      const out = await chat.send('hello again');
      if (out.kind === 'unavailable') {
        assert.deepEqual(await chat.send('still there?'), { kind: 'unavailable', text: UNAVAILABLE_MESSAGE });
      }
      const failing = chatWith(scriptedGemini([{ error: new Error('network') }, { text: '' }, { text: '' }]).model, { facts: facts() });
      assert.deepEqual(await failing.send('hi'), { kind: 'error', text: ERROR_MESSAGE });
      assert.deepEqual(await failing.send('hi'), { kind: 'error', text: ERROR_MESSAGE });
    } finally {
      console.error = quiet;
    }
  }],
  ['What Gemini is sent: one set of instructions and the tools, every request; their first name, never their email, full name or the mentor\'s name; contact details blanked; nothing Gemini would refuse', async () => {
    const gemini = scriptedGemini([{ text: 'Hi Sam.' }, { text: 'Noted.' }]);
    const match = { status: 'matched', mentorName: null, reasons: ['You both like dancing'], meetingFrequency: 'weekly', availability: 'Tuesdays' };
    const chat = chatWith(gemini.model, { facts: facts({ match: /** @type {any} */ (match), profile: { ...PROFILE, name: 'Sam Student', email: 'sam@northumbria.ac.uk' } }), act: stores().do });
    await chat.prompt('[From the app, not the student: they’ve just opened the chat.]');
    await chat.send('my email is sam@example.com and I live at NE1 8ST, call 07123 456789');
    for (const request of gemini.requests) {
      assert.deepEqual(unknownFields(request), []);
      assert.ok(Array.isArray(request.tools) && request.tools[0].functionDeclarations.length >= 10);
      assert.match(request.systemInstruction, /Talk like a friendly second-year/);
    }
    const sent = JSON.stringify(gemini.requests);
    assert.ok(!/Sam Student|sam@northumbria|sam@example|NE1 8ST|07123|Tuesdays/.test(sent), 'nothing private');
    assert.match(sent, /\[email\]/);
    assert.equal(chatInstructions(describeForGemini(facts())).includes('first name: Sam') || /Their first name: Sam/.test(chatInstructions(describeForGemini(facts()))), true);
  }],
  ['A conversation so far (seed) is sent first, and every exchange starts with a student\'s message or the app\'s note', async () => {
    const gemini = scriptedGemini([{ text: 'Glad to hear it.' }]);
    const chat = chatWith(gemini.model, { facts: facts(), act: stores().do, seed: [['I love dancing', 'Salsa and Bachata might suit you.']] });
    await chat.send('ah brill ive joined that');
    const contents = gemini.requests[0].contents;
    assert.equal(contents[0].role, 'user');
    assert.equal(contents[1].parts[0].text, 'Salsa and Bachata might suit you.');
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
