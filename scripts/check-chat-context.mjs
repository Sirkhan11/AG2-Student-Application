// Measures what the check-in chat says about the student's own situation: why they were matched
// with their mentor, how often they asked to meet, what's left on their checklist, who their mentor
// is, and a society for their course. Made-up students (no real people): one matched, one waiting
// for the coordinator, one who hasn't asked for a mentor.
//
// The chat is asked with the app's own instructions and description of the student (chat-prompt.js
// and opener.js), over REST as make-summary-fixtures.mjs does. Replies are saved in
// scripts/fixtures/chat-context-replies.json, so by default this only reads them and needs no Gemini.
// To ask Gemini again (8 requests, paced):
//   node --env-file=.env --env-file=.env.development.local scripts/check-chat-context.mjs --refresh
// Otherwise:
//   node scripts/check-chat-context.mjs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAT_CAMPUS, CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { linksInReply } from '#lib/checkin/reply-links.js';
import { offersInReply } from '#lib/checkin/chat-actions.js';

const REPLIES_FILE = 'scripts/fixtures/chat-context-replies.json';

/** The made-up mentor's name and id, and the student's availability note: Gemini is never told them. */
const MENTOR_NAME = 'Morgan Testperson';
const NEVER_SHOWN = [/Morgan/i, /Testperson/i, /mentor-test-id/i, /Tuesday evenings/i];

const TASKS = [
  { id: 'gp', title: 'Register with a GP', done: true },
  { id: 'student-id', title: 'Collect your student ID', done: true },
  { id: 'society', title: 'Join a society', done: false },
  { id: 'dentist', title: 'Find a dentist', done: false },
  { id: 'contacts', title: 'Save your key contacts', done: true }
];

/** @type {Record<string, { match: any, tasks: any, profile: { course: string | null, interests: string[] } }>} */
const STUDENTS = {
  matched: {
    match: {
      status: 'matched',
      mentorId: 'mentor-test-id',
      mentorName: MENTOR_NAME,
      reasons: ['You share interests: live music, gigs', 'You like similar weekends: cinema', "They're the kind of mentor you asked for: laid-back"],
      meetingFrequency: 'every two weeks',
      availability: 'Tuesday evenings'
    },
    tasks: TASKS,
    profile: { course: 'BA English Literature', interests: ['reading', 'gigs'] }
  },
  waiting: {
    match: { status: 'coordinator', meetingFrequency: 'weekly', availability: 'Tuesday evenings' },
    tasks: TASKS,
    profile: { course: 'BSc Computer Science', interests: [] }
  },
  'no mentor': { match: null, tasks: TASKS, profile: { course: null, interests: [] } }
};

/** Ways of saying it can't know why they were matched, which it never should when it has the reasons. */
const CANT_KNOW = [
  /\bcan(?:not|'t|’t| not)\s+(?:see|access|view|say|tell|know)\b/i,
  /\b(?:don'?t|don’t|do not)\s+(?:have|know)\s+(?:access|the details|the reasons|why|that)/i,
  /\bnot sure\s+(?:why|about)\b/i
];

/**
 * What each case asks, and what a good reply does. expect: a pattern the reply must match;
 * link: a society the reply must link.
 * also: a second pattern the reply must match; noAskWhy: the reply mustn't ask why, or for a reason.
 * notPage: the reply mustn't send them to the Find a mentor page (the chat finds a mentor itself).
 * @type {{ id: string, student: string, ask: string, why: string, expect?: RegExp, also?: RegExp, link?: string, noCantKnow?: boolean, noAskWhy?: boolean, notPage?: boolean }[]}
 */
const CASES = [
  { id: 'why matched', student: 'matched', ask: 'Why did you match me with my mentor?', why: 'uses the saved reasons', expect: /live music|gigs|cinema|laid[- ]back/i, noCantKnow: true },
  { id: 'how often', student: 'matched', ask: 'How often will we meet?', why: 'the frequency they asked for', expect: /two weeks|fortnight/i },
  { id: 'checklist', student: 'matched', ask: "What's left on my checklist?", why: 'names a task not done yet', expect: /society|dentist/i },
  { id: 'who is my mentor', student: 'matched', ask: 'Who is my mentor?', why: 'points to the Your Mentor page, with no name', expect: /your mentor/i },
  { id: 'course society', student: 'matched', ask: 'Can you suggest a society for my course?', why: 'uses their course', link: 'English' },
  { id: 'why matched, waiting', student: 'waiting', ask: 'Why did you match me with my mentor?', why: 'the coordinator is finding one', expect: /coordinator/i },
  // No mentor yet: the chat offers to find one right here (the {{mentor}} card), never the Find a mentor page.
  { id: 'why matched, no mentor', student: 'no mentor', ask: 'Why did you match me with my mentor?', why: 'says they haven’t got one; any offer is the card, never the page', expect: /(?:haven.t|have not|don.t have|do not have)[^.]*mentor|no mentor|not been matched|n.t been matched|haven.t been matched|yet/i, notPage: true },
  { id: 'change mentor', student: 'matched', ask: 'I don’t think my mentor is right for me. Can I change?', why: 'the Your Mentor page, where only the coordinator sees the reason; never asks why', expect: /your mentor/i, also: /coordinator/i, noAskWhy: true }
];

/** Offering to find a mentor in words ("I can find you one here"), which must come with the card's marker. */
const OFFERS_IN_WORDS = /(?:I|we) can (?:help you )?find you (?:a |one|a student )|answer a few questions here|find (?:you )?(?:a mentor|one) (?:right )?here/i;

/** A question in the reply asking why, or for their reason. @param {string} reply */
const asksWhy = (reply) => (reply.match(/[^.!?]*\?/g) ?? []).some((question) => /\bwhy\b|what (?:happened|went wrong|'s wrong|is wrong)|reason|tell me (?:more|about)/i.test(question));

/** The instructions the app would give Gemini for this student (it never gets the mentor's name). */
function instructionsFor(/** @type {string} */ key) {
  const { match, tasks, profile } = STUDENTS[key];
  const withoutName = match?.status === 'matched' ? { ...match, mentorName: null } : match;
  return chatInstructions(describeForGemini({ match, tasks, profile }), buildOpener({ match: withoutName, tasks, justSignedUp: false }).messages);
}

const instructions = Object.fromEntries(Object.keys(STUDENTS).map((key) => [key, instructionsFor(key)]));
const fingerprint = createHash('sha256').update(`${CHAT_MODEL}\n${JSON.stringify(instructions)}`).digest('hex').slice(0, 12);

/** @type {{ about: string, model: string, promptFingerprint: string, made: string, replies: Record<string, { ask: string, reply: string }> }} */
let saved = existsSync(REPLIES_FILE)
  ? JSON.parse(readFileSync(REPLIES_FILE, 'utf8'))
  : { about: 'Check-in chat replies for check-chat-context.mjs (made-up students). Regenerate with --refresh rather than edit.', model: CHAT_MODEL, promptFingerprint: fingerprint, made: '', replies: {} };

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
  const { text, links } = linksInReply(offersInReply(entry.reply).text, CHAT_CAMPUS);
  const problems = [
    test.expect && !test.expect.test(entry.reply) ? `doesn't do what's expected (${test.why})` : '',
    test.also && !test.also.test(entry.reply) ? `doesn't mention ${test.also.source}` : '',
    test.noAskWhy && asksWhy(entry.reply) ? 'asks why, or for their reason' : '',
    test.notPage && /find a mentor page|\[\[find a mentor\]\]/i.test(entry.reply) ? 'sends them to the Find a mentor page' : '',
    OFFERS_IN_WORDS.test(entry.reply) && !offersInReply(entry.reply).offers.includes('mentor') ? 'offers to find a mentor in words, without the card' : '',
    test.link && !links.some((link) => link.label === test.link) ? `doesn't suggest ${test.link}` : '',
    test.noCantKnow && CANT_KNOW.some((pattern) => pattern.test(entry.reply)) ? 'says it can\'t know' : '',
    ...NEVER_SHOWN.filter((pattern) => pattern.test(entry.reply)).map((pattern) => `shows something it was never told (${pattern.source})`)
  ].filter(Boolean);
  if (problems.length) failures++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${test.id} (${test.why}): "${test.ask}"${problems.length ? `   <- ${problems.join('; ')}` : ''}`);
  console.log(`      chat said: "${text}"`);
}
console.log(`\n${CASES.length - failures}/${CASES.length} as expected`);
process.exit(failures === 0 ? 0 : 1);
