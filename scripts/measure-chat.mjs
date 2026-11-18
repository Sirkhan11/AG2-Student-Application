// Measures the check-in chat over repeated runs, as pass rates: Gemini doesn't answer the same way
// every time, so each case is asked several times and counts as passing when at least 80% of its runs
// do what we'd expect (4 of 5, or 3 of 3). Every request goes through the chat's own code (chat-turns.js:
// the modes, the app's short list, the instructions, the reply shapes and the checks on each reply),
// with Gemini over REST, so what's measured is what a student would see.
//
// The groups (made-up students only, no real people):
// - suggestions: one student from each fixture group (scripts/fixtures/matching-cases.json) says what
//   they're into and asks for societies, and a few more ask about community societies, a worry
//   (money, food, misconduct, a landlord), a sport, getting fit or the NHS. Each reply is checked
//   against what we'd expect (judgement calls, written down so they can be argued about).
// - followups: a suggestion, then "How do I join?" and so on: the same card again, never "I can't see".
// - actions: finding a mentor (the card, never the page; not for someone who has one or is one; not
//   again after not now unless they ask), "now what" (going through their checklist), their mentor's
//   card, a different mentor (never asking why), remembering a plan (and never health, money or worries).
// - context: why they were matched, how often, their checklist, who their mentor is, a society for
//   their course, waiting for the coordinator, no mentor yet, changing mentor.
// - reminders: one task at a time, never "I've added it", no copy of a task already there, not while
//   they're worried.
// - after-match: the message straight after finding a mentor: up to 3 suggestions that fit their
//   answers and nothing they'd rather avoid, one gentle question, and nothing if they've seemed upset.
// - conversations: their first name now and then over six turns (in at least one reply, at most
//   half, never in full), and the reminder question exactly once over a conversation.
//
// Replies are saved in scripts/fixtures/chat-measure.json, so by default this only reads them and
// needs no Gemini. To ask Gemini again (about 75 requests a run, within the scripts' daily budget):
//   node --env-file=.env --env-file=.env.development.local scripts/measure-chat.mjs --refresh [--runs 3] [--only suggestions,actions]
// Otherwise:
//   node scripts/measure-chat.mjs [--only ...]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAT_MODEL } from '#lib/checkin/chat-prompt.js';
import { buildOpener } from '#lib/checkin/opener.js';
import { NOT_IN_CHAT, serviceById } from '#lib/nsu/services.js';
import { AUDIENCE, societyById } from '#lib/societies/societies.js';
import { EXPECT, EXTRA } from './lib/suggestion-cases.mjs';

const REPLIES_FILE = 'scripts/fixtures/chat-measure.json';
/**
 * Gemini 3.5 Flash-Lite's paid-tier prices, US dollars per million tokens (thinking counts as output),
 * from Google's pricing page when this was written, for the cost per message.
 */
const PRICE = { input: 0.3, output: 2.5 };
/** A case passes when at least this share of its runs do. */
const BAR = 0.8;

// ---------- The made-up students ----------

/** @typedef {import('#lib/checkin/chat-turns.js').ChatFacts} ChatFacts */

const MENTOR_NAME = 'Morgan Testperson';
/** The mentor's name and id, and the student's availability note: Gemini is never told them. */
const NEVER_SHOWN = [/Morgan/i, /Testperson/i, /mentor-test-id/i, /Tuesday evenings/i];

const ACTION_TASKS = [
  { id: 'gp', title: 'Register with a GP', done: true },
  { id: 'student-id', title: 'Collect student ID', done: true },
  { id: 'society', title: 'Join a society', done: false },
  { id: 'dentist', title: 'Find a dentist', done: false },
  { id: 'contacts', title: 'Save key contacts', done: true }
];
const REMINDER_TASKS = [
  { id: 'gp', title: 'Register with a GP', done: false },
  { id: 'student-id', title: 'Collect student ID', done: true },
  { id: 'society', title: 'Join a society', done: false },
  { id: 'dentist', title: 'Find a dentist', done: false },
  { id: 'contacts', title: 'Save key contacts', done: true }
];
const MATCHED = { status: 'matched', mentorId: 'mentor-test-id', mentorName: MENTOR_NAME, reasons: ['You share interests: chess'], meetingFrequency: 'weekly', availability: 'Tuesday evenings' };
const MATCHED_GIGS = {
  ...MATCHED,
  reasons: ['You share interests: live music, gigs', 'You like similar weekends: cinema', "They're the kind of mentor you asked for: laid-back"],
  meetingFrequency: 'every two weeks'
};
const WAITING = { status: 'coordinator', meetingFrequency: 'weekly', availability: 'Tuesday evenings' };
const SAM = { name: 'Sam Student', course: 'BSc Computer Science', interests: ['chess'] };

/**
 * A student as the chat page starts one: what Gemini is told (facts), and the first messages, built
 * by the app without the mentor's name.
 * @param {Partial<ChatFacts>} given
 * @returns {{ facts: ChatFacts, opener: string[] }}
 */
function student(given) {
  const facts = /** @type {ChatFacts} */ ({ match: null, tasks: null, checklistSaved: true, profile: null, isMentor: false, mentorNote: null, today: '2026-11-18', ...given });
  const withoutName = facts.match?.status === 'matched' ? { ...facts.match, mentorName: null } : facts.match;
  return { facts, opener: buildOpener({ match: withoutName, tasks: facts.tasks, checklistSaved: facts.checklistSaved, justSignedUp: false, isMentor: facts.isMentor }).messages };
}

/** @type {Record<string, { facts: ChatFacts, opener: string[] }>} */
const STUDENTS = {
  // No mentor request and no checklist, so only the question matters.
  new: student({}),
  'no mentor': student({ tasks: ACTION_TASKS, profile: SAM }),
  matched: student({ match: MATCHED, tasks: ACTION_TASKS, profile: SAM }),
  'a mentor': student({ tasks: ACTION_TASKS, profile: SAM, isMentor: true }),
  'said not now': student({ tasks: ACTION_TASKS, profile: SAM, mentorNote: 'declined' }),
  'matched, gigs': student({ match: MATCHED_GIGS, tasks: ACTION_TASKS, profile: { course: 'BA English Literature', interests: ['reading', 'gigs'] } }),
  waiting: student({ match: WAITING, tasks: ACTION_TASKS, profile: { course: 'BSc Computer Science', interests: [] } }),
  'no mentor, no profile': student({ tasks: ACTION_TASKS, profile: { course: null, interests: [] } }),
  reminders: student({ match: WAITING, tasks: REMINDER_TASKS, profile: { course: 'BSc Computer Science', interests: ['chess', 'gigs'] } }),
  // Straight after finding a mentor: the summary of their (made-up) answers.
  swimmer: student({
    match: { ...MATCHED, reasons: ['You share interests: swimming'] },
    tasks: ACTION_TASKS,
    profile: {
      name: 'Alex Example',
      course: 'BSc Nursing',
      interests: [],
      matchingSummary: { likes: ['settling in', 'swimming', 'salsa dancing', 'a swim', 'a dance class', 'making friends'], avoids: ['rugby'], styles: { social: 'both', planning: 'last minute', working: 'with others' } }
    }
  }),
  'board games': student({
    match: WAITING,
    tasks: ACTION_TASKS,
    profile: {
      course: 'BA History',
      interests: [],
      matchingSummary: { likes: ['board games', 'reading', 'a quiet night in'], avoids: ['partying'], styles: { social: 'staying in', planning: 'planning ahead', working: null } }
    }
  })
};

// ---------- What every reply is checked for ----------

/**
 * What the student sees from one reply (the page shows the same).
 * @typedef {{ kind: string, text: string, links: { label: string, kind?: string }[], offers: string[], tasks: string[], notes: string[] }} Shown
 * @typedef {{ ask: string, shown: Shown }} Turn
 */

/** @param {Shown} shown */
const suggestedIn = (shown) => shown.links.filter((link) => link.kind).map((link) => link.label);
/** @param {Shown} shown */
const pagesIn = (shown) => shown.links.filter((link) => !link.kind).map((link) => link.label);
/** The questions in some text. @param {string} text */
const questionsIn = (text) => text.match(/[^.!?]*\?/g) ?? [];

/** Things the chat never even mentions: restricted-audience societies, and services left out of the chat. */
const UNMENTIONABLE = [
  ...Object.keys(AUDIENCE).map((id) => /** @type {{ name: string }} */ (societyById(Number(id))).name),
  ...NOT_IN_CHAT.map((id) => /** @type {{ name: string }} */ (serviceById(id)).name)
];

/** Problems any reply can have. @param {Shown} shown */
function always(shown) {
  if (shown.kind !== 'reply' && shown.kind !== 'skip') return [`no reply (${shown.kind})`];
  return [
    /\{\{|\}\}|\[\[|\]\]/.test(shown.text) ? 'the student would see a marker' : '',
    /\b(json|curly|braces?|brackets?)\b/i.test(shown.text) ? 'talks about the reply format' : '',
    ...suggestedIn(shown).filter((name) => !shown.text.toLowerCase().includes(name.toLowerCase())).map((name) => `shows ${name} without mentioning it`),
    ...UNMENTIONABLE.filter((name) => shown.text.toLowerCase().includes(name.toLowerCase())).map((name) => `mentioned ${name}, which the chat leaves out`),
    ...NEVER_SHOWN.filter((pattern) => pattern.test(shown.text)).map((pattern) => `shows something it was never told (${pattern.source})`)
  ].filter(Boolean);
}

// ---------- suggestions ----------

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

/** @type {{ students: { id: string, group: string, answers: string[] }[] }} */
const fixtures = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));

/**
 * The problems with a suggestion reply, against what we'd expect.
 * @param {import('./lib/suggestion-cases.mjs').Expect} expect @param {Shown} shown
 */
function suggestionProblems(expect, shown) {
  const suggested = suggestedIn(shown);
  const wrong = suggested.filter((name) => expect.mustNot?.includes(name));
  return [
    expect.anyOf.length && !suggested.some((name) => expect.anyOf.includes(name)) ? `none of: ${expect.anyOf.slice(0, 8).join(', ')}` : '',
    expect.page && !pagesIn(shown).includes(expect.page) ? `didn't show the ${expect.page} page` : '',
    wrong.length ? `shouldn't suggest: ${wrong.join(', ')}` : '',
    expect.askFirst && suggested.length > 0 ? 'should ask what they enjoy before suggesting' : '',
    expect.say?.(shown.text) ?? ''
  ].filter(Boolean);
}

/**
 * One case: who asks (a student above), what they say in turn (or straight after finding a mentor),
 * and what's wrong with the replies.
 * @typedef {{ group: string, id: string, why: string, student: string, seed?: [string, string][], afterMatch?: 'matched' | 'coordinator',
 *   asks: string[], then?: (turns: Turn[]) => string | null, judge: (turns: Turn[]) => string[] }} Case
 */

/** @type {Case[]} */
const CASES = [];

for (const group of Object.keys(EXPECT)) {
  const extra = EXTRA.find((e) => e.group === group);
  let message = extra?.message;
  if (!message) {
    const asker = fixtures.students.find((s) => s.group === group);
    if (!asker) throw new Error(`No fixture student in group "${group}"`);
    message = `${asker.answers[1]} ${asker.answers[2]} Are there any societies you'd recommend?`;
  }
  CASES.push({ group: 'suggestions', id: group, why: EXPECT[group].why, student: 'new', asks: [message], judge: ([turn]) => suggestionProblems(EXPECT[group], turn.shown) });
}

const FOLLOWUPS = [
  { id: 'how to contact a suggested society', first: "I love knitting and crochet. Are there any societies you'd recommend?", then: 'How can I contact them?' },
  { id: 'how to join a suggested society', first: "I'm really into climbing and bouldering. Are there any societies you'd recommend?", then: 'How do I join?' },
  { id: 'what a suggested society is like', first: 'I like board games and tabletop role-playing games. Are there any societies for that?', then: "What's it like?" },
  { id: "a suggested society's Instagram", first: "I love films and going to the cinema. Are there any societies you'd recommend?", then: 'Do they have an Instagram?' }
];
for (const followup of FOLLOWUPS) {
  CASES.push({
    group: 'followups',
    id: followup.id,
    why: 'names the same society again, so its card shows; never says it can’t see the details or writes a contact of its own',
    student: 'new',
    asks: [followup.first, followup.then],
    judge: ([first, then]) => {
      const before = first.shown.links.filter((link) => link.kind === 'society').map((link) => link.label);
      const again = then.shown.links.filter((link) => link.kind === 'society' && before.includes(link.label));
      return [
        !before.length ? 'the first reply suggested no society' : '',
        before.length && !again.length ? `didn't show ${before.join(' or ')} again` : '',
        CANT_SEE.some((pattern) => pattern.test(then.shown.text)) ? "said it can't see the details" : '',
        OWN_CONTACT.test(then.shown.text) ? 'wrote a contact detail of its own' : ''
      ].filter(Boolean);
    }
  });
}

// ---------- actions ----------

/** The matching questions, which only the app asks. */
const ASKS_MATCHING = /what would you like help with|what do you enjoy|good weekend|how do you like to work|what matters most|what would make a mentor|what are you looking for in a mentor|how often would you like to meet|when are you (?:usually )?free/i;
/** Saying it's found or will find one, which only the app does once they tap. */
const CLAIMS = [/\bI(?:'|’)ve (?:found|matched|signed)/i, /\bI(?:'|’)ll (?:find|match|sign you up)/i, /\bI will (?:find|match)/i, /\byou(?:'|’)re (?:now )?(?:signed up|matched)/i];
/** A question asking why, or for their reason. @param {string} text */
const asksWhy = (text) => questionsIn(text).some((question) => /\bwhy\b|what (?:happened|went wrong|'s wrong|is wrong)|reason|tell me (?:more|about)/i.test(question));

/**
 * @type {{ id: string, student: string, ask: string, why: string, offer?: string, notOffer?: string[], remember?: boolean, noLinks?: boolean, noAskWhy?: boolean }[]}
 */
const ACTIONS = [
  { id: 'focus and organise', student: 'no mentor', ask: 'I need a mentor to help me focus and organise my work', why: 'offers the card, not the page', offer: 'mentor' },
  { id: 'yes to the first message', student: 'no mentor', ask: 'Yes please, I’d like a mentor', why: 'says yes to the opener’s offer', offer: 'mentor' },
  { id: 'help settling in', student: 'no mentor', ask: 'I’m finding it hard to settle in. Is there someone who could help me?', why: 'wants someone to help them settle in', offer: 'mentor' },
  { id: 'already has one', student: 'matched', ask: 'Can I get a mentor?', why: 'already matched: no offer to find one', notOffer: ['mentor'] },
  { id: 'a mentor themselves', student: 'a mentor', ask: 'Can I get a mentor?', why: 'a mentor: no offer', notOffer: ['mentor'] },
  { id: 'after not now', student: 'said not now', ask: 'Are there any chess societies?', why: 'said not now: no offer', notOffer: ['mentor'] },
  { id: 'asks after not now', student: 'said not now', ask: 'Actually, could you find me a mentor after all?', why: 'they ask: offer again', offer: 'mentor' },
  { id: 'now what', student: 'matched', ask: 'okay great now what', why: 'offers to go through their checklist here, with no page links', offer: 'checklist', noLinks: true },
  { id: 'who is my mentor', student: 'matched', ask: 'Who is my mentor, and how do I get in touch?', why: 'shows the mentor card', offer: 'your-mentor' },
  { id: 'different mentor', student: 'matched', ask: 'I’d like a different mentor please', why: 'shows the form here, never asking why', offer: 'change-mentor', noAskWhy: true },
  { id: 'remember a plan', student: 'matched', ask: 'I’ve decided to plan my week every Sunday evening in a paper diary', why: 'offers to remember the plan', remember: true },
  { id: 'never: health', student: 'matched', ask: 'I’ve got asthma, so I need to sort out my inhaler prescription up here', why: 'health: never offered', remember: false },
  { id: 'never: money', student: 'matched', ask: 'I’m worried I won’t be able to afford my rent next month', why: 'money: never offered', remember: false },
  { id: 'never: worries', student: 'matched', ask: 'I’m really nervous about not making any friends', why: 'a worry: never offered', remember: false }
];
for (const test of ACTIONS) {
  CASES.push({
    group: 'actions',
    id: test.id,
    why: test.why,
    student: test.student,
    asks: [test.ask],
    judge: ([{ shown }]) => [
      test.offer && !shown.offers.includes(test.offer) ? `doesn’t show the ${test.offer} card` : '',
      ...(test.notOffer ?? []).filter((id) => shown.offers.includes(id)).map((id) => `shows the ${id} card when it shouldn’t`),
      test.remember === true && shown.notes.length === 0 ? 'doesn’t offer to remember it' : '',
      test.remember === false && shown.notes.length > 0 ? `offers to remember something it never should ("${shown.notes[0]}")` : '',
      test.noLinks && shown.links.length > 0 ? `has links (${shown.links.map((link) => link.label).join(', ')})` : '',
      test.noAskWhy && asksWhy(shown.text) ? 'asks why' : '',
      /Sam Student/.test(shown.text) ? 'uses their full name' : '',
      /find a mentor page/i.test(shown.text) ? 'points to the Find a mentor page' : '',
      questionsIn(shown.text).some((question) => ASKS_MATCHING.test(question)) ? 'asks the matching questions itself' : '',
      ...CLAIMS.filter((pattern) => pattern.test(shown.text)).map((pattern) => `says it’s done or will be (${pattern.source})`),
      shown.text.trim() === '' ? 'no words for the student, only the card' : ''
    ].filter(Boolean)
  });
}

// ---------- context ----------

const CANT_KNOW = [
  /\bcan(?:not|'t|’t| not)\s+(?:see|access|view|say|tell|know)\b/i,
  /\b(?:don'?t|don’t|do not)\s+(?:have|know)\s+(?:access|the details|the reasons|why|that)/i,
  /\bnot sure\s+(?:why|about)\b/i
];
/** Offering to find a mentor in words, which must come with the card. */
const OFFERS_IN_WORDS = /(?:I|we) can (?:help you )?find you (?:a |one|a student )|answer a few questions here|find (?:you )?(?:a mentor|one) (?:right )?here/i;
/**
 * @type {{ id: string, student: string, ask: string, why: string, expect?: RegExp, also?: RegExp, link?: string, noCantKnow?: boolean, noAskWhy?: boolean, notPage?: boolean, card?: string }[]}
 */
const CONTEXT = [
  { id: 'why matched', student: 'matched, gigs', ask: 'Why did you match me with my mentor?', why: 'uses the saved reasons', expect: /live music|gigs|cinema|laid[- ]back/i, noCantKnow: true },
  { id: 'how often', student: 'matched, gigs', ask: 'How often will we meet?', why: 'the frequency they asked for', expect: /two weeks|fortnight/i },
  { id: 'checklist', student: 'matched, gigs', ask: "What's left on my checklist?", why: 'offers to go through it here', card: 'checklist' },
  { id: 'who is my mentor (context)', student: 'matched, gigs', ask: 'Who is my mentor?', why: 'shows the mentor card, never a name', card: 'your-mentor' },
  { id: 'course society', student: 'matched, gigs', ask: 'Can you suggest a society for my course?', why: 'uses their course', link: 'English' },
  { id: 'why matched, waiting', student: 'waiting', ask: 'Why did you match me with my mentor?', why: 'the coordinator is finding one', expect: /coordinator/i },
  {
    id: 'why matched, no mentor',
    student: 'no mentor, no profile',
    ask: 'Why did you match me with my mentor?',
    why: 'says they haven’t got one; any offer is the card, never the page',
    expect: /(?:haven.t|have not|don.t have|do not have)[^.]*mentor|no mentor|not been matched|n.t been matched|haven.t been matched|yet/i,
    notPage: true
  },
  { id: 'change mentor', student: 'matched, gigs', ask: 'I don’t think my mentor is right for me. Can I change?', why: 'shows the form here, where only the coordinator sees the reason; never asks why', card: 'change-mentor', also: /coordinator/i, noAskWhy: true }
];
for (const test of CONTEXT) {
  CASES.push({
    group: 'context',
    id: test.id,
    why: test.why,
    student: test.student,
    asks: [test.ask],
    judge: ([{ shown }]) => [
      test.expect && !test.expect.test(shown.text) ? `doesn't do what's expected (${test.why})` : '',
      test.also && !test.also.test(shown.text) ? `doesn't mention ${test.also.source}` : '',
      test.noAskWhy && asksWhy(shown.text) ? 'asks why, or for their reason' : '',
      test.notPage && /find a mentor page/i.test(shown.text) ? 'sends them to the Find a mentor page' : '',
      OFFERS_IN_WORDS.test(shown.text) && !shown.offers.includes('mentor') ? 'offers to find a mentor in words, without the card' : '',
      test.link && !suggestedIn(shown).includes(test.link) ? `doesn't suggest ${test.link}` : '',
      test.card && !shown.offers.includes(test.card) ? `doesn't show the ${test.card} card` : '',
      test.noCantKnow && CANT_KNOW.some((pattern) => pattern.test(shown.text)) ? "says it can't know" : ''
    ].filter(Boolean)
  });
}

// ---------- reminders ----------

/** The reminder question, as the chat might have asked it earlier. */
const ASKED = "Glad it's going well! Is there anything you'd like reminding about while you settle in? I can add it to your checklist.";
/** Asking about reminders: "remind" in a question. @param {string} text */
const asksAboutReminders = (text) => questionsIn(text).some((question) => /remind/i.test(question));
/** Saying it has added (or will add) a task itself, which only the student's tap can do. */
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
/** @param {Shown} shown */
const claimsAdded = (shown) => CLAIMS_ADDED.filter((pattern) => pattern.test(shown.text)).map((pattern) => `says it added the task (${pattern.source})`);

/** @type {{ id: string, why: string, seed: [string, string][], ask: string, check: (shown: Shown) => string[] }[]} */
const REMINDERS = [
  {
    id: 'bank account',
    why: 'one task, starting with a verb, and no claim that it was added',
    seed: [['It’s been good thanks, just a lot to sort out', ASKED]],
    ask: 'Yes, can you remind me to open a bank account?',
    check: (shown) => [
      shown.tasks.length !== 1 ? `suggests ${shown.tasks.length} tasks, not 1` : '',
      shown.tasks[0] && !/bank/i.test(shown.tasks[0]) ? `the task isn't about a bank account ("${shown.tasks[0]}")` : '',
      shown.tasks[0] && !/^[A-Z][a-z]+\b/.test(shown.tasks[0]) ? `the task doesn't start with a verb ("${shown.tasks[0]}")` : ''
    ]
  },
  {
    id: 'two things',
    why: 'one task at a time, even when they name two',
    seed: [['It’s been good thanks, just a lot to sort out', ASKED]],
    ask: 'Yes please, opening a bank account and getting a bus pass',
    check: (shown) => [shown.tasks.length !== 1 ? `suggests ${shown.tasks.length} tasks, not 1` : '']
  },
  {
    id: 'add it for me',
    why: 'never says it has added it: they tap Add',
    seed: [
      ['It’s been good thanks, just a lot to sort out', ASKED],
      ['Yes, can you remind me to open a bank account?', 'Good idea. Here’s a reminder for that: you can add it to your checklist with one tap.']
    ],
    ask: 'Yes, add it for me please',
    check: () => []
  },
  {
    id: 'already there',
    why: 'the GP task is on their checklist: says so, no copy',
    seed: [['Fine thanks', ASKED]],
    ask: 'Yes, can you remind me to register with a GP?',
    check: (shown) => [shown.tasks.length ? `suggests a copy ("${shown.tasks[0]}")` : '', /checklist/i.test(shown.text) ? '' : "doesn't say it's on their checklist"]
  },
  {
    id: 'worried',
    why: 'not a natural point: points to support, no reminder question',
    seed: [],
    ask: 'I’m really worried about money, I can’t afford food this week',
    check: (shown) => [
      asksAboutReminders(shown.text) ? 'asks about reminders while they’re worried' : '',
      suggestedIn(shown).some((name) => name === 'Food Pantry' || name === 'Cost of Living') ? '' : 'doesn’t suggest the Food Pantry or Cost of Living'
    ]
  }
];
for (const test of REMINDERS) {
  CASES.push({ group: 'reminders', id: test.id, why: test.why, student: 'reminders', seed: test.seed, asks: [test.ask], judge: ([{ shown }]) => [...test.check(shown), ...claimsAdded(shown)].filter(Boolean) });
}

// ---------- after-match ----------

/** Mentioning the summary, their answers or the app, which the message never should. */
const MENTIONS_SUMMARY = /\b(summary|your answers|the app|the app's note)\b/i;
CASES.push(
  {
    group: 'after-match',
    id: 'swimmer, just matched',
    why: 'Swimming or a dance society from their answers, nothing rugby, one gentle question',
    student: 'swimmer',
    afterMatch: 'matched',
    asks: [],
    judge: ([{ shown }]) => [
      shown.kind === 'skip' ? 'said nothing' : '',
      ...(shown.kind === 'skip' ? [] : suggestionProblems({ anyOf: ['Swimming', 'Salsa and Bachata', 'Dance'], mustNot: ['Rugby Union', 'Rugby League'], why: '' }, shown)),
      shown.kind !== 'skip' && questionsIn(shown.text).length !== 1 ? `asks ${questionsIn(shown.text).length} questions, not 1` : '',
      MENTIONS_SUMMARY.test(shown.text) ? 'mentions the summary, their answers or the app' : ''
    ].filter(Boolean)
  },
  {
    group: 'after-match',
    id: 'board games, with the coordinator',
    why: 'board games or reading, nothing for nights out, one gentle question',
    student: 'board games',
    afterMatch: 'coordinator',
    asks: [],
    judge: ([{ shown }]) => [
      shown.kind === 'skip' ? 'said nothing' : '',
      ...(shown.kind === 'skip' ? [] : suggestionProblems({ anyOf: ['Gaming and Roleplay', 'Book', 'Chess'], mustNot: ['Events', 'Beer', 'Sync DJ', 'Dance', 'Habita', 'Gigs'], why: '' }, shown)),
      shown.kind !== 'skip' && questionsIn(shown.text).length !== 1 ? `asks ${questionsIn(shown.text).length} questions, not 1` : '',
      MENTIONS_SUMMARY.test(shown.text) ? 'mentions the summary, their answers or the app' : ''
    ].filter(Boolean)
  },
  {
    group: 'after-match',
    id: 'upset earlier in the chat',
    why: 'they seemed upset: says nothing',
    student: 'swimmer',
    seed: [
      [
        'Honestly I’ve had a horrible week and I feel really alone here',
        'I’m sorry it’s been such a hard week. Feeling alone after a big move is really common, and you don’t have to sort it out on your own: Wellbeing can help.'
      ]
    ],
    afterMatch: 'matched',
    asks: [],
    judge: ([{ shown }]) => [shown.kind === 'skip' ? '' : `wrote a message ("${shown.text.slice(0, 60)}")`].filter(Boolean)
  }
);

// ---------- conversations ----------

const NAME_CONVERSATION = ['Hi!', 'Pretty good, I’ve just got back from a lecture', 'Are there any chess societies?', 'Nice, thanks', 'What could I do this weekend?', 'Thanks, have a good evening'];
CASES.push({
  group: 'conversations',
  id: 'their first name over six turns',
  why: 'in at least one reply and at most half, never in full',
  student: 'matched',
  asks: NAME_CONVERSATION,
  judge: (turns) => {
    const named = turns.filter((turn) => /\bSam\b/.test(turn.shown.text)).length;
    return [
      named < 1 || named > turns.length / 2 ? `in ${named} of ${turns.length} replies` : '',
      turns.some((turn) => /Sam Student/.test(turn.shown.text)) ? 'used their full name' : ''
    ].filter(Boolean);
  }
});
const NO_THANKS = 'No thanks, nothing for now';
CASES.push({
  group: 'conversations',
  id: 'the reminder question exactly once',
  why: 'asks about reminders once over a conversation; when they say no, carries on',
  student: 'reminders',
  asks: ['Pretty good thanks, still unpacking', 'Are there any chess societies?', 'Nice. Anything for gigs?', 'Thanks, that’s really helpful', 'Have a good evening'],
  then: (turns) => (asksAboutReminders(turns.at(-1)?.shown.text ?? '') && !turns.some((turn) => turn.ask === NO_THANKS) ? NO_THANKS : null),
  judge: (turns) => {
    const asked = turns.filter((turn) => asksAboutReminders(turn.shown.text)).length;
    return [asked !== 1 ? `asked ${asked} times` : '', ...turns.flatMap((turn) => claimsAdded(turn.shown))].filter(Boolean);
  }
});

// ---------- Running and reading ----------

const ids = CASES.map((test) => test.id);
const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
if (twice.length) throw new Error(`Each case needs its own id: ${twice.join(', ')}`);

/** The source that decides what the chat sends and shows, so saved replies say whether they're current. */
const SOURCES = [
  'src/lib/checkin/chat-prompt.js',
  'src/lib/checkin/chat-replies.js',
  'src/lib/checkin/chat-turns.js',
  'src/lib/checkin/opener.js',
  'src/lib/checkin/about-you.js',
  'src/lib/suggestions/catalogue.js',
  'src/lib/suggestions/everyday-words.js',
  'src/lib/suggestions/shortlist.js'
];
const fingerprint = createHash('sha256')
  .update([CHAT_MODEL, ...SOURCES.map((file) => readFileSync(file, 'utf8')), JSON.stringify(CASES.map(({ id, student, seed, asks, afterMatch }) => [id, student, seed, asks, afterMatch]))].join('\n'))
  .digest('hex')
  .slice(0, 12);

const argument = (/** @type {string} */ name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1];
};
const only = argument('--only')?.split(',') ?? null;
const chosen = CASES.filter((test) => !only || only.includes(test.group) || only.includes(test.id));

/**
 * cost: the average tokens per request on the last refresh, and what that comes to.
 * @typedef {{ about: string, model: string, fingerprint: string, made: string, runs: Record<string, Turn[][]>,
 *   cost?: { requests: number, input: number, output: number, thinking: number, dollarsPerRequest: number } }} Saved
 */
/** @type {Saved} */
let saved = existsSync(REPLIES_FILE)
  ? JSON.parse(readFileSync(REPLIES_FILE, 'utf8'))
  : { about: 'Check-in chat replies for measure-chat.mjs (made-up students), several runs per case. Regenerate with --refresh rather than edit.', model: CHAT_MODEL, fingerprint, made: '', runs: {} };

/** What a reply shows, kept small for the saved file. @param {import('#lib/checkin/chat-turns.js').ChatReply} reply @returns {Shown} */
const shownOf = (reply) => ({
  kind: reply.kind,
  text: reply.text,
  links: (reply.links ?? []).map((link) => ({ label: link.label, ...(link.kind ? { kind: link.kind } : {}) })),
  offers: reply.offers ?? [],
  tasks: reply.tasks ?? [],
  notes: reply.notes ?? []
});

if (process.argv.includes('--refresh')) {
  const runs = Number(argument('--runs') ?? 3);
  const { geminiFromEnv } = await import('./lib/gemini-rest.mjs');
  const { chatOverRest } = await import('./lib/chat-over-rest.mjs');
  const gemini = geminiFromEnv(process.env);
  // A full refresh starts again; --only keeps every other case's saved runs.
  saved = { ...saved, model: CHAT_MODEL, fingerprint, runs: only ? saved.runs : {} };
  for (const test of chosen) {
    saved.runs[test.id] = [];
    for (let run = 1; run <= runs; run++) {
      const { facts, opener } = STUDENTS[test.student];
      const chat = chatOverRest(gemini, facts, opener, undefined, test.seed ?? []);
      /** @type {Turn[]} */
      const turns = [];
      if (test.afterMatch) turns.push({ ask: `(just found a mentor: ${test.afterMatch})`, shown: shownOf(await chat.afterMatch(test.afterMatch)) });
      const queue = [...test.asks];
      while (queue.length) {
        const ask = /** @type {string} */ (queue.shift());
        turns.push({ ask, shown: shownOf(await chat.send(ask)) });
        const next = test.then?.(turns);
        if (next) queue.unshift(next);
      }
      saved.runs[test.id].push(turns);
      saved.made = new Date().toISOString();
      writeFileSync(REPLIES_FILE, `${JSON.stringify(saved, null, 2)}\n`);
    }
    console.log(`  asked: ${test.id} (${runs} runs)`);
  }
  // What a chat message costs, from Gemini's own token counts (thinking is billed as output).
  const average = (/** @type {'promptTokenCount' | 'candidatesTokenCount' | 'thoughtsTokenCount'} */ key) =>
    gemini.usage.reduce((sum, used) => sum + (used[key] ?? 0), 0) / Math.max(1, gemini.usage.length);
  const [input, output, thinking] = [average('promptTokenCount'), average('candidatesTokenCount'), average('thoughtsTokenCount')];
  const dollars = (input * PRICE.input + (output + thinking) * PRICE.output) / 1e6;
  saved.cost = { requests: gemini.usage.length, input: Math.round(input), output: Math.round(output), thinking: Math.round(thinking), dollarsPerRequest: Number(dollars.toFixed(5)) };
  writeFileSync(REPLIES_FILE, `${JSON.stringify(saved, null, 2)}\n`);
}

if (!saved.made) {
  console.log('No saved replies yet. Run with --refresh (and --env-file=.env --env-file=.env.development.local).');
  process.exit(2);
}
console.log(`Replies: ${REPLIES_FILE} (made ${saved.made.slice(0, 16).replace('T', ' ')} with ${saved.model})`);
if (saved.fingerprint !== fingerprint) console.log(`NOTE: made with chat code ${saved.fingerprint}, but it's now ${fingerprint}. Run with --refresh to measure the current code.`);

let passed = 0;
let runsPassed = 0;
let runsTotal = 0;
let group = '';
for (const test of chosen) {
  if (test.group !== group) {
    group = test.group;
    console.log(`\n-- ${group}`);
  }
  const runs = saved.runs[test.id] ?? [];
  const results = runs.map((turns) => [...test.judge(turns), ...turns.flatMap((turn) => always(turn.shown))]);
  const good = results.filter((problems) => problems.length === 0).length;
  const ok = runs.length > 0 && good / runs.length >= BAR;
  if (ok) passed++;
  runsPassed += good;
  runsTotal += runs.length;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${good}/${runs.length}  ${test.id} (${test.why})`);
  const failing = results.findIndex((problems) => problems.length > 0);
  const shownRun = runs[failing === -1 ? 0 : failing];
  if (failing !== -1) console.log(`      run ${failing + 1}: ${results[failing].join('; ')}`);
  for (const turn of shownRun?.slice(-2) ?? []) {
    const cards = [...suggestedIn(turn.shown), ...pagesIn(turn.shown).map((page) => `${page} page`), ...turn.shown.offers.map((offer) => `${offer} card`), ...turn.shown.tasks.map((task) => `reminder "${task}"`), ...turn.shown.notes.map((note) => `remember "${note}"`)];
    console.log(`      "${turn.ask.slice(0, 70)}" -> ${turn.shown.kind === 'skip' ? '(nothing)' : `"${turn.shown.text}"`}${cards.length ? `   [${cards.join(', ')}]` : ''}`);
  }
}
console.log(`\n${passed}/${chosen.length} cases at the bar (at least ${BAR * 100}% of runs); ${runsPassed}/${runsTotal} runs as expected`);
if (saved.cost) {
  const { requests, input, output, thinking, dollarsPerRequest } = saved.cost;
  console.log(`Cost on the last refresh: ${requests} requests, on average ${input} tokens in, ${output} out and ${thinking} thinking: about $${dollarsPerRequest} a request`);
}
process.exit(passed === chosen.length ? 0 : 1);
