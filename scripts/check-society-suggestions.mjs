// Measures the check-in chat's society suggestions on the made-up fixture students
// (scripts/fixtures/matching-cases.json): one student from each group tells the chat what they're
// into and asks for societies, and the reply is checked against what we'd expect for that group.
//
// The chat is asked with the app's own instructions (src/lib/checkin/chat-prompt.js) over REST, as
// make-summary-fixtures.mjs does. Replies are saved in scripts/fixtures/society-replies.json, so by
// default this only reads them and needs no Gemini. To ask Gemini again (about 11 requests, paced):
//   node --env-file=.env --env-file=.env.development.local scripts/check-society-suggestions.mjs --refresh
// Otherwise:
//   node scripts/check-society-suggestions.mjs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAT_CAMPUS, CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { AUDIENCE, findSociety, MAX_SUGGESTED, SOCIETIES, societiesInReply, societyById } from '#lib/societies/societies.js';

const REPLIES_FILE = 'scripts/fixtures/society-replies.json';

/**
 * What we'd expect for each group. anyOf: at least one of these should be suggested (empty means
 * nothing on the list really fits, so suggesting none is right). mustNot: suggesting any of these is
 * wrong. askFirst: the chat should ask what they enjoy instead of suggesting anything. These are
 * judgement calls, written down so they can be argued about.
 * @type {Record<string, { anyOf: string[], mustNot?: string[], askFirst?: boolean, why: string }>}
 */
const EXPECT = {
  'gigs, rules out sport': { anyOf: ['Music', 'Rock', 'Sync DJ'], why: 'live music' },
  'homebody, rules out partying': { anyOf: ['Book', 'Chess', 'Gaming and Roleplay'], mustNot: ['Beer'], why: 'board games, reading' },
  'sporty early riser': {
    anyOf: [],
    mustNot: ['Esports', 'Chess', 'Video Game', 'Girls Who Run'],
    why: 'the list has no football society; Girls Who Run is for women only, and the app doesn\'t know their gender'
  },
  'lie-in and the cinema': { anyOf: ['Film', 'Film & TV Production', 'Art'], why: 'photography, the cinema' },
  'gamer, last minute (near tie)': { anyOf: ['Video Game', 'Esports', 'Gaming and Roleplay', 'Game Development'], why: 'gaming' },
  'clubbing (synonyms for partying)': {
    // Thomas agreed the other dance societies count too.
    anyOf: ['Sync DJ', 'Dance', 'Beats Cartel Dance', 'Salsa and Bachata'],
    mustNot: ['Claude Builder Club'],
    why: 'clubbing, festivals'
  },
  'outdoors, rules out the gym': {
    anyOf: ['Climbing', 'Outdoor Climbing', 'Walking', 'Mountaineering', 'Kayaking'],
    mustNot: ['Pilates', 'Yoga'],
    why: 'hiking, climbing'
  },
  'unrelated to every mentor': {
    anyOf: ['Hooked By Crochet', 'Stitch, Make & Bitch', 'Language Exchange'],
    // Added after the first measurement suggested it for birdwatching: it's about art, not nature.
    mustNot: ['Conservation of Fine Art'],
    why: 'knitting, Japanese'
  },
  'only says what they don\'t want in 3 answers': {
    anyOf: [],
    // They only said what they don't like, so the chat should ask what they enjoy, not guess.
    askFirst: true,
    mustNot: ['Esports', 'Video Game', 'Gaming and Roleplay', 'Dance', 'Sync DJ'],
    why: 'only said they\'re not into sport, clubbing or gaming'
  },
  'quiet nights in, not nights out (opposites)': { anyOf: ['Book', 'Film'], mustNot: ['Beer', 'Dance', 'Sync DJ'], why: 'reading, films' },
  'live music (synonym for gigs)': { anyOf: ['Music', 'Rock'], why: 'live music, indie bands' }
};

/**
 * Extra made-up students for the community societies, with their own messages and expectations:
 * an "everyone welcome" society for someone interested but not from that community, and a group
 * society for someone who says they're in that group.
 */
const EXTRA = [
  {
    group: 'interested in Ukrainian culture, not Ukrainian',
    message: "I'm not Ukrainian, but I'd love to learn more about Ukrainian culture and meet people. Are there any societies you'd recommend?",
    expect: { anyOf: ['Ukrainian'], why: 'Ukrainian says everyone is welcome' }
  },
  {
    group: 'a mature student',
    message: "I'm a mature student, so I'm a bit older than most people on my course. Are there any societies you'd recommend?",
    expect: { anyOf: ['Mature Students'], why: 'they said they\'re in the group' }
  }
];
for (const extra of EXTRA) EXPECT[extra.group] = extra.expect;

/** @type {{ students: { id: string, group: string, answers: string[] }[] }} */
const cases = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));
// The first student in each fixture group, saying what they're into (their answers to questions 2
// and 3), then the extra students.
const askers = [
  ...Object.keys(EXPECT).filter((group) => !EXTRA.some((extra) => extra.group === group)).map((group) => {
    const student = cases.students.find((s) => s.group === group);
    if (!student) throw new Error(`No fixture student in group "${group}"`);
    return { group, id: student.id, message: `${student.answers[1]} ${student.answers[2]} Are there any societies you'd recommend?` };
  }),
  ...EXTRA.map((extra) => ({ group: extra.group, id: 'extra', message: extra.message }))
];

/** Restricted-audience societies (such as women only): the chat shouldn't even mention these. */
const RESTRICTED = Object.keys(AUDIENCE).map((id) => /** @type {{ name: string }} */ (societyById(Number(id))).name);

// A student with no mentor request and no saved checklist, so only the societies question matters.
const about = describeForGemini({ match: null, tasks: null });
const opener = buildOpener({ match: null, tasks: null, justSignedUp: false }).messages;
const instructions = chatInstructions(about, opener);
const fingerprint = createHash('sha256').update(`${CHAT_MODEL}\n${instructions}`).digest('hex').slice(0, 12);

/** @type {{ about: string, model: string, promptFingerprint: string, made: string, replies: Record<string, { student: string, message: string, reply: string }> }} */
let saved = existsSync(REPLIES_FILE)
  ? JSON.parse(readFileSync(REPLIES_FILE, 'utf8'))
  : { about: 'Check-in chat replies for check-society-suggestions.mjs. Regenerate with --refresh rather than edit.', model: CHAT_MODEL, promptFingerprint: fingerprint, made: '', replies: {} };

if (process.argv.includes('--refresh')) {
  const { geminiFromEnv } = await import('./lib/gemini-rest.mjs');
  const gemini = geminiFromEnv(process.env);
  saved = { ...saved, model: CHAT_MODEL, promptFingerprint: fingerprint, replies: {} };
  for (const asker of askers) {
    const reply = await gemini.generate(CHAT_MODEL, {
      contents: [{ role: 'user', parts: [{ text: asker.message }] }],
      systemInstruction: { role: 'system', parts: [{ text: instructions }] }
    });
    saved.replies[asker.group] = { student: asker.id, message: asker.message, reply: reply.trim() };
    saved.made = new Date().toISOString();
    writeFileSync(REPLIES_FILE, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(`  asked: ${asker.id}`);
  }
}

if (!saved.made) {
  console.log(`No saved replies yet. Run with --refresh (and --env-file=.env --env-file=.env.development.local).`);
  process.exit(2);
}
console.log(`Replies: ${REPLIES_FILE} (made ${saved.made.slice(0, 16).replace('T', ' ')} with ${saved.model})`);
if (saved.promptFingerprint !== fingerprint) {
  console.log(`NOTE: made with chat prompt ${saved.promptFingerprint}, but it's now ${fingerprint}. Run with --refresh to measure the current prompt.`);
}

const known = new Set(SOCIETIES.map((society) => society.name.toLowerCase()));
let failures = 0;
for (const asker of askers) {
  const entry = saved.replies[asker.group];
  if (!entry) {
    failures++;
    console.log(`\nFAIL  ${asker.group}: no saved reply (run with --refresh)`);
    continue;
  }
  const expect = EXPECT[asker.group];
  const { text, societies } = societiesInReply(entry.reply, CHAT_CAMPUS);
  const suggested = societies.map((society) => society.name);
  // Everything Gemini wrote in [[ ]]: real societies on this campus, and anything else (made up).
  const named = [...entry.reply.matchAll(/\[\[([^\]]{1,80})\]\]/g)].map((m) => m[1]);
  const madeUp = named.filter((name) => !findSociety(name, CHAT_CAMPUS));
  const realCount = new Set(named.filter((name) => findSociety(name, CHAT_CAMPUS)).map((name) => name.toLowerCase())).size;
  const wrong = suggested.filter((name) => expect.mustNot?.includes(name));
  const hit = expect.anyOf.length === 0 || suggested.some((name) => expect.anyOf.includes(name));
  const problems = [
    !hit ? `none of: ${expect.anyOf.join(', ')}` : '',
    wrong.length ? `shouldn't suggest: ${wrong.join(', ')}` : '',
    madeUp.length ? `not on the list: ${madeUp.join(', ')}` : '',
    expect.askFirst && suggested.length > 0 ? 'should ask what they enjoy before suggesting' : '',
    ...RESTRICTED.filter((name) => entry.reply.toLowerCase().includes(name.toLowerCase())).map((name) => `mentioned ${name} (restricted audience)`)
  ].filter(Boolean);
  if (problems.length) failures++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${asker.group} (${expect.why})`);
  const capped = realCount > MAX_SUGGESTED ? `   (named ${realCount}; the app linked the first ${MAX_SUGGESTED})` : '';
  console.log(`      suggested: ${suggested.length ? suggested.join(', ') : '(none)'}${problems.length ? `   <- ${problems.join('; ')}` : ''}${capped}`);
  console.log(`      chat said: "${text}"`);
}
console.log(`\n${askers.length - failures}/${askers.length} groups as expected`);
process.exit(failures === 0 ? 0 : 1);
