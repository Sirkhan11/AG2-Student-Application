// Whole conversations with the check-in chat, as a new student would have them, through the app's own
// code: the chat's engine (chat-turns.js, with its tools) asking Gemini through the real Firebase AI
// Logic SDK (chat-over-rest.mjs), and the app's changes (chat-do.js) made on a made-up checklist and
// notes in memory. It prints each conversation to read, flags what a script can tell is wrong (the
// "is it right?" list in agent1.md A8: the same stock sentence twice, an error, a made-up score, a
// page or Ask4Help sent instead of looking something up, a tick to look at), gives the cost per
// message, and saves the transcripts to scripts/fixtures/chat-conversations.json to re-read later.
//
// The conversations: Thomas's own messages from the live site, exactly as he typed them, in order, and
// two free conversations that change subject partway through (made-up students; no real people).
// Every request counts in the scripts' daily Gemini budget (about 1.6 a message).
//
// From the project folder:
//   node --env-file=.env --env-file=.env.development.local scripts/try-chat.mjs [--only thomas,free-1,free-2]
//   node scripts/try-chat.mjs --saved     (prints the saved transcripts again, without Gemini)

import { readFileSync, writeFileSync } from 'node:fs';
import { applyChange, defaultTasks } from '#lib/checklist/tasks.js';
import { chatWith } from '#lib/checkin/chat-turns.js';
import { createChatDo } from '#lib/checkin/chat-do.js';
import { afterMentorNote, CHAT_MODEL, openNote } from '#lib/checkin/chat-prompt.js';

const SAVED = 'scripts/fixtures/chat-conversations.json';
/** Prices per million tokens on the paid tier for the chat's model (checked 18 November 2026). */
const PRICE = { input: 0.3, output: 2.5 };

/**
 * One conversation: the made-up student, and what they say in turn. "stop the mentor questions":
 * what the page does if the chat started finding a mentor (the script doesn't run those questions).
 * @typedef {{ name: string, about: string, facts: Partial<import('#lib/checkin/chat-turns.js').ChatFacts>, says: string[] }} Conversation
 */

/** @type {Conversation[]} */
const CONVERSATIONS = [
  {
    name: 'thomas',
    about: 'Thomas’s messages from the live site, exactly as typed, in the order he sent them (with "I love dancing" before the tick, as he had the Salsa and Bachata card)',
    facts: { profile: { name: 'Thomas', course: 'BSc Computer Science', interests: ['dancing', 'gym'], arrivalDate: '', notes: [] }, tasks: defaultTasks().map((task) => ({ ...task, done: task.id === 'enrol' })) },
    says: [
      'i dont need to register for a gp i need a mentor to help me focus and orginise work',
      'okay great now what',
      'yes but that is overwhelming can you help me do them 1 by 1?',
      'I love dancing, are there any societies?',
      'ah brill ive joined that now can you tick it off my list?',
      'what do you mean a reminder can i set reminders on here?',
      'nah im good i keep everyhting on my outlook calender',
      'sure where is the closest dentist and how does it work?',
      'okay done that whats next?',
      'how do i do this?',
      'can you not check if there is a gym society?',
      'what is the score of england last match?',
      'but no society can you sarch for me?',
      'what was the score in the last england match'
    ]
  },
  {
    name: 'free-1',
    about: 'A home student, tired after moving in: small talk, cooking, homesick, societies, the checklist, a tick, football banter',
    facts: { profile: { name: 'Jess', course: 'BA English Literature', interests: ['baking', 'football'], arrivalDate: '', notes: [] }, tasks: defaultTasks() },
    says: [
      'hiya',
      'honestly knackered, just moved in and the kitchen is a state',
      'any easy meals I can make with like a kettle and a microwave lol',
      'do you get homesick? I kinda miss my mams cooking',
      'are there any baking or cooking societies?',
      'nice. whats left on my checklist?',
      'I picked up my student card today actually',
      'did you see the toon game last night',
      'ok im off out, cheers'
    ]
  },
  {
    name: 'free-2',
    about: 'An international student, just arrived: where to start, a money worry (no advice: the right service), the GP, a society, laundry, a reminder',
    facts: { profile: { name: 'Tobi', course: 'MSc Data Science', interests: ['afrobeats', 'football'], arrivalDate: '2026-11-17', notes: [] }, tasks: defaultTasks() },
    says: [
      'hello, I just arrived from Lagos yesterday',
      'where do I even start',
      'Im a bit worried about money, my loan hasnt come through',
      'how does the GP thing work here, do I have to pay?',
      'ok and is there a nigerian society?',
      'how do i use the laundry machines in halls',
      'thanks, can you remind me to sort my bank account',
      'brilliant'
    ]
  }
];

/** @param {string} text */
const sentences = (text) => (text.match(/[^.!?]+[.!?]*/g) ?? []).map((sentence) => sentence.trim().toLowerCase()).filter((sentence) => sentence.split(' ').length >= 4);

/**
 * What a script can tell is wrong with a conversation (the rest is for reading).
 * @param {{ says: string, reply: any }[]} turns
 */
function flags(turns) {
  const out = [];
  const seen = new Map();
  for (const [i, turn] of turns.entries()) {
    const text = turn.reply.text ?? '';
    if (turn.reply.kind !== 'reply') out.push(`${i}: ${turn.reply.kind} ("${text.slice(0, 60)}")`);
    for (const sentence of sentences(text)) {
      if (seen.has(sentence)) out.push(`${i}: said again from ${seen.get(sentence)}: "${sentence}"`);
      else seen.set(sentence, i);
    }
    if (/\b\d+\s*[-–]\s*\d+\b/.test(text) && /score|match|game|won|lost|drew/i.test(turn.says)) out.push(`${i}: a score? "${text.slice(0, 80)}"`);
    if (turn.reply.ask4help) out.push(`${i}: showed Ask4Help (check it was the best next step)`);
    for (const link of turn.reply.links ?? []) if (!link.kind) out.push(`${i}: a button to ${link.href} (check it helps)`);
    for (const change of turn.reply.changes ?? []) if (/^Ticked/.test(change.text)) out.push(`${i}: ticked "${change.text}" after "${turn.says}" (check they said it's done)`);
    if ((text.match(/!/g) ?? []).length > 1) out.push(`${i}: more than one exclamation mark`);
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) out.push(`${i}: an emoji`);
  }
  return out;
}

/** Prints one conversation. @param {{ name: string, about: string, turns: { says: string, reply: any }[] }} conversation */
function print(conversation) {
  console.log(`\n=== ${conversation.name}: ${conversation.about}`);
  for (const { says, reply } of conversation.turns) {
    if (says) console.log(`\nStudent: ${says}`);
    for (const change of reply.changes ?? []) console.log(`  [${change.text} · Undo]`);
    console.log(`Chat: ${reply.text}`);
    const shown = [
      ...(reply.links ?? []).map((/** @type {any} */ link) => (link.kind ? `card: ${link.label}` : `button: ${link.label}`)),
      reply.tool && `card: ${reply.tool}`,
      reply.ask4help && 'card: Ask4Help',
      reply.calendar && `card: calendar (${reply.calendar.title})`,
      ...(reply.tasks ?? []).map((/** @type {string} */ task) => `Add card: ${task}`),
      ...(reply.notes ?? []).map((/** @type {string} */ note) => `Remember card: ${note}`),
      ...(reply.offers ?? []).map((/** @type {string} */ offer) => `card: ${offer}`),
      reply.start && `starts: ${reply.start}`,
      reply.quick?.length && `quick replies: ${reply.quick.map((/** @type {any} */ quick) => quick.label).join(' | ')}`
    ].filter(Boolean);
    if (shown.length) console.log(`  (${shown.join('; ')})`);
  }
  const found = flags(conversation.turns.filter((turn) => turn.says));
  console.log(found.length ? `\nTo look at:\n- ${found.join('\n- ')}` : '\nNothing a script can flag.');
}

if (process.argv.includes('--saved')) {
  const saved = JSON.parse(readFileSync(SAVED, 'utf8'));
  for (const conversation of saved.conversations) print(conversation);
  process.exit(0);
}

const at = process.argv.indexOf('--only');
const only = at === -1 ? null : process.argv[at + 1].split(',');
const { geminiFromEnv } = await import('./lib/gemini-rest.mjs');
const { restModel } = await import('./lib/chat-over-rest.mjs');
const gemini = geminiFromEnv(process.env);
const model = restModel(gemini);

const results = [];
for (const conversation of CONVERSATIONS.filter((item) => !only || only.includes(item.name))) {
  const state = { tasks: conversation.facts.tasks ?? defaultTasks(), notes: /** @type {{ text: string, savedAt: number }[]} */ ([]) };
  const act = createChatDo({
    loadTasks: async () => state.tasks,
    saveChange: async (change, list) => (state.tasks = applyChange(list, change)),
    loadNotes: async () => state.notes,
    remember: async (text) => (state.notes.some((note) => note.text === text) ? 'exists' : (state.notes.push({ text, savedAt: Date.now() }), 'saved')),
    forget: async (note) => void (state.notes = state.notes.filter((saved) => saved !== note)),
    forgetAll: async () => void (state.notes = [])
  });
  /** @type {import('#lib/checkin/chat-turns.js').ChatFacts} */
  const facts = { match: null, tasks: state.tasks, checklistSaved: true, profile: null, isMentor: false, mentorNote: null, today: '2026-11-18', ...conversation.facts };
  const chat = chatWith(model, { facts, act });
  const turns = [{ says: '', reply: await chat.prompt(openNote()) }];
  for (const says of conversation.says) {
    const reply = await chat.send(says);
    turns.push({ says, reply });
    // The page would ask the six mentor questions here (no Gemini). This script takes them as answered
    // and matched, tells Gemini as the page does (without the mentor's name, with a summary), and has
    // Gemini write its message after the match, as the page does.
    if (reply.start === 'mentor') {
      chat.retell({
        ...chat.facts(),
        match: { status: 'matched', mentorId: 'made-up', mentorName: null, reasons: ['You both want help staying organised'], meetingFrequency: 'weekly', availability: null },
        mentorNote: null,
        profile: { ...chat.facts().profile, matchingSummary: { likes: ['staying organised', 'focusing on work'], avoids: [], styles: { social: null, planning: 'planning ahead', working: null } } }
      });
      turns.push({ says: '(the app asks the six questions: answered, and matched)', reply: await chat.prompt(afterMentorNote('matched')) });
    }
  }
  const done = { name: conversation.name, about: conversation.about, turns: turns.map(({ says, reply }) => ({ says, reply: { ...reply, changes: reply.changes?.map((change) => ({ text: change.text })) } })) };
  results.push(done);
  print(done);
}

const usage = gemini.usage;
const requests = usage.length;
const messages = results.reduce((total, conversation) => total + conversation.turns.length, 0);
const input = usage.reduce((total, used) => total + (used.promptTokenCount ?? 0), 0);
const output = usage.reduce((total, used) => total + (used.candidatesTokenCount ?? 0) + (used.thoughtsTokenCount ?? 0), 0);
const dollars = (input * PRICE.input + output * PRICE.output) / 1e6;
console.log(`\n${requests} Gemini requests for ${messages} messages (${(requests / Math.max(1, messages)).toFixed(2)} a message); on average ${Math.round(input / Math.max(1, requests))} tokens in and ${Math.round(output / Math.max(1, requests))} out a request; about $${(dollars / Math.max(1, messages)).toFixed(4)} a message with ${CHAT_MODEL}.`);
// With --only, the other conversations saved before stay as they were.
const before = only ? JSON.parse(readFileSync(SAVED, 'utf8')).conversations.filter((/** @type {any} */ saved) => !only.includes(saved.name)) : [];
const conversations = CONVERSATIONS.map((item) => results.find((done) => done.name === item.name) ?? before.find((/** @type {any} */ saved) => saved.name === item.name)).filter(Boolean);
writeFileSync(SAVED, `${JSON.stringify({ about: 'Whole conversations with the check-in chat (made-up students; Thomas’s own messages from the live site). Remade by try-chat.mjs.', model: CHAT_MODEL, made: new Date().toISOString(), conversations }, null, 1)}\n`);
console.log(`Saved to ${SAVED}.`);
