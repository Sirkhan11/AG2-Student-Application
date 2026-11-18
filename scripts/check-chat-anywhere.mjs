// Checks that every action the check-in chat can do works from any message, in every mode, not only
// inside a guided flow (checklist-edits.js, run-actions.js, chat-turns.js and the chat page): ticking,
// unticking, adding, removing and renaming checklist tasks when asked, made straight away through the
// checklist's own change and confirmed in one line with Undo, with no page link and no extra tap;
// asking which task when it isn't clear; never ticking something they haven't said they've done; their
// own tasks matched in the app, never by Gemini; remembering and forgetting; the GP finder, a dentist
// search, the key contacts, Ask4Help and a calendar card from any message; and "tell me when you've
// done it and I'll tick it off" for things done outside the app.
// Offline, in Node, with a made-up Gemini that answers in the app's JSON, through the same chat code
// the page uses (scripts/lib/talk-harness.mjs). measure-chat.mjs asks the real Gemini.
// Run from the project folder:
//   node scripts/check-chat-anywhere.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDIT_SAYS, planEdit } from '#lib/checkin/checklist-edits.js';
import { TICK_OFF_LINE } from '#lib/checkin/chat-turns.js';
import { NOTE_SAYS } from '#lib/checkin/run-actions.js';
import { FINDER_LINES } from '#lib/checklist/how-to.js';
import { defaultTasks, MAX_TASKS } from '#lib/checklist/tasks.js';
import { talkHarness } from './lib/talk-harness.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');

/** The six default tasks, with these ticked. @param {string[]} [done] */
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
      return /** @type {any} */ ({ response: { text: () => JSON.stringify({ page: 'none', ...reply }), candidates: [{ finishReason: 'STOP' }] } });
    }
  };
}

/** A chat that has just shown the Salsa and Bachata card, as in Thomas's live test. */
const AFTER_SALSA = /** @type {[string, string][]} */ ([['I love dancing, any societies?', 'You might like Salsa and Bachata, a Students’ Union society.']]);

/**
 * A chat in its ordinary mode (nothing being gone through), with this checklist and these notes.
 * @param {ReturnType<typeof madeUpGemini>} gemini @param {any[]} list @param {string[]} [notes]
 */
function chatWith(gemini, list, notes = []) {
  return talkHarness(gemini, { match: null, tasks: list, profile: { notes } }, ['Hi!']);
}

/** The chat's lines since the student last spoke. @param {ReturnType<typeof talkHarness>} chat */
const lastReplies = (chat) => chat.lines.slice(chat.lines.findLastIndex((line) => line.who === 'student') + 1);

/** Whether any line links to a page in the app (a button with no card). @param {ReturnType<typeof talkHarness>} chat */
const pageLinks = (chat) => lastReplies(chat).flatMap((line) => (line.links ?? []).filter((link) => !link.kind && !/Student Portal/.test(link.label)));

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  // ---------- Thomas's messages ----------
  ['"ah brill ive joined that now can you tick it off my list?" after the Salsa and Bachata card: ticks "Join a society", one line with Undo, no page link', async () => {
    const gemini = madeUpGemini([{ action: 'tick', task: 'Join a society', say: 'Brilliant, well done!' }]);
    const chat = chatWith(gemini, tasks(['enrol']));
    chat.chat.note(...AFTER_SALSA[0]);
    await chat.say('ah brill ive joined that now can you tick it off my list?');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, Boolean(line.undo)]), [['Ticked: Join a society.', true]], 'the app’s one line is the reply');
    assert.equal(chat.tasks().find((task) => task.id === 'society')?.done, true);
    assert.deepEqual(pageLinks(chat), []);
    assert.ok(gemini.sent[0].generationConfig.responseSchema.properties.task.enum.includes('Join a society'));
  }],
  ['"untick that", "add open a bank account" and "take the dentist one off": each done straight away, one line with Undo; Undo puts it back where it was', async () => {
    const gemini = madeUpGemini([
      { action: 'untick', task: 'Join a society', say: '' },
      { action: 'add-task', title: 'Open a bank account', say: '' },
      { action: 'remove-task', task: 'Find a dentist', say: '' }
    ]);
    const chat = chatWith(gemini, tasks(['enrol', 'society']));
    await chat.say('untick that');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, line.undo]), [['Unticked: Join a society.', true]]);
    await chat.say('add open a bank account');
    assert.deepEqual(lastReplies(chat).map((line) => line.text), ['Added to your checklist: Open a bank account.']);
    assert.equal(chat.tasks().at(-1)?.title, 'Open a bank account');
    await chat.say('take the dentist one off');
    assert.deepEqual(lastReplies(chat).map((line) => line.text), ['Removed from your checklist: Find a dentist.']);
    assert.ok(!chat.tasks().some((task) => task.id === 'dentist'));
    await chat.undoChange();
    assert.deepEqual(chat.tasks().map((task) => task.id).slice(0, 6), ['enrol', 'gp', 'student-id', 'society', 'dentist', 'contacts'], 'back in its place');
    assert.equal(lastReplies(chat)[0].text, EDIT_SAYS.undone);
  }],
  ['An unclear "tick it off": asks which one, with their tasks as quick replies (never claiming it’s done first); a tap ticks it, without Gemini', async () => {
    const gemini = madeUpGemini([{ action: 'tick', task: 'not sure', say: 'I have ticked that off for you.' }]);
    const chat = chatWith(gemini, tasks(['enrol']));
    await chat.say('tick it off');
    const [question] = lastReplies(chat);
    assert.equal(question.text, EDIT_SAYS.which.tick);
    assert.deepEqual(question.quick?.map((reply) => reply.label), ['Register with a GP', 'Collect student ID', 'Join a society', 'Find a dentist', 'Save key contacts']);
    await chat.say('Register with a GP');
    assert.deepEqual(lastReplies(chat).map((line) => line.text), ['Ticked: Register with a GP.']);
    assert.equal(gemini.sent.length, 1, 'the tap needed no Gemini');
  }],
  ['"what do you mean a reminder…", "nah im good i keep everything on my outlook calender" and "sure where is the closest dentist…": in the chat, no page links', async () => {
    const gemini = madeUpGemini([
      { action: 'none', say: 'A reminder here is a task on your checklist. Want me to add one now?' },
      { action: 'calendar', title: 'Find a dentist', say: 'No problem, you can add it to Outlook instead.' },
      { action: 'dentist-finder', say: 'I cannot tell you where the closest dentist is.' }
    ]);
    const chat = chatWith(gemini, tasks(['enrol']));
    await chat.say('what do you mean a reminder can i set reminders on here?');
    assert.deepEqual(pageLinks(chat), []);
    await chat.say('nah im good i keep everything on my outlook calender');
    assert.equal(lastReplies(chat)[0].calendar, 'Find a dentist');
    await chat.say('sure where is the closest dentist and how does it work?');
    const [reply] = lastReplies(chat);
    assert.deepEqual([reply.text, reply.tool], [FINDER_LINES.dentist, 'dentist-finder'], 'never refused: the app’s own words and the search');
    assert.deepEqual(pageLinks(chat), []);
  }],

  // ---------- The safety checks ----------
  ['Never ticks something they haven’t said they’ve done: it asks first, and ticks on their yes', async () => {
    const gemini = madeUpGemini([{ action: 'tick', task: 'Join a society', say: '' }]);
    const chat = chatWith(gemini, tasks());
    await chat.say('what about the society one');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, line.quick?.map((reply) => reply.label)]), [[EDIT_SAYS.sure('Join a society'), ['Yes', 'Not yet']]]);
    assert.equal(chat.tasks().find((task) => task.id === 'society')?.done, false);
    await chat.say('Yes');
    assert.equal(chat.tasks().find((task) => task.id === 'society')?.done, true);
  }],
  ['Their own tasks: matched in the app on their words (Gemini only says "one of their own", and never sees them); a tie asks which', async () => {
    const own = [...tasks(), { id: 'own-1', title: 'Ring my landlord about the boiler', done: false }, { id: 'own-2', title: 'Buy a bike lock', done: false }];
    const gemini = madeUpGemini([
      { action: 'tick', task: 'one of their own', say: '' },
      { action: 'rename-task', task: 'one of their own', title: 'Buy a D-lock', say: '' }
    ]);
    const chat = chatWith(gemini, own);
    await chat.say('I rang the landlord about it, tick that off');
    assert.equal(chat.tasks().find((task) => task.id === 'own-1')?.done, true);
    await chat.say('rename the bike one to buy a D-lock');
    assert.equal(chat.tasks().find((task) => task.id === 'own-2')?.title, 'Buy a D-lock');
    assert.doesNotMatch(JSON.stringify(gemini.sent), /landlord about the boiler|bike lock/i, 'Gemini never sees their own tasks’ words');
    const tie = planEdit([{ id: 'own-a', title: 'Call home', done: false }, { id: 'own-b', title: 'Call the bank', done: false }], { edit: 'tick', own: true }, 'I called, tick it');
    assert.equal(tie.kind, 'choose');
  }],
  ['Only a change that makes sense: already ticked, already there, a full list, or a standard task’s name says why', () => {
    assert.deepEqual(planEdit(tasks(['enrol']), { edit: 'tick', taskId: 'enrol' }, 'done it'), { kind: 'say', text: EDIT_SAYS.alreadyTicked('Enrol') });
    assert.deepEqual(planEdit(tasks(), { edit: 'add', title: 'Register with a GP surgery' }, 'add'), { kind: 'say', text: EDIT_SAYS.exists('Register with a GP') });
    const full = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `own-${i}`, title: `Task ${i}`, done: false }));
    assert.deepEqual(planEdit(full, { edit: 'add', title: 'Open a bank account' }, 'add'), { kind: 'say', text: EDIT_SAYS.full });
    assert.deepEqual(planEdit(tasks(), { edit: 'rename', taskId: 'gp', title: 'GP' }, 'rename'), { kind: 'say', text: EDIT_SAYS.nothingTo.rename });
  }],

  // ---------- Notes, cards and things outside the app ----------
  ['Remember and forget, when asked: done straight away, one line with Undo; never health, money or worries', async () => {
    const gemini = madeUpGemini([
      { action: 'remember', note: 'Loves salsa dancing', say: '' },
      { action: 'remember', note: 'Struggling with rent', say: 'Sure!' },
      { action: 'forget', forget: 'Plans on Sundays', say: '' }
    ]);
    const chat = chatWith(gemini, tasks(), ['Plans on Sundays']);
    await chat.say('remember that I love salsa dancing');
    assert.deepEqual(lastReplies(chat).map((line) => [line.text, line.undo]), [[NOTE_SAYS.remembered('Loves salsa dancing'), true]]);
    assert.deepEqual(chat.notes(), ['Plans on Sundays', 'Loves salsa dancing']);
    await chat.say('remember I’m struggling with rent');
    assert.ok(!chat.notes().some((note) => /rent/i.test(note)), 'never money');
    await chat.say('forget the Sunday thing');
    assert.deepEqual(chat.notes(), ['Loves salsa dancing']);
    await chat.undoChange();
    assert.deepEqual(chat.notes().sort(), ['Loves salsa dancing', 'Plans on Sundays']);
  }],
  ['The GP finder, the key contacts and Ask4Help, from any message', async () => {
    const gemini = madeUpGemini([
      { action: 'gp-finder', say: '' },
      { action: 'contacts', say: '' },
      { action: 'ask4help', say: 'They can help with your timetable.' }
    ]);
    const chat = chatWith(gemini, tasks());
    await chat.say('where is the nearest doctor?');
    assert.deepEqual([lastReplies(chat)[0].text, lastReplies(chat)[0].tool], [FINDER_LINES.gp, 'gp-finder']);
    await chat.say('what number do I ring for campus security?');
    assert.equal(lastReplies(chat)[0].tool, 'contacts');
    await chat.say('my timetable is wrong, who do I ask?');
    assert.equal(lastReplies(chat)[0].ask4help, true);
  }],
  ['Things outside the app: the direct link and "tell me when you’ve done it and I’ll tick it off"; their "done" ticks it, without Gemini', async () => {
    const gemini = madeUpGemini([
      { action: 'how-to', task: 'Enrol', say: 'Log in to the Student Portal and choose Enrol.' },
      { action: 'how-to', task: 'Join a society', suggest: [], say: 'Choose the Student membership on its Students’ Union page.' }
    ]);
    const chat = chatWith(gemini, tasks());
    await chat.say('how do I enrol?');
    const [reply] = lastReplies(chat);
    assert.equal(reply.text, `Log in to the Student Portal and choose Enrol. ${TICK_OFF_LINE}`);
    assert.deepEqual(reply.links, [{ label: 'Open the Student Portal' }]);
    await chat.say('done');
    assert.deepEqual(lastReplies(chat).map((line) => line.text), ['Ticked: Enrol.']);
    assert.equal(gemini.sent.length, 1);
    chat.chat.note(...AFTER_SALSA[0]);
    const salsa = chatWith(gemini, tasks());
    salsa.chat.note(...AFTER_SALSA[0]);
    await salsa.say('how do I join that?');
    assert.match(lastReplies(salsa)[0].text, /Tell me when you’ve done it and I’ll tick it off\.$/);
  }],
  ['While going through the checklist, a change of subject that asks for an action still gets it done', async () => {
    const gemini = madeUpGemini([{ answer: 'other', say: '' }, { action: 'add-task', title: 'Open a bank account', say: '' }]);
    const facts = { match: null, tasks: tasks(['enrol', 'gp']) };
    const chat = talkHarness(gemini, facts, ['Hi!']);
    await chat.opened();
    await chat.say('add open a bank account');
    assert.equal(chat.tasks().at(-1)?.title, 'Open a bank account');
  }],
  ['The chat page: the change happens after the reply shows; their answer to its question is read without Gemini; Undo on every change; the cards from any message', () => {
    const page = oneLine(source('src/routes/check-in/+page.svelte'));
    assert.match(page, /if \(reply\.kind === 'reply'\) await afterReply\(reply, \{ \.\.\.changes\(\), tasks: loadChecklist \}\);/);
    assert.match(page, /if \(edits\?\.takes\(text\)\) \{.*?await edits\.reply\(text\);/);
    assert.match(page, /onclick=\{\(\) => undoChange\(item\)\}>(?:<Icon name="undo" size=\{16\} \/> )?Undo<\/button>/);
    assert.match(page, /<CalendarCard title=\{item\.calendar\.title\} \/>/);
    assert.match(page, /tool: reply\.tool, ask4help: reply\.ask4help, calendar: reply\.calendar/);
    const card = source('src/lib/components/CalendarCard.svelte');
    assert.match(card, /outlookWebUrl\(entry\)/);
    assert.match(card, /downloadIcs\(entry\)/);
    assert.match(card, /the app keeps nothing/);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
