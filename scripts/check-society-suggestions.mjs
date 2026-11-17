// Measures the check-in chat's suggestions of societies and NSU services on made-up students: one
// student from each fixture group (scripts/fixtures/matching-cases.json) tells the chat what they're
// into and asks for societies, and a few extra students ask about community societies or a worry
// (money, food, academic misconduct, a landlord). Each reply is checked against what we'd expect.
//
// The chat is asked with the app's own instructions (src/lib/checkin/chat-prompt.js) over REST, as
// make-summary-fixtures.mjs does. Replies are saved in scripts/fixtures/society-replies.json, so by
// default this only reads them and needs no Gemini. To ask Gemini again (about 17 requests, paced):
//   node --env-file=.env --env-file=.env.development.local scripts/check-society-suggestions.mjs --refresh
// Otherwise:
//   node scripts/check-society-suggestions.mjs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAT_CAMPUS, CHAT_MODEL, chatInstructions } from '#lib/checkin/chat-prompt.js';
import { buildOpener, describeForGemini } from '#lib/checkin/opener.js';
import { linksInReply, MAX_LINKS } from '#lib/checkin/reply-links.js';
import { findService, NOT_IN_CHAT, serviceById } from '#lib/nsu/services.js';
import { AUDIENCE, findSociety, societyById } from '#lib/societies/societies.js';

const REPLIES_FILE = 'scripts/fixtures/society-replies.json';

/**
 * What we'd expect for each group. anyOf: at least one of these should be suggested (empty means
 * nothing on the list really fits, so suggesting none is right). mustNot: suggesting any of these is
 * wrong. askFirst: the chat should ask what they enjoy instead of suggesting anything. These are
 * judgement calls, written down so they can be argued about.
 * @type {Record<string, { anyOf: string[], mustNot?: string[], askFirst?: boolean, why: string }>}
 */
const EXPECT = {
  'gigs, rules out sport': {
    anyOf: ['Music', 'Rock', 'Sync DJ', 'Gigs', 'Events'],
    // Added with the wider Sport rule: they said "Not sport."
    mustNot: ['Sport'],
    why: 'live music'
  },
  'homebody, rules out partying': { anyOf: ['Book', 'Chess', 'Gaming and Roleplay'], mustNot: ['Beer'], why: 'board games, reading' },
  'sporty early riser': {
    // Changed when the NSU services were added: before, nothing on the lists fitted (no football
    // society), but Northumbria Sport, the Sport service, has the sports clubs.
    anyOf: ['Sport'],
    mustNot: ['Esports', 'Chess', 'Video Game', 'Girls Who Run'],
    why: 'football and the gym: the Sport service has the sports clubs; Girls Who Run is for women only'
  },
  'lie-in and the cinema': { anyOf: ['Film', 'Film & TV Production', 'Art'], why: 'photography, the cinema' },
  'gamer, last minute (near tie)': { anyOf: ['Video Game', 'Esports', 'Gaming and Roleplay', 'Game Development'], why: 'gaming' },
  'clubbing (synonyms for partying)': {
    // Thomas agreed the other dance societies count too.
    // NSU's Events and Gigs pages count too, as the chat points nights-out students there.
    anyOf: ['Sync DJ', 'Dance', 'Beats Cartel Dance', 'Salsa and Bachata', 'Events', 'Gigs'],
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
  'live music (synonym for gigs)': { anyOf: ['Music', 'Rock', 'Gigs', 'Events'], why: 'live music, indie bands' }
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
  },
  {
    group: 'worried about money',
    message: "I'm really worried about money. My loan won't last until the end of term and I don't know what to do.",
    expect: { anyOf: ['Cost of Living', 'Advice Centre'], why: 'money worries: an NSU service, not advice' }
  },
  {
    group: 'run out of money for food',
    message: "I've run out of money for food this week and I'm not sure what to do.",
    expect: { anyOf: ['Food Pantry', 'Cost of Living'], why: 'food: the Food Pantry' }
  },
  {
    group: 'accused of plagiarism',
    message: "I've been accused of plagiarism in one of my essays and I'm panicking.",
    expect: { anyOf: ['Advice Centre'], why: 'academic misconduct: the Advice Centre' }
  },
  {
    group: 'landlord won\'t fix the damp',
    message: "My landlord won't fix the damp in my flat and keeps ignoring my messages. Can I complain?",
    expect: { anyOf: ['Advice Centre', 'Rate Your Landlord'], why: 'housing and complaints: the Advice Centre' }
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

/**
 * Things the chat shouldn't even mention: restricted-audience societies (such as women only), and
 * services left out of the chat (such as the Freshers Week wristband).
 */
const UNMENTIONABLE = [
  ...Object.keys(AUDIENCE).map((id) => /** @type {{ name: string }} */ (societyById(Number(id))).name),
  ...NOT_IN_CHAT.map((id) => /** @type {{ name: string }} */ (serviceById(id)).name)
];

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

let failures = 0;
for (const asker of askers) {
  const entry = saved.replies[asker.group];
  if (!entry) {
    failures++;
    console.log(`\nFAIL  ${asker.group}: no saved reply (run with --refresh)`);
    continue;
  }
  const expect = EXPECT[asker.group];
  const { text, links } = linksInReply(entry.reply, CHAT_CAMPUS);
  const suggested = links.map((link) => link.label);
  // Everything Gemini wrote in [[ ]]: real societies (on this campus) and services, and anything else (made up).
  const named = [...entry.reply.matchAll(/\[\[([^\]]{1,80})\]\]/g)].map((m) => m[1]);
  const isReal = (/** @type {string} */ name) => Boolean(findService(name) || findSociety(name, CHAT_CAMPUS));
  const madeUp = named.filter((name) => !isReal(name));
  const realCount = new Set(named.filter(isReal).map((name) => name.toLowerCase())).size;
  const wrong = suggested.filter((name) => expect.mustNot?.includes(name));
  const hit = expect.anyOf.length === 0 || suggested.some((name) => expect.anyOf.includes(name));
  const problems = [
    !hit ? `none of: ${expect.anyOf.join(', ')}` : '',
    wrong.length ? `shouldn't suggest: ${wrong.join(', ')}` : '',
    madeUp.length ? `not on the list: ${madeUp.join(', ')}` : '',
    expect.askFirst && suggested.length > 0 ? 'should ask what they enjoy before suggesting' : '',
    ...UNMENTIONABLE.filter((name) => entry.reply.toLowerCase().includes(name.toLowerCase())).map((name) => `mentioned ${name}, which the chat leaves out`)
  ].filter(Boolean);
  if (problems.length) failures++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${asker.group} (${expect.why})`);
  const capped = realCount > MAX_LINKS ? `   (named ${realCount}; the app linked the first ${MAX_LINKS})` : '';
  console.log(`      suggested: ${suggested.length ? suggested.join(', ') : '(none)'}${problems.length ? `   <- ${problems.join('; ')}` : ''}${capped}`);
  console.log(`      chat said: "${text}"`);
}
console.log(`\n${askers.length - failures}/${askers.length} groups as expected`);
process.exit(failures === 0 ? 0 : 1);
