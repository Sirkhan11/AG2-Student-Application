// Measures the check-in chat's suggestions of societies and NSU services on made-up students: one
// student from each fixture group (scripts/fixtures/matching-cases.json) tells the chat what they're
// into and asks for societies, and a few extra students ask about community societies or a worry
// (money, food, academic misconduct, a landlord). Each reply is checked against what we'd expect.
// Then a few follow-ups in two turns: a student gets a suggestion, then asks how to contact or join
// it, or what it's like. The chat should name the same society again in [[ ]] (so the app shows its
// card, with its details, contact buttons and how to join), never say it can't see the details, and
// never write an email address, handle or link of its own.
//
// The chat is asked with the app's own instructions (src/lib/checkin/chat-prompt.js) over REST, as
// make-summary-fixtures.mjs does. Replies are saved in scripts/fixtures/society-replies.json, so by
// default this only reads them and needs no Gemini. To ask Gemini again (about 25 requests, paced):
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

/**
 * Follow-ups about a suggested society, in two turns: the first message asks for societies, the
 * second asks about the suggestion.
 */
const FOLLOWUPS = [
  { group: 'how to contact a suggested society', first: "I love knitting and crochet. Are there any societies you'd recommend?", then: 'How can I contact them?' },
  { group: 'how to join a suggested society', first: "I'm really into climbing and bouldering. Are there any societies you'd recommend?", then: 'How do I join?' },
  { group: 'what a suggested society is like', first: 'I like board games and tabletop role-playing games. Are there any societies for that?', then: "What's it like?" },
  // Films rather than photography: there's no photography society, so nothing to follow up.
  { group: 'a suggested society\'s Instagram', first: "I love films and going to the cinema. Are there any societies you'd recommend?", then: 'Do they have an Instagram?' }
];

/** Ways of saying it can't see a society's details, which the chat never should: the card shows them. */
const CANT_SEE = [
  /\bcan(?:not|'t|’t| not)\s+(?:see|access|view|say|tell)\b/i,
  /\b(?:don'?t|don’t|do not)\s+have\s+(?:access|(?:any|their|the)\s+(?:details|contact|information|email|social))/i,
  /\b(?:unable|not able)\s+to\s+(?:see|access|view|say|tell)\b/i,
  /\bno access\b/i,
  /\b(?:don'?t|don’t|do not)\s+know\s+(?:their|the|what|if|whether|about)\b/i,
  /\bnot sure\s+(?:about|what|if|whether)\b/i
];
/** An email address, @handle or web link the chat wrote itself. The cards hold the real ones. */
const OWN_CONTACT = /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<![\w.])@[A-Za-z0-9_.]{2,}|https?:\/\/|www\./i;

// A student with no mentor request and no saved checklist, so only the societies question matters.
const about = describeForGemini({ match: null, tasks: null });
const opener = buildOpener({ match: null, tasks: null, justSignedUp: false }).messages;
const instructions = chatInstructions(about, opener);
const fingerprint = createHash('sha256').update(`${CHAT_MODEL}\n${instructions}`).digest('hex').slice(0, 12);

/**
 * @type {{ about: string, model: string, promptFingerprint: string, made: string,
 *   replies: Record<string, { student: string, message: string, reply: string }>,
 *   followups?: Record<string, { first: string, firstReply: string, then: string, thenReply: string }> }}
 */
let saved = existsSync(REPLIES_FILE)
  ? JSON.parse(readFileSync(REPLIES_FILE, 'utf8'))
  : { about: 'Check-in chat replies for check-society-suggestions.mjs. Regenerate with --refresh rather than edit.', model: CHAT_MODEL, promptFingerprint: fingerprint, made: '', replies: {}, followups: {} };

if (process.argv.includes('--refresh')) {
  const { geminiFromEnv } = await import('./lib/gemini-rest.mjs');
  const gemini = geminiFromEnv(process.env);
  saved = { ...saved, model: CHAT_MODEL, promptFingerprint: fingerprint, replies: {}, followups: {} };
  const system = { role: 'system', parts: [{ text: instructions }] };
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
  // Follow-ups: the second request carries the first reply as the app's chat does, in Gemini's own [[ ]] form.
  for (const followup of FOLLOWUPS) {
    const user = (/** @type {string} */ text) => ({ role: 'user', parts: [{ text }] });
    const firstReply = (await gemini.generate(CHAT_MODEL, { contents: [user(followup.first)], systemInstruction: system })).trim();
    const thenReply = (await gemini.generate(CHAT_MODEL, {
      contents: [user(followup.first), { role: 'model', parts: [{ text: firstReply }] }, user(followup.then)],
      systemInstruction: system
    })).trim();
    /** @type {NonNullable<typeof saved.followups>} */ (saved.followups)[followup.group] = { first: followup.first, firstReply, then: followup.then, thenReply };
    saved.made = new Date().toISOString();
    writeFileSync(REPLIES_FILE, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(`  asked: ${followup.group}`);
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

let followupFailures = 0;
console.log('\n-- Follow-ups about a suggested society');
for (const followup of FOLLOWUPS) {
  const entry = saved.followups?.[followup.group];
  if (!entry) {
    followupFailures++;
    console.log(`\nFAIL  ${followup.group}: no saved reply (run with --refresh)`);
    continue;
  }
  const suggested = linksInReply(entry.firstReply, CHAT_CAMPUS).links.filter((link) => link.kind === 'society').map((link) => link.label);
  const { text, links } = linksInReply(entry.thenReply, CHAT_CAMPUS);
  const again = links.filter((link) => link.kind === 'society' && suggested.includes(link.label)).map((link) => link.label);
  const ownContact = entry.thenReply.match(OWN_CONTACT)?.[0];
  const problems = [
    !suggested.length ? 'the first reply suggested no society, so there was nothing to follow up' : '',
    suggested.length && !again.length ? `didn't name ${suggested.join(' or ')} again` : '',
    CANT_SEE.some((pattern) => pattern.test(entry.thenReply)) ? "said it can't see the details" : '',
    ownContact ? `wrote a contact detail of its own (${ownContact})` : '',
    ...UNMENTIONABLE.filter((name) => entry.thenReply.toLowerCase().includes(name.toLowerCase())).map((name) => `mentioned ${name}, which the chat leaves out`)
  ].filter(Boolean);
  if (problems.length) followupFailures++;
  console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${followup.group}: "${followup.then}"`);
  console.log(`      first suggested: ${suggested.length ? suggested.join(', ') : '(none)'}; named again: ${again.length ? again.join(', ') : '(none)'}${problems.length ? `   <- ${problems.join('; ')}` : ''}`);
  console.log(`      chat said: "${text}"`);
}
console.log(`\n${FOLLOWUPS.length - followupFailures}/${FOLLOWUPS.length} follow-ups as expected`);
process.exit(failures + followupFailures === 0 ? 0 : 1);
