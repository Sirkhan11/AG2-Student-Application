// Checks going through the checklist as a conversation in the check-in chat (checklist-talk.js): one
// plain question about one task, with Yes and Not yet; Yes ticks it (with Undo) and asks about the
// next; Not yet helps, from the task's how-to only, with what the chat can do there and then; Stop or
// a change of subject ends it; and it starts straight away when asked.
// 1. Offline, in Node, with a made-up Gemini that answers in the app's JSON (the same chat code the
//    page uses, through scripts/lib/talk-harness.mjs): every path above, that taps and plain answers
//    never need Gemini, that Gemini is told only the task in hand and never the words of one of
//    their own tasks, the instructions, the first message, and the chat page's wiring.
// 2. In Chrome against the Auth and Firestore emulators (vite dev --mode emulators), with a stand-in
//    for Gemini (scripts/lib/stand-in-gemini.mjs), so nothing reaches Google: the first message's
//    question, Yes ticking the task in Firestore with Undo, Undo unticking it, Not yet's help with the
//    Student Portal and the move-on question, and Stop.
// Made-up people only; nothing real is touched (project demo-ag2). Run from the project folder:
//   node scripts/check-checklist-in-chat.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-checklist-in-chat.mjs"
// The second needs Java 21 or newer, and Google Chrome (or CHROME=<path to Chrome>). With
// SCREENSHOTS=<folder>, it also saves a phone-size picture of the conversation there.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatRequest, checklistAnswerRequest, checklistHelpRequest } from '#lib/checkin/chat-prompt.js';
import { OWN_TASK_FOR_GEMINI, plainAnswer, QUICK, questionFor, SAYS } from '#lib/checkin/checklist-talk.js';
import { buildOpener } from '#lib/checkin/opener.js';
import { blankContactDetails } from '#lib/checkin/private-details.js';
import { HOW_TO, KEY_CONTACTS, TALK } from '#lib/checklist/how-to.js';
import { defaultTasks } from '#lib/checklist/tasks.js';
import { emulators, openChrome, owner, sleep, startApp } from './lib/emulator-app.mjs';
import { standInGemini } from './lib/stand-in-gemini.mjs';
import { talkHarness } from './lib/talk-harness.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');

/** The six default tasks, with these ids ticked. @param {string[]} [done] */
const tasks = (done = []) => defaultTasks().map((task) => ({ ...task, done: done.includes(task.id) }));

/**
 * A made-up Gemini that answers with these JSON replies in turn, keeping every request.
 * @param {Record<string, unknown>[]} replies
 */
function madeUpGemini(replies) {
  /** @type {any[]} */
  const sent = [];
  return {
    sent,
    generateContent: async (/** @type {any} */ request) => {
      sent.push(structuredClone(request));
      const reply = replies.shift() ?? { action: 'none', page: 'none', say: 'OK.' };
      return /** @type {any} */ ({ response: { text: () => JSON.stringify(reply), candidates: [{ finishReason: 'STOP' }] } });
    }
  };
}

/**
 * A chat with the talk, as the page starts one: the first message asks about the first task still
 * to do, and the talk waits for the answer.
 * @param {ReturnType<typeof madeUpGemini>} gemini @param {any[]} list
 */
async function opened(gemini, list) {
  const facts = { match: null, tasks: list, profile: { interests: ['dancing'] } };
  const chat = talkHarness(gemini, facts, buildOpener({ match: null, tasks: list, justSignedUp: false, forGemini: true }).messages);
  await chat.opened();
  return chat;
}

/** The chat's lines since the student last spoke. @param {ReturnType<typeof talkHarness>} chat */
const lastReplies = (chat) => chat.lines.slice(chat.lines.findLastIndex((line) => line.who === 'student') + 1);

/** @type {[string, () => void | Promise<void>][]} */
const offline = [
  // ---------- The question, and Yes ----------
  ['The first message asks about the first task still to do, as one question with Yes and Not yet; straight after finding a mentor it doesn’t', () => {
    const { messages, asks, links } = buildOpener({ match: null, tasks: tasks(['enrol', 'gp']), justSignedUp: false });
    assert.equal(messages.at(-1), 'Let’s go through your checklist, one task at a time. Have you collected your student ID yet?');
    assert.equal(asks, 'student-id');
    assert.equal(messages.join(' ').match(/\?/g)?.length, 1, 'only one question');
    assert.ok(!links.some((link) => ['/checklist', '/gp-finder', '/societies'].includes(link.href)), 'no page buttons for tasks');
    const matched = /** @type {const} */ ({ status: 'matched', mentorName: 'Alex', reasons: [], meetingFrequency: 'weekly', availability: null, mentorId: 'm' });
    assert.equal(buildOpener({ match: matched, tasks: tasks(), justSignedUp: true }).asks, null);
    const own = [...tasks(['enrol', 'gp', 'student-id', 'society', 'dentist', 'contacts']), { id: 'own-1', title: 'Ring my landlord about the boiler', done: false }];
    assert.match(buildOpener({ match: null, tasks: own, justSignedUp: false }).messages.at(-1) ?? '', /Have you done “Ring my landlord about the boiler” yet\?/);
    assert.doesNotMatch(buildOpener({ match: null, tasks: own, justSignedUp: false, forGemini: true }).messages.join(' '), /landlord|boiler/, 'Gemini’s copy never has their own task’s words');
  }],
  ['Yes, tapped: ticks that task through the checklist’s change, says so in one line with Undo, and asks about the next; no Gemini', async () => {
    const gemini = madeUpGemini([]);
    const chat = await opened(gemini, tasks(['enrol', 'gp']));
    await chat.say('Yes');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, Boolean(line.ticked), line.quick?.map((reply) => reply.label)]), [
      ['Ticked: Collect student ID.', true, undefined],
      ['Have you joined a society yet?', false, ['Yes', 'Not yet']]
    ]);
    assert.equal(chat.tasks().find((task) => task.id === 'student-id')?.done, true);
    assert.equal(gemini.sent.length, 0, 'a tap needs no Gemini');
  }],
  ['Yes, typed ("yeah, got it on Monday"): Gemini reads it about that task only, and only that task is ticked', async () => {
    const gemini = madeUpGemini([{ answer: 'yes', say: '' }]);
    const chat = await opened(gemini, tasks(['enrol', 'gp']));
    await chat.say('yeah, got it on Monday, and I joined the climbing society too');
    assert.match(gemini.sent[0].systemInstruction, /The app has just asked them "Have you collected your student ID yet\?"/);
    assert.match(gemini.sent[0].systemInstruction, /Only this task counts: anything they say about other tasks is ignored\./);
    assert.deepEqual(chat.tasks().filter((task) => task.done).map((task) => task.id), ['enrol', 'gp', 'student-id'], 'not the society');
    assert.equal(lastReplies(chat)[0].text, 'Ticked: Collect student ID.');
  }],
  ['An unclear answer ("sort of") gets one quick question, and nothing is ticked', async () => {
    const gemini = madeUpGemini([{ answer: 'unclear', say: 'Do you mean you’ve picked it up, or that it’s ready to collect?' }]);
    const chat = await opened(gemini, tasks(['enrol', 'gp']));
    await chat.say('sort of');
    assert.deepEqual(lastReplies(chat).map((line) => line.text), ['Do you mean you’ve picked it up, or that it’s ready to collect?']);
    assert.equal(chat.tasks().find((task) => task.id === 'student-id')?.done, false);
    assert.equal(chat.talk.state.step, 'asking');
  }],
  ['The plainest answers are read without Gemini', () => {
    for (const text of ['yes', 'Yeah!', 'yep', 'done', 'got it', 'Yes']) assert.equal(plainAnswer(text), 'yes', text);
    for (const text of ['no', 'Not yet', 'nope', 'nah']) assert.equal(plainAnswer(text), 'not-yet', text);
    assert.equal(plainAnswer('stop'), 'stop');
    assert.equal(plainAnswer('Move on'), 'move-on');
    assert.equal(plainAnswer('Keep going'), 'keep-going');
    assert.equal(plainAnswer('I’m stuck'), 'stuck');
    for (const text of ['yeah got it', 'sort of', 'I haven’t enrolled']) assert.equal(plainAnswer(text), null, text);
  }],

  // ---------- Not yet ----------
  ['Not yet to the student ID, not enrolled: "Have you enrolled yet? You need to do that first.", with no Gemini', async () => {
    const gemini = madeUpGemini([]);
    const chat = await opened(gemini, tasks(['gp']));
    await chat.talk.start({ from: 'student-id' });
    await chat.say('No');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, line.quick?.map((reply) => reply.label)]), [['Have you enrolled yet? You need to do that first.', ['Yes', 'Not yet']]]);
    assert.equal(gemini.sent.length, 0);
  }],
  ['"I haven’t enrolled": Gemini reads it about enrolling, then helps with enrolling first, from its how-to, with the Student Portal, then asks whether to move on', async () => {
    const gemini = madeUpGemini([
      { answer: 'not-yet', say: '' },
      { about: 'task', ask4help: false, say: 'Enrol online in the Student Portal: choose Enrol, then Enrol on your programme, and have a passport-style photo ready.' }
    ]);
    const chat = await opened(gemini, tasks(['gp']));
    await chat.talk.start({ from: 'student-id' });
    await chat.say('No');
    await chat.say('I haven’t enrolled');
    assert.match(gemini.sent[0].systemInstruction, /The app has just asked them "Have you enrolled yet\? You need to do that first\."/);
    assert.match(gemini.sent[1].systemInstruction, /They haven't done "Enrol" yet, and you're helping them with it/);
    assert.ok(gemini.sent[1].systemInstruction.includes(HOW_TO.enrol.steps[1]), 'its how-to');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, line.links?.map((link) => link.label), line.quick?.map((reply) => reply.label)]), [
      ['Enrol online in the Student Portal: choose Enrol, then Enrol on your programme, and have a passport-style photo ready.', ['Open the Student Portal'], undefined],
      [SAYS.moving, undefined, ['Move on', 'Keep going']]
    ]);
  }],
  ['Yes to "Have you enrolled yet?": ticks Enrol, then helps with the student ID (the app tells Gemini they’ve enrolled)', async () => {
    const gemini = madeUpGemini([{ about: 'task', ask4help: false, say: 'Upload a photo in the Student Portal, then collect it from your campus with physical photo ID.' }]);
    const chat = await opened(gemini, tasks(['gp']));
    await chat.talk.start({ from: 'student-id' });
    await chat.say('No');
    await chat.say('Yes');
    assert.equal(chat.tasks().find((task) => task.id === 'enrol')?.done, true);
    assert.match(gemini.sent[0].contents.at(-1).parts[0].text, /^\[From the app, not the student: they've just said they've done "Enrol", so now help them with "Collect student ID"\.\]$/);
    assert.deepEqual(lastReplies(chat).map((line) => line.text).slice(0, 2), ['Ticked: Enrol.', 'Upload a photo in the Student Portal, then collect it from your campus with physical photo ID.']);
  }],
  ['Not yet to the GP: help from its how-to with the GP finder in the chat; Keep going, then Done, ticks it', async () => {
    const gemini = madeUpGemini([{ about: 'task', ask4help: false, say: 'Find a surgery near you below, then register online in about 15 minutes. It’s free.' }]);
    const chat = await opened(gemini, tasks(['enrol']));
    await chat.say('Not yet');
    assert.match(gemini.sent[0].systemInstruction, /The app shows the GP finder under your words, where they type their postcode: never ask for their postcode or address yourself\./);
    const [help, moving] = lastReplies(chat);
    assert.equal(help.tool, 'gp-finder');
    assert.equal(moving.text, SAYS.moving);
    await chat.say('Keep going');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, line.quick?.map((reply) => reply.label)]), [[SAYS.doing, ['Done', 'I’m stuck']]]);
    await chat.say('Done');
    assert.equal(chat.tasks().find((task) => task.id === 'gp')?.done, true);
    assert.equal(gemini.sent.length, 1);
  }],
  ['"I’m stuck" shows the Ask4Help card; a dentist search and the key contacts are cards in the chat', async () => {
    const gemini = madeUpGemini([
      { about: 'task', ask4help: false, say: 'Find one near you with the search below, and ask for an NHS appointment.' },
      { about: 'task', ask4help: false, say: 'The card below has them all, ready to save.' }
    ]);
    const chat = await opened(gemini, tasks(['enrol', 'gp', 'student-id', 'society']));
    await chat.say('Not yet');
    assert.equal(lastReplies(chat)[0].tool, 'dentist-finder');
    await chat.say('Keep going');
    await chat.say('I’m stuck');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, Boolean(line.ask4help)]), [[SAYS.stuck, true], [SAYS.moving, false]]);
    await chat.say('Move on');
    await chat.say('Not yet');
    assert.equal(lastReplies(chat)[0].tool, 'contacts');
    assert.deepEqual(KEY_CONTACTS.map((contact) => contact.phone), ['0191 227 3200', '0191 227 3999', '0191 227 4646', '999', '101']);
  }],
  ['Joining a society: suggestions that fit, from the app’s short list', async () => {
    const gemini = madeUpGemini([{ about: 'task', ask4help: false, suggest: ['Salsa and Bachata'], say: 'Since you like dancing, Salsa and Bachata could be fun.' }]);
    const chat = await opened(gemini, tasks(['enrol', 'gp', 'student-id']));
    await chat.say('Not yet');
    assert.ok(gemini.sent[0].generationConfig.responseSchema.properties.suggest.items.enum.includes('Salsa and Bachata'));
    assert.deepEqual(lastReplies(chat)[0].links, [{ label: 'Salsa and Bachata', kind: 'society' }]);
  }],
  ['One of their own tasks: asked with their words on screen, but Gemini never sees them; Not yet needs no Gemini', async () => {
    const own = [...tasks(['enrol', 'gp', 'student-id', 'society', 'dentist', 'contacts']), { id: 'own-1', title: 'Ring my landlord about the boiler', done: false }];
    const quiet = madeUpGemini([]);
    const first = await opened(quiet, own);
    await first.say('Not yet');
    assert.equal(lastReplies(first)[0].text, SAYS.ownNotYet);
    assert.equal(quiet.sent.length, 0);
    const gemini = madeUpGemini([{ answer: 'yes', say: '' }, { action: 'none', page: 'none', say: 'Nice one!' }]);
    const chat = await opened(gemini, own);
    await chat.say('yes, rang them this morning');
    await chat.say('Thanks!');
    const everything = JSON.stringify(gemini.sent);
    assert.doesNotMatch(everything, /Ring my landlord|boiler/, 'never the words of their own task, as the chat asked it');
    assert.ok(everything.includes(OWN_TASK_FOR_GEMINI.ticked));
    assert.match(gemini.sent[0].systemInstruction, /whether they’ve done one of their own checklist tasks \(you aren’t told what it is\)/);
  }],
  ['Undo unticks the task, says so, and asks about it again', async () => {
    const chat = await opened(madeUpGemini([]), tasks(['enrol', 'gp']));
    await chat.say('Yes');
    await chat.undo();
    assert.equal(chat.tasks().find((task) => task.id === 'student-id')?.done, false);
    assert.deepEqual(lastReplies(chat).map((line) => line.text), ['Okay, “Collect student ID” isn’t ticked any more.', 'Have you collected your student ID yet?']);
  }],

  // ---------- Stopping, and changing the subject ----------
  ['"stop" ends it at any point; a change of subject goes to the ordinary chat, while asking or while helping', async () => {
    const stopping = await opened(madeUpGemini([]), tasks());
    await stopping.say('stop');
    assert.deepEqual([lastReplies(stopping)[0].text, stopping.endings[0]?.outcome, stopping.talk.state.active], [SAYS.stopped, 'stopped', false]);
    const gemini = madeUpGemini([{ answer: 'other', say: '' }, { action: 'none', page: 'none', say: 'There’s a chess society!' }]);
    const chat = await opened(gemini, tasks());
    await chat.say('Are there any chess societies?');
    assert.deepEqual([chat.endings[0]?.outcome, lastReplies(chat).at(-1)?.text], ['other', 'There’s a chess society!']);
    const helper = madeUpGemini([{ about: 'task', ask4help: false, say: 'Find a surgery below.' }, { about: 'other', ask4help: false, say: '' }, { action: 'none', page: 'none', say: 'It meets weekly.' }]);
    const helping = await opened(helper, tasks(['enrol']));
    await helping.say('Not yet');
    await helping.say('When does the chess society meet?');
    assert.deepEqual([helping.endings[0]?.outcome, lastReplies(helping).at(-1)?.text], ['other', 'It meets weekly.']);
  }],
  ['While helping, "I’ve just registered" ticks it, and "next" moves on', async () => {
    const gemini = madeUpGemini([{ about: 'task', ask4help: false, say: 'Find a surgery below, then register online.' }, { about: 'done', ask4help: false, say: '' }]);
    const chat = await opened(gemini, tasks(['enrol']));
    await chat.say('Not yet');
    await chat.say('I’ve just registered online');
    assert.equal(chat.tasks().find((task) => task.id === 'gp')?.done, true);
    await chat.say('next');
    assert.equal(chat.talk.state.task?.id, 'society');
  }],

  // ---------- Starting ----------
  ['"can you help me do them one by one?" gets the first question straight away (no card, no page link); a named task starts there; "what now?" gets a one-line offer, and yes starts it', async () => {
    const gemini = madeUpGemini([
      { action: 'checklist', task: 'none', page: 'none', say: 'Sure, one at a time.' },
      { action: 'checklist', task: 'Collect student ID', page: 'none', say: 'Sure.' },
      { action: 'checklist-offer', page: 'none', say: 'Good question!' }
    ]);
    const facts = { match: null, tasks: tasks(['gp']) };
    const one = talkHarness(gemini, facts, ['Hi!']);
    await one.say('can you help me do them one by one?');
    assert.deepEqual(lastReplies(one).map((line) => [line.text, line.quick?.map((reply) => reply.label)]), [['Sure, one at a time.', undefined], ['Have you enrolled yet?', ['Yes', 'Not yet']]]);
    const asking = talkHarness(madeUpGemini([{ action: 'checklist', task: 'none', page: 'none', say: 'Shall we start with the first one?' }]), facts, ['Hi!']);
    await asking.say('help me with my checklist');
    assert.deepEqual(lastReplies(asking).map((line) => line.text), ['Have you enrolled yet?'], 'Gemini’s words never ask a question before the app’s');
    assert.ok(!lastReplies(one).some((line) => line.links?.length));
    const named = talkHarness(gemini, facts, ['Hi!']);
    await named.say('Can you help me collect my student ID?');
    assert.equal(lastReplies(named).at(-1)?.text, 'Have you collected your student ID yet?');
    const offered = talkHarness(gemini, facts, ['Hi!']);
    await offered.say('now what?');
    assert.deepEqual(lastReplies(offered).map((line) => [line.text, line.quick?.map((reply) => reply.label)]), [[SAYS.offer, ['Yes', 'Not now']]], 'the app’s offer is the whole reply');
    await offered.say('Yes');
    assert.equal(lastReplies(offered).at(-1)?.text, 'Have you enrolled yet?');
    const declined = talkHarness(madeUpGemini([{ action: 'checklist-offer', page: 'none', say: '' }]), facts, ['Hi!']);
    await declined.say('what should I do?');
    await declined.say('Not now');
    assert.deepEqual([lastReplies(declined)[0].text, declined.endings[0]?.outcome], [SAYS.declined, 'declined']);
  }],
  ['Checklist help is never just a page link: the chat never offers the Checklist page; after not now, only if they ask', () => {
    const request = chatRequest({ about: '', opener: [], shortlist: [], options: { mentor: 'no', checklist: 'yes', hasMentor: false, tasks: ['Enrol'], tasksLeft: ['Enrol'] } });
    const schema = /** @type {any} */ (request.generationConfig.responseSchema);
    assert.ok(!schema.properties.page.enum.includes('Checklist'));
    assert.ok(request.actions.includes('checklist') && request.actions.includes('checklist-offer'));
    assert.deepEqual(schema.properties.task.enum, ['not sure', 'Enrol']);
    const asked = chatRequest({ about: '', opener: [], shortlist: [], options: { mentor: 'no', checklist: 'if-asked', hasMentor: false } });
    assert.ok(asked.actions.includes('checklist') && !asked.actions.includes('checklist-offer'));
  }],

  // ---------- What Gemini is told ----------
  ['Help is from the task’s how-to only (never what’s still to be confirmed), and says what the app shows', () => {
    for (const [id, talk] of Object.entries(TALK)) {
      const howTo = HOW_TO[id];
      const { systemInstruction } = checklistHelpRequest({ about: '(about)', opener: [], title: id, howTo, talk, first: true, shortlist: [] });
      for (const line of [...howTo.steps, ...talk.first, ...talk.where, ...talk.bring, ...talk.after, ...talk.contact]) assert.ok(systemInstruction.includes(line), `${id}: ${line.slice(0, 40)}`);
      for (const unsure of talk.toBeConfirmed) assert.ok(!systemInstruction.includes(unsure), `${id} never tells Gemini: ${unsure}`);
      assert.match(systemInstruction, /Use only its how-to below: never add anything to it\. If it doesn't answer their question, say you don't know and that Ask4Help can help\./);
      assert.ok(talk.question.endsWith('?') && talk.tool, id);
    }
    assert.match(checklistAnswerRequest({ about: '', opener: [], question: null }).systemInstruction, /one of their own checklist tasks \(you aren’t told what it is\)/);
    assert.deepEqual(Object.keys(TALK), defaultTasks().map((task) => task.id), 'every standard task, in order');
    assert.equal(questionFor({ id: 'own-2', title: 'Buy a bike lock', done: false }), 'Have you done “Buy a bike lock” yet?');
  }],
  ['A postcode never reaches Gemini: typed in the chat it’s blanked, and the finder card is the app’s own', () => {
    assert.equal(blankContactDetails('My postcode is NE1 8ST'), 'My postcode is [postcode]');
    const card = source('src/lib/components/GpFinderCard.svelte');
    assert.match(card, /This stays in the app: it’s never sent to Gemini\./);
    assert.doesNotMatch(card, /geminiChat|chat-turns|firebase\/ai/);
  }],
  ['The chat page: typed answers go to the talk while it runs; quick replies send their words; Undo, the cards; a change of subject goes on to the chat; finding a mentor ends it quietly', () => {
    const page = oneLine(source('src/routes/check-in/+page.svelte'));
    assert.match(page, /if \(flowActive && flow\?\.takes\(text\)\) \{.*?await flow\.reply\(text\);/);
    assert.match(page, /onclick=\{\(\) => sendMessage\(option\.value\)\}>\{option\.label\}<\/button>/);
    assert.match(page, /onclick=\{\(\) => undoTick\(item\)\}/);
    assert.match(page, /<GpFinderCard kind=\{item\.tool === 'gp-finder' \? 'gp' : 'dentist'\} \/>/);
    assert.match(page, /<KeyContactsCard \/>/);
    assert.match(page, /if \(result\.outcome === 'other' && result\.text\) await askGemini\(result\.text\);/);
    assert.match(page, /chatFlowFor\('checklist'\)\?\.stop\(\{ quietly: true \}\)/);
    assert.match(page, /if \(reply\.offers\?\.\[0\] === 'checklist'\) await checklistTalk\(\)\.start\(\{ from: reply\.startAt \}\);/);
    assert.match(page, /else if \(reply\.offers\?\.\[0\] === 'checklist-offer'\) checklistTalk\(\)\.offer\(\);/);
    assert.match(page, /if \(opener\.asks\) \{\s*await checklistTalk\(\)\.start\(\{ asked: true \}\);/);
    assert.deepEqual(QUICK.yesNo.map((reply) => reply.value), ['Yes', 'Not yet']);
  }]
];

let failed = 0;
for (const [name, check] of offline) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
let total = offline.length;
const where = emulators();
if (where) {
  const results = await inTheBrowser(where);
  total += results.length;
  failed += results.filter((ok) => !ok).length;
} else {
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-checklist-in-chat.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * @param {{ auth: string, firestore: string, project: string }} where
 * @returns {Promise<boolean[]>}
 */
async function inTheBrowser(where) {
  /** @type {boolean[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const report = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const db = owner(where);
  const password = randomBytes(18).toString('base64url');
  const uid = await db.verifiedAccount('hal.walk@northumbria.ac.uk', password);
  await db.seed(`students/${uid}`, {
    name: 'Hal Student',
    course: 'BSc Law',
    email: 'hal.walk@northumbria.ac.uk',
    arrivalDate: '',
    role: 'student',
    interests: ['dancing'],
    checklist: tasks(['enrol', 'gp']),
    checklistOffered: ['enrol']
  });
  /** Whether the student ID task is ticked in Firestore. */
  const studentIdDone = async () =>
    (await db.read(`students/${uid}`))?.fields?.checklist?.arrayValue?.values?.find((/** @type {any} */ value) => value.mapValue.fields.id.stringValue === 'student-id')?.mapValue?.fields?.done?.booleanValue;
  /** Waits for Firestore to say this. @param {boolean} done */
  const studentIdIs = async (done) => {
    for (let i = 0; i < 40; i++) {
      if ((await studentIdDone()) === done) return true;
      await sleep(250);
    }
    return false;
  };

  const app = await startApp();
  const page = await openChrome(app.base);
  try {
    const gemini = await standInGemini(page.send, page.listen);
    const has = (/** @type {string} */ words) => `[...document.querySelectorAll('.bubble')].some((b) => b.innerText.trim() === ${JSON.stringify(words)})`;
    const last = (/** @type {string} */ words) => `[...document.querySelectorAll('.bubble')].at(-1)?.innerText.trim() === ${JSON.stringify(words)}`;
    await page.logIn('hal.walk@northumbria.ac.uk', password);
    await page.go('/check-in');
    await page.waitFor(`document.querySelector('[data-chat-ready]')`, 30000);

    // 1. The first message asks about the student ID, with Yes and Not yet.
    const asked = await page.waitFor(`[...document.querySelectorAll('.bubble')].at(-1)?.innerText.includes('Have you collected your student ID yet?') && document.querySelectorAll('.quick button').length === 2`);
    report('The first message asks about the first task still to do, with Yes and Not yet, and no page buttons for tasks',
      asked && !(await page.evaluate(`Boolean(document.querySelector('.messages a[href="/checklist"]'))`)));

    // 2. Yes ticks it in Firestore, with Undo, and asks about the next; no Gemini.
    await page.press('Yes');
    const next = await page.waitFor(last('Have you joined a society yet?'));
    const ticked = await studentIdIs(true);
    if (process.env.SCREENSHOTS) await page.picture(join(process.env.SCREENSHOTS, 'checklist-conversation.png'));
    report('Yes ticks the task in Firestore, says so with Undo, and asks about the next; no Gemini request',
      next && ticked && (await page.evaluate(`[...document.querySelectorAll('.ticked button')].some((b) => b.textContent.trim() === 'Undo')`)) && gemini.requests.length === 0,
      `next ${next}, ticked ${ticked}, ${gemini.requests.length} request(s)`);

    // 3. Undo unticks it, and asks again.
    await page.press('Undo');
    const again = await page.waitFor(last('Have you collected your student ID yet?'));
    report('Undo unticks it in Firestore and asks about it again', again && (await studentIdIs(false)));

    // 4. Not yet: help from Gemini (the stand-in), the Student Portal button, and the move-on question.
    gemini.replyWith({ about: 'task', ask4help: false, say: 'Upload a passport-style photo in the Student Portal, then collect it from your campus with physical photo ID.' });
    await page.press('Not yet');
    const helped = await page.waitFor(has(SAYS.moving));
    const portal = await page.evaluate(`[...document.querySelectorAll('a')].some((a) => a.href === 'https://myportal.northumbria.ac.uk/')`);
    const told = gemini.lastInstructions();
    report('Not yet (enrolled already): Gemini helps from the task’s how-to only, with the Student Portal button, then "move on or keep going?"',
      helped && portal && told.includes('They haven\'t done "Collect student ID" yet') && told.includes(HOW_TO['student-id'].steps[2]) && gemini.lastMessages().at(-1) === 'Not yet',
      `helped ${helped}, portal ${portal}`);

    // 5. Move on, then stop.
    await page.press('Move on');
    await page.waitFor(last('Have you joined a society yet?'));
    await page.answer('stop');
    report('Typing stop ends it', (await page.waitFor(has(SAYS.stopped))) && !(await page.evaluate(`Boolean(document.querySelector('.quick'))`)));

    // 6. From any message, after it's stopped: Thomas's own words tick the society, with Undo.
    /** Whether the society task is ticked in Firestore. */
    const societyDone = async () =>
      (await db.read(`students/${uid}`))?.fields?.checklist?.arrayValue?.values?.find((/** @type {any} */ value) => value.mapValue.fields.id.stringValue === 'society')?.mapValue?.fields?.done?.booleanValue;
    gemini.replyWith({ action: 'tick', task: 'Join a society', say: 'Brilliant, I have ticked that off for you.' });
    await page.answer('ah brill ive joined that now can you tick it off my list?');
    const confirmed = await page.waitFor(has('Ticked: Join a society.'));
    let saved = false;
    for (let i = 0; i < 40 && !saved; i++) {
      saved = (await societyDone()) === true;
      if (!saved) await sleep(250);
    }
    const said = await page.bubbles();
    report('From any message: "ah brill ive joined that now can you tick it off my list?" ticks it in Firestore, confirmed in one line with Undo, no page link',
      confirmed && saved && !said.some((text) => /I have ticked/.test(text)) && !(await page.evaluate(`Boolean(document.querySelector('.messages a[href="/checklist"]'))`))
        && (await page.evaluate(`[...document.querySelectorAll('.ticked button')].some((b) => b.textContent.trim() === 'Undo' && !b.disabled)`)),
      `confirmed ${confirmed}, saved ${saved}`);
    await page.evaluate(`([...document.querySelectorAll('.ticked button')].filter((b) => b.textContent.trim() === 'Undo').at(-1).click(), true)`);
    let undone = false;
    for (let i = 0; i < 40 && !undone; i++) {
      undone = (await societyDone()) === false;
      if (!undone) await sleep(250);
    }
    report('Undo puts it back in Firestore', undone && (await page.waitFor(has('Okay, I’ve put that back as it was.'))));
  } finally {
    await page.close();
    app.stop();
  }
  return results;
}
