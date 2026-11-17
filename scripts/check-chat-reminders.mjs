// Measures the check-in chat's checklist reminders: it asks about reminders once in a conversation,
// at a natural point (not while they're worried), suggests one {{task: }} at a time, never says it
// has added a task (only the student's tap on the card can), and points to a task that's already on
// their checklist instead of suggesting a copy. The student never sees a marker. Made-up student and
// conversations (no real people).
//
// Gemini is asked with the app's own instructions (chat-prompt.js and opener.js) over REST, as
// check-chat-context.mjs does, and each reply is read the way the app reads it (tasksInReply, then
// linksInReply). Replies are saved in scripts/fixtures/chat-reminder-replies.json, so by default this
// only reads them and needs no Gemini. To ask Gemini again (about 11 requests, within the scripts'
// daily budget):
//   node --env-file=.env --env-file=.env.development.local scripts/check-chat-reminders.mjs --refresh
// Otherwise:
//   node scripts/check-chat-reminders.mjs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAT_CAMPUS, CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { linksInReply } from '#lib/checkin/reply-links.js';
import { tasksInReply } from '#lib/checkin/task-suggestions.js';

const REPLIES_FILE = 'scripts/fixtures/chat-reminder-replies.json';

/** A made-up student waiting for a mentor, with the GP and a society still to do. */
const TASKS = [
  { id: 'gp', title: 'Register with a GP', done: false },
  { id: 'student-id', title: 'Collect student ID', done: true },
  { id: 'society', title: 'Join a society', done: false },
  { id: 'dentist', title: 'Find a dentist', done: false },
  { id: 'contacts', title: 'Save key contacts', done: true }
];
const MATCH = /** @type {const} */ ({ status: 'coordinator', meetingFrequency: 'weekly', availability: null });
const PROFILE = { course: 'BSc Computer Science', interests: ['chess', 'gigs'] };
const INSTRUCTIONS = chatInstructions(
  describeForGemini({ match: MATCH, tasks: TASKS, profile: PROFILE }),
  buildOpener({ match: MATCH, tasks: TASKS, justSignedUp: false }).messages
);

/** The reminder question, as the chat might have asked it earlier in a scripted conversation. */
const ASKED = "Glad it's going well! Is there anything you'd like reminding about while you settle in? I can add it to your checklist.";

/** Asking about reminders: "remind" in a question. */
const asksAboutReminders = (/** @type {string} */ reply) => /remind/i.test(reply) && reply.includes('?');

/** Ways of saying it has added (or will add) a task itself, which only the student's tap can do. */
const CLAIMS_ADDED = [
  /\bI(?:'|’)ve (?:just )?(?:added|saved|put)\b/i,
  /\bI have (?:just )?(?:added|saved|put)\b/i,
  /\bI added\b/i,
  /\bI(?:'|’)ll (?:add|save|put)\b/i,
  /\bI will (?:add|save|put)\b/i,
  /\b(?:has|have) been (?:added|saved)\b/i,
  /\b(?:it|that|this)(?:'|’)s (?:been |now )?(?:added|saved)\b/i,
  /\bis now on your checklist\b/i
];

/**
 * A scripted conversation: the turns before (student, chat, student, ...), then the student's last
 * message, whose reply is checked.
 * @typedef {{ id: string, why: string, before: string[], ask: string, check: (reply: string, shown: Shown) => string[] }} Case
 * @typedef {{ text: string, tasks: string[], links: { label: string }[] }} Shown
 */

/** @type {Case[]} */
const CASES = [
  {
    id: 'bank account',
    why: 'one task, starting with a verb, and no claim that it was added',
    before: ['It’s been good thanks, just a lot to sort out', ASKED],
    ask: 'Yes, can you remind me to open a bank account?',
    check: (reply, shown) => [
      shown.tasks.length !== 1 ? `suggests ${shown.tasks.length} tasks, not 1` : '',
      shown.tasks[0] && !/bank/i.test(shown.tasks[0]) ? `the task isn't about a bank account ("${shown.tasks[0]}")` : '',
      shown.tasks[0] && !/^[A-Z][a-z]+\b/.test(shown.tasks[0]) ? `the task doesn't start with a verb ("${shown.tasks[0]}")` : '',
      shown.tasks[0] && shown.tasks[0].length > 60 ? 'the task is over 60 characters' : ''
    ]
  },
  {
    id: 'two things',
    why: 'one task at a time, even when they name two',
    before: ['It’s been good thanks, just a lot to sort out', ASKED],
    ask: 'Yes please, opening a bank account and getting a bus pass',
    check: (reply, shown) => [shown.tasks.length !== 1 ? `suggests ${shown.tasks.length} tasks, not 1` : '']
  },
  {
    id: 'add it for me',
    why: 'never says it has added it: they tap Add',
    before: ['It’s been good thanks, just a lot to sort out', ASKED, 'Yes, can you remind me to open a bank account?',
      'Good idea. Here it is: {{task: Open a bank account}}. You can add it to your checklist with one tap.'],
    ask: 'Yes, add it for me please',
    check: () => []
  },
  {
    id: 'already there',
    why: 'the GP task is on their checklist: points to it, no copy',
    before: ['Fine thanks', ASKED],
    ask: 'Yes, can you remind me to register with a GP?',
    check: (reply, shown) => [
      shown.tasks.length ? `suggests a copy ("${shown.tasks[0]}")` : '',
      /checklist/i.test(shown.text) ? '' : "doesn't point to their checklist"
    ]
  },
  {
    id: 'worried',
    why: 'not a natural point: points to support, no reminder question',
    before: [],
    ask: 'I’m really worried about money, I can’t afford food this week',
    check: (reply, shown) => [
      asksAboutReminders(reply) ? 'asks about reminders while they’re worried' : '',
      shown.links.some((link) => link.label === 'Food Pantry' || link.label === 'Cost of Living') ? '' : 'doesn’t suggest the Food Pantry or Cost of Living'
    ]
  }
];

/**
 * A longer conversation, with the chat's real replies fed back: it should ask about reminders
 * exactly once. When it asks, the student says no, then carries on.
 */
const CONVERSATION = ['Pretty good thanks, still unpacking', 'Are there any chess societies?', 'Nice. Anything for gigs?', 'Thanks, that’s really helpful', 'Have a good evening'];
const NO_THANKS = 'No thanks, nothing for now';

const fingerprint = createHash('sha256')
  .update(`${CHAT_MODEL}\n${INSTRUCTIONS}\n${JSON.stringify(CASES.map(({ id, before, ask }) => ({ id, before, ask })))}\n${CONVERSATION.join('|')}`)
  .digest('hex')
  .slice(0, 12);

/** @typedef {{ ask: string, reply: string }} Turn */
/** @type {{ about: string, model: string, promptFingerprint: string, made: string, replies: Record<string, Turn>, conversation: Turn[] }} */
let saved = existsSync(REPLIES_FILE)
  ? JSON.parse(readFileSync(REPLIES_FILE, 'utf8'))
  : { about: 'Check-in chat replies for check-chat-reminders.mjs (a made-up student). Regenerate with --refresh rather than edit.', model: CHAT_MODEL, promptFingerprint: fingerprint, made: '', replies: {}, conversation: [] };

/** @param {string[]} turns the student's and the chat's turns, in order, starting with the student */
const asContents = (turns) => turns.map((text, i) => ({ role: i % 2 === 0 ? 'user' : 'model', parts: [{ text }] }));

if (process.argv.includes('--refresh')) {
  const { geminiFromEnv } = await import('./lib/gemini-rest.mjs');
  const gemini = geminiFromEnv(process.env);
  const system = { role: 'system', parts: [{ text: INSTRUCTIONS }] };
  const save = () => writeFileSync(REPLIES_FILE, `${JSON.stringify(saved, null, 2)}\n`);
  saved = { ...saved, model: CHAT_MODEL, promptFingerprint: fingerprint, replies: {}, conversation: [] };
  for (const test of CASES) {
    const reply = (await gemini.generate(CHAT_MODEL, { contents: asContents([...test.before, test.ask]), systemInstruction: system })).trim();
    saved.replies[test.id] = { ask: test.ask, reply };
    saved.made = new Date().toISOString();
    save();
    console.log(`  asked: ${test.id}`);
  }
  /** @type {string[]} */
  const turns = [];
  const queue = [...CONVERSATION];
  while (queue.length) {
    const ask = /** @type {string} */ (queue.shift());
    const reply = (await gemini.generate(CHAT_MODEL, { contents: asContents([...turns, ask]), systemInstruction: system })).trim();
    turns.push(ask, reply);
    saved.conversation.push({ ask, reply });
    save();
    console.log(`  conversation, turn ${saved.conversation.length}`);
    if (asksAboutReminders(reply) && !saved.conversation.some((turn) => turn.ask === NO_THANKS)) queue.unshift(NO_THANKS);
  }
}

if (!saved.made) {
  console.log('No saved replies yet. Run with --refresh (and --env-file=.env --env-file=.env.development.local).');
  process.exit(2);
}
console.log(`Replies: ${REPLIES_FILE} (made ${saved.made.slice(0, 16).replace('T', ' ')} with ${saved.model})`);
if (saved.promptFingerprint !== fingerprint) {
  console.log(`NOTE: made with chat prompt ${saved.promptFingerprint}, but it's now ${fingerprint}. Run with --refresh to measure the current prompt.`);
}

/** What the student sees, read the way the app reads it. @param {string} reply @returns {Shown} */
function shownFor(reply) {
  const { text: withoutTasks, tasks } = tasksInReply(reply);
  const { text, links } = linksInReply(withoutTasks, CHAT_CAMPUS);
  return { text, tasks, links };
}

/** Checks every reply gets: no marker shown, no talk of the format, no claim of adding. @param {string} reply @param {Shown} shown */
function alwaysProblems(reply, shown) {
  const withoutMarkers = reply.replace(/\{\{[^{}]*\}\}|\[\[[^[\]]*\]\]/g, '');
  return [
    /\{\{|\}\}|\[\[|\]\]|task\s*:/i.test(shown.text) ? 'the student would see a marker' : '',
    /curly|braces?\b|brackets?\b/i.test(withoutMarkers) ? 'talks about the brackets' : '',
    ...CLAIMS_ADDED.filter((pattern) => pattern.test(shown.text)).map((pattern) => `says it added the task (${pattern.source})`)
  ];
}

let failures = 0;
let total = 0;
/** @param {string} name @param {string} why @param {string} ask @param {string} reply @param {string[]} problems */
function report(name, why, ask, reply, problems) {
  total++;
  const shown = shownFor(reply);
  const all = [...problems, ...alwaysProblems(reply, shown)].filter(Boolean);
  if (all.length) failures++;
  console.log(`\n${all.length ? 'FAIL' : 'PASS'}  ${name} (${why}): "${ask}"${all.length ? `   <- ${all.join('; ')}` : ''}`);
  console.log(`      chat said: "${shown.text}"${shown.tasks.length ? `   [card: ${shown.tasks[0]}]` : ''}`);
}

for (const test of CASES) {
  const entry = saved.replies[test.id];
  if (!entry) {
    total++;
    failures++;
    console.log(`\nFAIL  ${test.id}: no saved reply (run with --refresh)`);
    continue;
  }
  report(test.id, test.why, test.ask, entry.reply, test.check(entry.reply, shownFor(entry.reply)));
}

// The conversation: each reply on its own, then asked exactly once overall.
for (const [i, turn] of saved.conversation.entries()) report(`conversation, turn ${i + 1}`, 'any reply', turn.ask, turn.reply, []);
const asks = saved.conversation.filter((turn) => asksAboutReminders(turn.reply)).length;
total++;
if (asks !== 1) failures++;
console.log(`\n${asks === 1 ? 'PASS' : 'FAIL'}  The ${saved.conversation.length}-turn conversation asks about reminders exactly once (asked ${asks} time${asks === 1 ? '' : 's'})`);

console.log(`\n${total - failures}/${total} as expected`);
process.exit(failures === 0 ? 0 : 1);
