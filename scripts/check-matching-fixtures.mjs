// Runs the app's matching on the made-up test cases (scripts/fixtures/matching-cases.json), using
// summaries saved by make-summary-fixtures.mjs, so no Gemini is needed. Liked phrases are embedded
// with the app's MiniLM code (embed.js, in Node), and ranked with the app's own rankMentors() and
// coordinatorReason(). It checks:
// 1. each student gets the result we want: the right mentor first, or the coordinator. It also
//    counts how many go to the coordinator, and why.
// 2. the summaries: phrases that must survive in likes do (such as "lie-in"); things someone ruled
//    out never appear in likes, and land in avoids; avoids never hold styles, people or beliefs;
//    styles come out as expected; and no style phrase appears in any like or avoid
// 3. the same student written short, long and misspelt gets the same result, and how far apart
//    their scores for the expected mentor are (the fairness spread)
// It exits with a failure if anything doesn't match, so it doubles as the before-and-after
// measure for the matching fix.
//
// Run from the project folder (the first run downloads the MiniLM model, about 23 MB):
//   node scripts/check-matching-fixtures.mjs
// Options: --summaries <file> (default scripts/fixtures/summaries-current.json), --verbose

import { readFileSync } from 'node:fs';
import { embedSummaries } from '#lib/matching/compare-items.js';
import { coordinatorReason, rankMentors } from '#lib/matching/match.js';
import { stylesText } from '#lib/matching/summary-prompt.js';
import { SUMMARY_FINGERPRINT } from './lib/summary-fingerprint.mjs';

const args = process.argv.slice(2);
const summariesFile = args.includes('--summaries') ? args[args.indexOf('--summaries') + 1] : 'scripts/fixtures/summaries-current.json';
const verbose = args.includes('--verbose');

/**
 * What a profile's summary must (or mustn't) contain. See "about" in matching-cases.json.
 * @typedef {{ question: number, phrase: string }} QuestionPhrase
 * @typedef {{ mustKeep?: QuestionPhrase[], mustNotMention?: string[], mustAvoid?: QuestionPhrase[],
 *   mustNotAvoid?: string[], noAvoids?: number[], styles?: Record<string, string | null> }} SummaryChecks
 * @typedef {{ id: string, label: string, answers: string[] } & SummaryChecks} MentorCase
 * @typedef {{ id: string, group: string, style: string, expect: string, answers: string[] } & SummaryChecks} StudentCase
 * @typedef {import('#lib/matching/summary-prompt.js').Summary} Summary
 */
/** @type {{ mentors: MentorCase[], students: StudentCase[] }} */
const cases = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));
/** @type {{ promptFingerprint: string, made: string, model: string, summaries: Record<string, Summary> }} */
const saved = JSON.parse(readFileSync(summariesFile, 'utf8'));

console.log(`Summaries: ${summariesFile} (made ${saved.made.slice(0, 16).replace('T', ' ')} with ${saved.model})`);
if (saved.promptFingerprint !== SUMMARY_FINGERPRINT) {
  console.log(`NOTE: made with prompt ${saved.promptFingerprint}, but the prompt is now ${SUMMARY_FINGERPRINT}. Make them again to test the current prompt.`);
}
if (Object.values(saved.summaries).some((summary) => Array.isArray(summary))) {
  console.log('These summaries are in the old format (one list per answer). Make them again with:');
  console.log('  node --env-file=.env --env-file=.env.development.local scripts/make-summary-fixtures.mjs --force');
  process.exit(2);
}
const missing = [...cases.mentors, ...cases.students].filter((profile) => !saved.summaries[profile.id]);
if (missing.length) {
  console.log(`Missing summaries for: ${missing.map((profile) => profile.id).join(', ')}. Run make-summary-fixtures.mjs first.`);
  process.exit(2);
}

/** Lower case, hyphens as spaces, single spaces: so "Lie-in" and "lie in" count as the same. */
const normalise = (/** @type {string} */ text) => text.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
const percent = (/** @type {number | null} */ score) => (score === null ? '  –  ' : score.toFixed(3));
/** @param {string[]} phrases @param {string} wanted */
const hasPart = (phrases, wanted) => phrases.some((phrase) => normalise(phrase).includes(normalise(wanted)));

/**
 * Phrases that are styles, so they must never be a like or an avoid. Matched as whole words, so
 * "night in" doesn't match "midnight inspiration".
 */
const STYLE_PHRASES = ['planning ahead', 'plan ahead', 'last minute', 'on my own', 'alone', 'with others',
  'going out', 'staying in', 'night out', 'nights out', 'night in', 'nights in', 'partying'];
/** @param {string} text @param {string} phrase */
const hasWords = (text, phrase) => new RegExp(`\\b${phrase}\\b`).test(normalise(text));

/** A summary on one line: likes and avoids per question, then the styles. @param {Summary} summary */
const describe = (summary) =>
  `likes ${summary.likes.map((list) => `[${list.join(', ')}]`).join(' ')}  avoids ${summary.avoids.map((list) => `[${list.join(', ')}]`).join(' ')}  (${stylesText(summary.styles)})`;

const mentors = await Promise.all(
  cases.mentors.map(async (mentor) => ({ id: mentor.id, name: mentor.id, itemVectors: await embedSummaries(saved.summaries[mentor.id].likes) }))
);

let rankingFailures = 0;
console.log('\n-- 1. Who comes first');
console.log(`${'Student'.padEnd(20)} ${'Expected'.padEnd(12)} ${'Actual'.padEnd(30)} Result`);
/** @type {Map<string, { id: string, actual: string, expectedScore: number | null }[]>} */
const groups = new Map();
/** @type {Map<string, number>} */
const coordinatorReasons = new Map();
for (const student of cases.students) {
  const summary = saved.summaries[student.id];
  const ranked = rankMentors(await embedSummaries(summary.likes), mentors);
  const reason = coordinatorReason(ranked);
  if (reason) coordinatorReasons.set(reason, (coordinatorReasons.get(reason) ?? 0) + 1);
  const actual = reason ? 'coordinator' : ranked[0].id;
  const pass = actual === student.expect;
  if (!pass) rankingFailures++;
  const detail = reason ? `coordinator (${reason})` : `${ranked[0].id} ${percent(ranked[0].score)}`;
  console.log(`${student.id.padEnd(20)} ${student.expect.padEnd(12)} ${detail.padEnd(30)} ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass || verbose) {
    for (const mentor of ranked.slice(0, 3)) {
      console.log(`${''.padEnd(24)}${mentor.id.padEnd(12)} ${percent(mentor.score)} from ${mentor.questionsCompared}/6 questions`);
    }
    console.log(`${''.padEnd(24)}summary: ${describe(summary)}`);
  }
  const expectedScore = ranked.find((mentor) => mentor.id === student.expect)?.score ?? null;
  groups.set(student.group, [...(groups.get(student.group) ?? []), { id: student.id, actual, expectedScore }]);
}
const sentOn = [...coordinatorReasons.values()].reduce((sum, n) => sum + n, 0);
console.log(`Sent to the coordinator: ${sentOn} of ${cases.students.length}` +
  (sentOn ? ` (${[...coordinatorReasons].map(([reason, n]) => `${reason} ${n}`).join(', ')})` : ''));

let summaryChecks = 0;
let summaryFailures = 0;
console.log('\n-- 2. What the summaries keep, avoid and leave out');
for (const profile of [...cases.mentors, ...cases.students]) {
  const summary = saved.summaries[profile.id];
  /** @type {string[]} */
  const problems = [];
  let count = 0;
  /** @param {boolean} ok @param {string} text */
  const check = (ok, text) => {
    count++;
    if (!ok) problems.push(text);
  };
  for (const { question, phrase } of profile.mustKeep ?? []) {
    check(hasPart(summary.likes[question - 1], phrase), `question ${question}'s likes keep "${phrase}"  [${summary.likes[question - 1].join(', ')}]`);
  }
  for (const word of profile.mustNotMention ?? []) {
    const found = summary.likes.flat().filter((item) => normalise(item).includes(normalise(word)));
    check(found.length === 0, `likes never mention "${word}"  (found: ${found.join(', ')})`);
  }
  for (const { question, phrase } of profile.mustAvoid ?? []) {
    check(hasPart(summary.avoids[question - 1], phrase), `question ${question}'s avoids hold "${phrase}"  [${summary.avoids[question - 1].join(', ')}]`);
  }
  for (const word of profile.mustNotAvoid ?? []) {
    const found = summary.avoids.flat().filter((item) => normalise(item).includes(normalise(word)));
    check(found.length === 0, `avoids never mention "${word}"  (found: ${found.join(', ')})`);
  }
  for (const question of profile.noAvoids ?? []) {
    check(summary.avoids[question - 1].length === 0, `question ${question} has no avoids  [${summary.avoids[question - 1].join(', ')}]`);
  }
  for (const [name, value] of Object.entries(profile.styles ?? {})) {
    const got = summary.styles[/** @type {keyof Summary['styles']} */ (name)];
    check(got === value, `${name} style is ${value ?? 'not said'}  (got ${got ?? 'not said'})`);
  }
  const styleWords = [...summary.likes.flat(), ...summary.avoids.flat()].filter((item) => STYLE_PHRASES.some((phrase) => hasWords(item, phrase)));
  check(styleWords.length === 0, `no style phrase in likes or avoids  (found: ${styleWords.join(', ')})`);

  summaryChecks += count;
  summaryFailures += problems.length;
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${profile.id.padEnd(20)} ${count - problems.length}/${count}`);
  for (const problem of problems) console.log(`        ${problem}`);
  if (problems.length || verbose) console.log(`        ${describe(summary)}`);
}
console.log(`Summary checks: ${summaryChecks - summaryFailures} of ${summaryChecks} passed`);

let groupFailures = 0;
console.log('\n-- 3. Same student, different writing styles');
for (const [group, members] of groups) {
  if (members.length < 2) continue;
  const same = members.every((member) => member.actual === members[0].actual);
  if (!same) groupFailures++;
  const scores = members.map((member) => member.expectedScore).filter((score) => score !== null);
  const spread = scores.length === members.length ? Math.max(...scores) - Math.min(...scores) : null;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${group}: ${members.map((member) => member.actual).join(' / ')}` +
    (spread === null ? '' : `   spread of the expected mentor's score: ${spread.toFixed(3)}`));
}

const failures = rankingFailures + summaryFailures + groupFailures;
console.log(`\n${failures === 0 ? 'Everything matched.' : `${failures} check(s) failed`} ` +
  `(who comes first: ${rankingFailures}, summaries: ${summaryFailures}, writing styles: ${groupFailures}; ` +
  `${cases.students.length} students, ${cases.mentors.length} mentors)`);
process.exit(failures === 0 ? 0 : 1);
