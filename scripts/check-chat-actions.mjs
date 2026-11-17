// Measures how the check-in chat offers what it can do itself (chat-actions.js), for now finding a
// mentor: it offers the in-chat card ({{mentor}}) instead of pointing to the Find a mentor page, when a
// student asks for a mentor, wants help settling in or organising their work, or says yes to the first
// message's offer; never to someone who has a mentor or is one, and not again after Not now unless they
// ask. It never asks the matching questions itself or says it's done. Made-up students, no real people.
//
// Gemini is asked with the app's own instructions (chat-prompt.js and opener.js) over REST, as
// check-chat-context.mjs does, and each reply is read the way the app reads it (offersInReply,
// tasksInReply, linksInReply). Replies are saved in scripts/fixtures/chat-action-replies.json, so by
// default this only reads them. To ask Gemini again (7 requests, within the scripts' daily budget):
//   node --env-file=.env --env-file=.env.development.local scripts/check-chat-actions.mjs --refresh
// Otherwise:
//   node scripts/check-chat-actions.mjs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { offersInReply } from '#lib/checkin/chat-actions.js';
import { CHAT_CAMPUS, CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { linksInReply } from '#lib/checkin/reply-links.js';
import { tasksInReply } from '#lib/checkin/task-suggestions.js';

const REPLIES_FILE = 'scripts/fixtures/chat-action-replies.json';

const TASKS = [
  { id: 'gp', title: 'Register with a GP', done: true },
  { id: 'student-id', title: 'Collect student ID', done: true },
  { id: 'society', title: 'Join a society', done: false },
  { id: 'dentist', title: 'Find a dentist', done: false },
  { id: 'contacts', title: 'Save key contacts', done: true }
];
const PROFILE = { course: 'BSc Computer Science', interests: ['chess'] };
const MATCH = /** @type {const} */ ({ status: 'matched', mentorId: 'mentor-test-id', mentorName: null, reasons: ['You share interests: chess'], meetingFrequency: 'weekly', availability: null });

/** @type {Record<string, { match: any, isMentor?: boolean, mentorNote?: 'declined' | null }>} */
const STUDENTS = {
  'no mentor': { match: null },
  matched: { match: MATCH },
  'a mentor': { match: null, isMentor: true },
  'said not now': { match: null, mentorNote: 'declined' }
};

/** The instructions the app would give Gemini for this student. @param {string} key */
function instructionsFor(key) {
  const { match, isMentor = false, mentorNote = null } = STUDENTS[key];
  return chatInstructions(
    describeForGemini({ match, tasks: TASKS, profile: PROFILE, isMentor, mentorNote }),
    buildOpener({ match, tasks: TASKS, justSignedUp: false, isMentor }).messages
  );
}

/**
 * offer: whether the reply must offer the card (true) or must not (false).
 * @type {{ id: string, student: string, ask: string, why: string, offer: boolean }[]}
 */
const CASES = [
  { id: 'focus and organise', student: 'no mentor', ask: 'I need a mentor to help me focus and organise my work', why: 'offers the card, not the page', offer: true },
  { id: 'yes to the first message', student: 'no mentor', ask: 'Yes please, I’d like a mentor', why: 'says yes to the opener’s offer', offer: true },
  { id: 'help settling in', student: 'no mentor', ask: 'I’m finding it hard to settle in. Is there someone who could help me?', why: 'wants someone to help them settle in', offer: true },
  { id: 'already has one', student: 'matched', ask: 'Can I get a mentor?', why: 'already matched: no offer', offer: false },
  { id: 'a mentor themselves', student: 'a mentor', ask: 'Can I get a mentor?', why: 'a mentor: no offer', offer: false },
  { id: 'after not now', student: 'said not now', ask: 'Are there any chess societies?', why: 'said not now: no offer', offer: false },
  { id: 'asks after not now', student: 'said not now', ask: 'Actually, could you find me a mentor after all?', why: 'they ask: offer again', offer: true }
];

/** The matching questions, which only the app asks. */
const ASKS_MATCHING = /what would you like help with|what do you enjoy|good weekend|how do you like to work|what matters most|what would make a mentor|what are you looking for in a mentor|how often would you like to meet|when are you (?:usually )?free/i;
/** Saying it's found or will find one, which only the app does once they tap. */
const CLAIMS = [/\bI(?:'|’)ve (?:found|matched|signed)/i, /\bI(?:'|’)ll (?:find|match|sign you up)/i, /\bI will (?:find|match)/i, /\byou(?:'|’)re (?:now )?(?:signed up|matched)/i];

const instructions = Object.fromEntries(Object.keys(STUDENTS).map((key) => [key, instructionsFor(key)]));
const fingerprint = createHash('sha256').update(`${CHAT_MODEL}\n${JSON.stringify(instructions)}\n${JSON.stringify(CASES.map(({ id, ask }) => [id, ask]))}`).digest('hex').slice(0, 12);

/** @type {{ about: string, model: string, promptFingerprint: string, made: string, replies: Record<string, { ask: string, reply: string }> }} */
let saved = existsSync(REPLIES_FILE)
  ? JSON.parse(readFileSync(REPLIES_FILE, 'utf8'))
  : { about: 'Check-in chat replies for check-chat-actions.mjs (made-up students). Regenerate with --refresh rather than edit.', model: CHAT_MODEL, promptFingerprint: fingerprint, made: '', replies: {} };

if (process.argv.includes('--refresh')) {
  const { geminiFromEnv } = await import('./lib/gemini-rest.mjs');
  const gemini = geminiFromEnv(process.env);
  saved = { ...saved, model: CHAT_MODEL, promptFingerprint: fingerprint, replies: {} };
  for (const test of CASES) {
    const reply = await gemini.generate(CHAT_MODEL, {
      contents: [{ role: 'user', parts: [{ text: test.ask }] }],
      systemInstruction: { role: 'system', parts: [{ text: instructions[test.student] }] }
    });
    saved.replies[test.id] = { ask: test.ask, reply: reply.trim() };
    saved.made = new Date().toISOString();
    writeFileSync(REPLIES_FILE, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(`  asked: ${test.id}`);
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

let failures = 0;
for (const test of CASES) {
  const entry = saved.replies[test.id];
  if (!entry) {
    failures++;
    console.log(`\nFAIL  ${test.id}: no saved reply (run with --refresh)`);
    continue;
  }
  const { text: withoutOffers, offers } = offersInReply(entry.reply);
  const { text: withoutTasks } = tasksInReply(withoutOffers);
  const { text, links } = linksInReply(withoutTasks, CHAT_CAMPUS);
  const questions = text.match(/[^.!?]*\?/g) ?? [];
  const problems = [
    test.offer && !offers.includes('mentor') ? 'doesn’t offer the card' : '',
    !test.offer && offers.includes('mentor') ? 'offers the card when it shouldn’t' : '',
    /find a mentor page|\[\[find a mentor\]\]/i.test(entry.reply) || links.some((link) => link.href === '/find-mentor') ? 'points to the Find a mentor page' : '',
    questions.some((question) => ASKS_MATCHING.test(question)) ? 'asks the matching questions itself' : '',
    ...CLAIMS.filter((pattern) => pattern.test(text)).map((pattern) => `says it’s done or will be (${pattern.source})`),
    /\{\{|\}\}|\[\[|\]\]/.test(text) ? 'the student would see a marker' : '',
    text.trim() === '' ? 'only the marker, no words for the student' : ''
  ].filter(Boolean);
  if (problems.length) failures++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${test.id} (${test.why}): "${test.ask}"${problems.length ? `   <- ${problems.join('; ')}` : ''}`);
  console.log(`      chat said: "${text}"${offers.length ? `   [card: ${offers.join(', ')}]` : ''}`);
}
console.log(`\n${CASES.length - failures}/${CASES.length} as expected`);
process.exit(failures === 0 ? 0 : 1);
