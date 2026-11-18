// Checks finding a mentor inside the check-in chat, and the chat's new role. Nothing here needs Gemini,
// Firebase or a browser: the flow (src/lib/checkin/mentor-flow.js) and the steps it shares with the Find
// a mentor page (src/lib/matching/find-mentor-steps.js) run with made-up matching steps that count every
// call, so "nothing is saved before Find my mentor" and "Stop saves nothing" are counts, not hopes.
// - The flow: the page's checks first (a mentor, no mentors, already matched), the note, the six
//   questions in order, how often (buttons), when free, the answers with Change, Find my mentor;
//   Gemini failing (Try again, or the coordinator), the credit running out (the coordinator only), any
//   other failure (that step again, never Gemini twice); Stop or "stop" at any point, saving nothing.
// - Gemini only offers it: its reply's mentor action becomes a card, only when the app allows it (no
//   mentor, not a mentor; after Not now or Stop only if they ask; never with no mentors available),
//   and the chat's instructions say the app does it; Find a mentor is no page link; what Gemini is
//   told covers mentors, Not now and the outcome.
// - The chat page sends what's typed during it to the flow, never to Gemini; the Find a mentor page
//   uses the same shared steps.
// The same flow runs in Chrome against the emulators in scripts/check-signed-in.mjs.
// Run from the project folder:
//   node scripts/check-mentor-in-chat.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatAction } from '#lib/checkin/chat-actions.js';
import { chatInstructions } from '#lib/checkin/chat-prompt.js';
import { chatTools } from '#lib/checkin/chat-tools.js';
import { scriptedGemini } from './lib/scripted-gemini.mjs';
import { chatWith } from '#lib/checkin/chat-turns.js';
import { createMentorFlow } from '#lib/checkin/mentor-flow.js';
import { chatOptions, describeForGemini, matchLine } from '#lib/checkin/opener.js';
import { ANSWERS_NOTE, checkAnswers, createFinder, findingMessage, MAX_AVAILABILITY_LENGTH, outcomeText, questions, SAYS } from '#lib/matching/find-mentor-steps.js';
import { SUMMARISE_FAILED } from '#lib/matching/errors.js';

const ANSWERS = ['Settling in', 'Climbing and films', 'A long walk', 'Planning ahead, with others', 'Making friends', 'Someone patient'];
const geminiDown = () => Object.assign(new Error('Gemini failed'), { code: SUMMARISE_FAILED });
const outOfCredit = () => Object.assign(new Error('402'), { code: SUMMARISE_FAILED, outOfCredit: true });

/**
 * A flow with made-up steps that count their calls, and everything it posts.
 * @param {{ before?: any, prepare?: () => Promise<any>, save?: () => Promise<any>, coordinator?: () => Promise<any> }} [made]
 */
function flowWith(made = {}) {
  const calls = { check: 0, prepare: 0, save: 0, coordinator: 0, prepared: /** @type {any[]} */ ([]), preferences: /** @type {any[]} */ ([]) };
  /** @type {any[]} */
  const posts = [];
  /** @type {any[]} */
  const finished = [];
  let state = /** @type {any} */ (null);
  const flow = createMentorFlow({
    check: async () => (calls.check++, made.before ?? { view: 'form' }),
    steps: {
      prepareStudent: async (answers) => (calls.prepare++, calls.prepared.push(answers), made.prepare ? made.prepare() : { answers }),
      matchAndSave: async (_prepared, preferences) => (calls.save++, calls.preferences.push(preferences), made.save ? made.save() : { outcome: 'matched', mentorName: 'Alex', reasons: ['You share interests: climbing'] }),
      askCoordinator: async (_answers, preferences) => (calls.coordinator++, calls.preferences.push(preferences), made.coordinator ? made.coordinator() : { outcome: 'coordinator' })
    },
    post: (message) => posts.push(message),
    changed: (next) => (state = next),
    finished: (result) => finished.push(result)
  });
  const saved = () => calls.prepare + calls.save + calls.coordinator;
  const last = () => posts.at(-1);
  return { flow, calls, posts, finished, saved, last, state: () => state };
}
const tick = () => new Promise((done) => setTimeout(done, 0));
const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ');
/** Runs a flow to its answers, ready for Find my mentor. @param {ReturnType<typeof flowWith>} t */
async function toReview(t) {
  t.flow.start();
  await tick();
  for (const answer of ANSWERS) t.flow.reply(`  ${answer}  `);
  t.flow.choose('every two weeks');
  t.flow.reply('Weekday afternoons');
}

/** @type {[string, () => void | Promise<void>][]} */
const checks = [
  // ---------- The flow ----------
  ['Start: the page’s check, the note about the answers, then question 1 of 6 (asked, so focus goes to the message box)', async () => {
    const t = flowWith();
    t.flow.start();
    await tick();
    assert.equal(t.calls.check, 1);
    assert.ok(t.posts[0].text.includes(ANSWERS_NOTE), 'the same note as the page');
    assert.equal(t.last().text, `Question 1 of 6: ${questions[0]}`);
    assert.equal(t.last().question, true);
    assert.equal(t.state().active, true);
  }],
  ['The six questions in order, then how often (buttons), then when they’re free, then their answers with Change and Find my mentor', async () => {
    const t = flowWith();
    t.flow.start();
    await tick();
    for (const [i, answer] of ANSWERS.entries()) {
      assert.equal(t.last().text, `Question ${i + 1} of 6: ${questions[i]}`);
      t.flow.reply(answer);
    }
    assert.equal(t.last().text, 'How often would you like to meet?');
    assert.deepEqual(t.last().card.choices.map((/** @type {any} */ c) => c.label), ['Weekly', 'Every two weeks', 'Monthly']);
    const choicesCard = t.last().card.id;
    t.flow.choose('weekly');
    assert.notEqual(t.state().live, choicesCard, 'the choices stop working once used');
    assert.equal(t.posts.at(-2).role, 'user', 'their choice shows as their bubble');
    assert.match(t.last().text, /When are you usually free/);
    t.flow.reply('Evenings');
    const review = t.last().card;
    assert.equal(review.kind, 'review');
    assert.deepEqual(review.items.map((/** @type {any} */ i) => i.answer), [...ANSWERS, 'Weekly', 'Evenings']);
    assert.equal(t.saved(), 0, 'nothing sent or saved yet');
  }],
  ['Nothing is saved until Find my mentor; then Gemini (once) and saving, with the answers trimmed, and the result in the chat', async () => {
    const t = flowWith();
    await toReview(t);
    assert.equal(t.saved(), 0, 'not before they confirm');
    await t.flow.confirm();
    assert.deepEqual([t.calls.prepare, t.calls.save, t.calls.coordinator], [1, 1, 0]);
    assert.deepEqual(t.calls.prepared[0], ANSWERS, 'trimmed');
    assert.deepEqual(t.calls.preferences[0], { meetingFrequency: 'every two weeks', availability: 'Weekday afternoons' });
    assert.ok(t.posts.some((p) => p.text === findingMessage(false)), 'the same progress message; these made-up steps don’t say the model is ready, so with the note');
    assert.equal(t.last().text, 'Thanks for answering those questions. You’ve been matched with Alex. Your mentor page says how to get in touch.');
    assert.deepEqual([t.last().card.kind, t.last().card.href], ['link', '/mentor']);
    assert.equal(t.finished[0].outcome, 'matched');
    assert.equal(t.state().active, false);
  }],
  ['The same checks as the page: a blank answer, no meeting choice typed, nothing or too much for when they’re free', async () => {
    const t = flowWith();
    t.flow.start();
    await tick();
    t.flow.reply('   ');
    assert.equal(t.last().text, 'Please answer question 1.');
    t.flow.reply('Settling in');
    assert.equal(t.last().text, `Question 2 of 6: ${questions[1]}`);
    for (const answer of ANSWERS.slice(1)) t.flow.reply(answer);
    t.flow.reply('whenever');
    assert.equal(t.last().text, 'Please choose one of the options above.');
    t.flow.reply('Monthly');
    assert.match(t.last().text, /When are you usually free/, 'typing a choice works too');
    t.flow.reply('  ');
    assert.equal(t.last().text, 'Please say when you’re usually free.');
    t.flow.reply('x'.repeat(MAX_AVAILABILITY_LENGTH + 1));
    assert.equal(t.last().text, `Please keep it to ${MAX_AVAILABILITY_LENGTH} characters.`);
    assert.equal(checkAnswers(ANSWERS, ''), 'Please say when you’re usually free.', 'the page uses the same check');
    assert.equal(t.saved(), 0);
  }],
  ['Change an answer from the review: that question again, then straight back to the review', async () => {
    const t = flowWith();
    await toReview(t);
    t.flow.change(2);
    assert.equal(t.last().text, `Question 3 of 6: ${questions[2]}`);
    t.flow.reply('A quiet day in');
    assert.equal(t.last().card.kind, 'review');
    assert.equal(t.last().card.items[2].answer, 'A quiet day in');
    t.flow.change(7);
    t.flow.reply('Mornings');
    assert.equal(t.last().card.items[7].answer, 'Mornings');
    assert.equal(t.saved(), 0);
  }],
  ['Stop (or typing "stop") at any point before Find my mentor ends it, saving nothing, and the chat carries on', async () => {
    for (const at of ['question', 'frequency', 'availability', 'review']) {
      const t = flowWith();
      t.flow.start();
      await tick();
      if (at !== 'question') for (const answer of ANSWERS) t.flow.reply(answer);
      if (at === 'availability' || at === 'review') t.flow.choose('weekly');
      if (at === 'review') t.flow.reply('Evenings');
      assert.equal(t.flow.reply(' Stop '), true, `${at}: "stop" is taken by the flow, not sent to Gemini`);
      assert.equal(t.saved(), 0, at);
      assert.equal(t.finished[0].outcome, 'stopped', at);
      assert.match(t.last().text, /Nothing has been saved/);
      assert.equal(t.flow.reply('Hello'), false, `${at}: afterwards, messages go to Gemini as normal`);
    }
    const t = flowWith();
    await toReview(t);
    assert.equal(t.flow.stop(), true, 'the Stop button');
    assert.equal(t.saved(), 0);
  }],
  ['Each case from checkBeforeMatching, as the page: a mentor, no mentors (nothing saved), already matched (their match, and changing mentor), already waiting', async () => {
    const mentor = flowWith({ before: { view: 'is-mentor' } });
    mentor.flow.start();
    await tick();
    assert.equal(mentor.last().text, SAYS.isMentor);
    assert.equal(mentor.finished[0].outcome, 'is-mentor');
    const none = flowWith({ before: { view: 'no-mentors' } });
    none.flow.start();
    await tick();
    assert.equal(none.last().text, `${SAYS.noMentors} ${SAYS.nothingSaved}`);
    const matched = flowWith({ before: { view: 'has-record', match: { status: 'matched', mentorName: 'Alex' } } });
    matched.flow.start();
    await tick();
    assert.match(matched.last().text, /^You’ve already been matched with Alex\. If you’d like a different mentor, just say so here and you can ask the coordinator\.$/);
    assert.equal(matched.last().card.href, '/mentor');
    const waiting = flowWith({ before: { view: 'has-record', match: { status: 'coordinator' } } });
    waiting.flow.start();
    await tick();
    assert.equal(waiting.last().text, 'We’re already finding you a mentor, and we’ll let you know soon.');
    for (const t of [mentor, none, matched, waiting]) {
      assert.equal(t.saved(), 0);
      assert.equal(t.posts.some((p) => /^Question 1/.test(p.text)), false, 'no questions');
    }
  }],
  ['Gemini fails: Try again (asks Gemini again) or the coordinator; the credit run out: the coordinator only', async () => {
    let fail = true;
    const t = flowWith({ prepare: async () => { if (fail) throw geminiDown(); return { prepared: true }; } });
    await toReview(t);
    await t.flow.confirm();
    assert.equal(t.last().card.kind, 'gemini-failed');
    assert.equal(t.last().text, `${SAYS.geminiFailed} ${SAYS.geminiFailedNote}`);
    fail = false;
    await t.flow.tryAgain();
    assert.deepEqual([t.calls.prepare, t.calls.save], [2, 1]);
    const c = flowWith({ prepare: async () => { throw geminiDown(); } });
    await toReview(c);
    await c.flow.confirm();
    await c.flow.coordinator();
    assert.deepEqual([c.calls.coordinator, c.calls.save], [1, 0]);
    assert.equal(c.last().text, 'Thanks for answering those questions. We’re finding you a mentor, and we’ll let you know soon.');
    const u = flowWith({ prepare: async () => { throw outOfCredit(); } });
    await toReview(u);
    await u.flow.confirm();
    assert.equal(u.last().card.kind, 'gemini-unavailable');
    await u.flow.tryAgain();
    assert.equal(u.calls.prepare, 1, 'no Try again when the credit has run out');
    await u.flow.coordinator();
    assert.equal(u.calls.coordinator, 1);
  }],
  ['Any other failure tries that step again, and never asks Gemini twice: a failed save saves again with what was prepared', async () => {
    let fail = true;
    const t = flowWith({ save: async () => { if (fail) throw new Error('network'); return { outcome: 'coordinator' }; } });
    await toReview(t);
    await t.flow.confirm();
    assert.equal(t.last().card.kind, 'retry');
    assert.equal(t.last().text, 'We couldn’t save your match. Please try again.');
    assert.equal(t.flow.stop(), true, 'they can still stop here');
    const t2 = flowWith({ save: async () => { if (fail) throw new Error('network'); return { outcome: 'coordinator' }; } });
    await toReview(t2);
    await t2.flow.confirm();
    fail = false;
    await t2.flow.tryAgain();
    assert.deepEqual([t2.calls.prepare, t2.calls.save], [1, 2]);
    const finder = createFinder({ prepareStudent: async () => ({}), matchAndSave: async () => ({ outcome: 'no-mentors' }), askCoordinator: async () => ({ outcome: 'coordinator' }) });
    assert.deepEqual(await finder.find(ANSWERS, { meetingFrequency: 'weekly', availability: 'x' }), { status: 'saved', outcome: { outcome: 'no-mentors' }, summary: null });
    assert.equal(outcomeText({ outcome: 'no-mentors' }), `${SAYS.noMentors} ${SAYS.nothingSaved}`);
  }],
  ['It can’t be stopped or restarted while saving, and its old cards stop working', async () => {
    /** @type {(value: any) => void} */
    let release = () => {};
    const t = flowWith({ save: () => new Promise((done) => (release = done)) });
    await toReview(t);
    const saving = t.flow.confirm();
    await tick();
    assert.equal(t.state().step, 'busy');
    assert.equal(t.flow.stop(), false, 'they’ve already chosen Find my mentor');
    assert.equal(t.state().live, null, 'no card works while saving');
    release({ outcome: 'coordinator' });
    await saving;
    assert.equal(t.finished[0].outcome, 'coordinator');
  }],

  // ---------- Gemini only offers it ----------
  ['Gemini\'s mentor tool with "offer" becomes an offer card (Start, Not now), only when the app allows it', async () => {
    const offered = async (/** @type {any} */ facts) =>
      (await chatWith(scriptedGemini([{ calls: [{ name: 'mentor', args: { action: 'offer' } }] }, { text: 'I can find you one here.' }]).model, { facts }).send('I need a mentor')).offers;
    assert.deepEqual(await offered({ match: null, tasks: null }), ['mentor']);
    assert.equal(await offered({ match: { status: 'matched', reasons: [] }, tasks: null }), undefined, 'not allowed now: no card');
    assert.equal(chatAction('mentor')?.card?.title, 'Find a mentor here?');
  }],
  ['When the app allows it: no mentor and not a mentor; after Not now or Stop only if they ask; never with one, as a mentor, or with none available', () => {
    assert.equal(chatOptions({ match: null, tasks: null }).mentor, 'yes');
    assert.equal(chatOptions({ match: null, tasks: null, mentorNote: 'declined' }).mentor, 'if-asked');
    assert.equal(chatOptions({ match: null, tasks: null, mentorNote: 'stopped' }).mentor, 'if-asked');
    assert.equal(chatOptions({ match: null, tasks: null, mentorNote: 'no-mentors' }).mentor, 'no');
    assert.equal(chatOptions({ match: null, tasks: null, isMentor: true }).mentor, 'no');
    assert.equal(chatOptions({ match: { status: 'coordinator', meetingFrequency: 'weekly', availability: null }, tasks: null }).mentor, 'no');
    assert.equal(chatOptions({ match: undefined, tasks: null }).mentor, 'no', 'not known: not offered');
  }],
  ['"find" starts the questions after the reply; Gemini sees only what was said to it; nothing from the flow is ever in its history', async () => {
    const gemini = scriptedGemini([{ calls: [{ name: 'mentor', args: { action: 'find' } }] }, { text: 'Let’s find you one. Six quick questions.' }, { text: 'Good luck.' }]);
    const chat = chatWith(gemini.model, { facts: { match: null, tasks: null } });
    const reply = await chat.send('i need a mentor to help me focus and orginise work');
    assert.deepEqual([reply.text, reply.start], ['Let’s find you one. Six quick questions.', 'mentor']);
    await chat.send('Thanks');
    assert.equal(gemini.requests[2].contents.length, 5, 'their message, the call, its result, the reply, then theirs: no flow answers');
  }],
  ['The chat’s instructions and tools: the app does the actions and Gemini says how they went; the mentor tool only as allowed; no Find a mentor page; every safety rule', () => {
    const t = oneLine(chatInstructions('(about)'));
    assert.match(t, /Call the tool, then tell them in your own words how it went\. Never say you've done something unless the tool said it's done\./);
    assert.doesNotMatch(t, /Find a mentor/);
    const mentor = (/** @type {any} */ facts) => chatTools(facts)[0].functionDeclarations.find((/** @type {any} */ tool) => tool.name === 'mentor');
    assert.match(mentor({ match: null, tasks: null }).description, /"find" starts the six short questions that find them one, here in the chat, when they ask for one/);
    assert.deepEqual(mentor({ match: { status: 'matched', reasons: [] }, tasks: null }).parameters.properties.action.enum, ['show', 'change'], 'never offered to someone who has one; changing happens here too');
    assert.match(t, /call 999 if they're in danger now, NHS 111 for urgent help, and Samaritans free on 116 123 at any time, and show the Need help now page/, 'every safety rule');
    assert.match(t, /Nothing they say is reported to anyone, and you can't contact anyone for them\. Never say you will\./);
    assert.match(t, /Plain text: no markdown, lists or emoji\. Ask at most one question\./);
  }],
  ['What Gemini is told: a mentor account isn’t offered one; no mentor yet: it can offer here; Not now, Stop and the outcome stop it offering again', () => {
    const base = { tasks: null };
    assert.match(describeForGemini({ ...base, match: null, isMentor: true }), /Mentor: they’re a mentor themselves \(they signed up as one\), so don’t offer to find them one\./);
    assert.match(describeForGemini({ ...base, match: null }), /Mentor: they haven’t got one yet\./);
    assert.doesNotMatch(describeForGemini({ ...base, match: null }), /Find a mentor page/);
    assert.match(describeForGemini({ ...base, match: null, mentorNote: 'declined' }), /They said not now to finding a mentor in this chat\./);
    assert.match(describeForGemini({ ...base, match: null, mentorNote: 'stopped' }), /They started finding a mentor in this chat and stopped\./);
    assert.match(describeForGemini({ ...base, match: null, mentorNote: 'no-mentors' }), /there are no mentors available yet, so don’t offer again in this chat/);
    const matched = describeForGemini({ ...base, match: { status: 'matched', mentorId: 'm1', mentorName: 'Alex', reasons: ['You share interests: films'], meetingFrequency: 'weekly', availability: null } });
    assert.match(matched, /Mentor: they have one\./);
    assert.ok(!matched.includes('Alex'), 'never the mentor’s name');
    assert.match(describeForGemini({ ...base, match: { status: 'coordinator', meetingFrequency: 'weekly', availability: null } }), /coordinator is finding them a mentor/);
  }],
  ['Straight after finding a mentor on the page, the app’s own line has the mentor’s name (never Gemini’s); otherwise Gemini writes the first message', () => {
    assert.equal(matchLine({ status: 'matched', mentorId: 'm', mentorName: 'Alex', reasons: [], meetingFrequency: null, availability: null }), 'Thanks for answering those questions. You’ve been matched with Alex. Your mentor page says how to get in touch.');
    assert.match(String(matchLine({ status: 'coordinator', meetingFrequency: null, availability: null })), /We’re finding you a mentor/);
    assert.equal(matchLine(null), null);
  }],

  // ---------- The chat page, and the Find a mentor page ----------
  ['The chat page sends what’s typed during it to the flow, never to Gemini; Stop is there; questions move focus to the box; it’s a live region', () => {
    const page = readFileSync('src/routes/check-in/+page.svelte', 'utf8');
    const send = page.slice(page.indexOf('async function sendMessage('), page.indexOf('const chat = geminiChat();', page.indexOf('async function sendMessage(')));
    assert.match(send, /if \(flowActive && flow\?\.takes\(text\)\) \{[\s\S]*await flow\.reply\(text\);[\s\S]*return;\s*\}/, 'the flow takes it and returns before Gemini');
    assert.match(source('src/lib/checkin/mentor-flow.js'), /const takes = \(_text\) => state\.active;/, 'finding a mentor takes everything typed while it runs');
    assert.doesNotMatch(send, /chat\.send/);
    assert.match(page, /onclick=\{\(\) => chatFlow\(\)\?\.stop\(\)\}>Stop<\/button>/);
    assert.match(page, /if \(question\) \/\*\* @type \{HTMLInputElement \| null\} \*\/ \(document\.getElementById\('chat-message'\)\)\?\.focus\(\);/);
    assert.match(page, /<div class="messages" aria-live="polite"/);
    assert.match(page.replace(/\s+/g, ' '), /If you find a mentor here, your answers are saved when you choose Find my mentor, as on the Find a mentor page; they’re never sent to Gemini as chat messages, though it’s told the short summary, and straight after, it suggests a few things that might suit you\./, 'the note at the top stays true');
    assert.match(page, /onstart=\{\(\) => startAction\(/, 'the offer card’s Start starts it here');
    assert.match(page, /offer: action && action\.shows !== 'card' \? \{ action: action\.id, state: 'offered' \} : undefined/);
    for (const file of ['src/lib/checkin/mentor-flow.js', 'src/lib/matching/find-mentor-steps.js']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"](?:firebase\/ai|#lib\/firebase\/ai\.js|#lib\/checkin\/chat(?:-turns)?\.js)['"]/, `${file} has no way to reach Gemini’s chat`);
    }
  }],
  ['The Find a mentor page uses the same steps (one place, so they can’t drift apart)', () => {
    const page = readFileSync('src/routes/find-mentor/+page.svelte', 'utf8');
    assert.match(page, /from '#lib\/matching\/find-mentor-steps\.js'/);
    assert.match(page, /const finder = createFinder\(\{ prepareStudent, matchAndSave, askCoordinator \}\);/);
    assert.match(page, /formError = checkAnswers\(answers, availability\) \?\? '';/);
    for (const words of ['{ANSWERS_NOTE}', '{SAYS.isMentor}', '{SAYS.noMentors}', '{SAYS.geminiFailed}', '{SAYS.geminiUnavailable}']) assert.ok(page.includes(words), words);
    assert.doesNotMatch(page, /SUMMARISE_FAILED|prepared = await prepareStudent/, 'the error handling is the shared one');
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
