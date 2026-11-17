// Runs the app's matching on the made-up test cases (scripts/fixtures/matching-cases.json), using
// summaries saved by make-summary-fixtures.mjs, so no Gemini is needed. Phrases are embedded with
// the app's MiniLM code (embed.js, in Node), and ranked with the app's own rankMentors() and
// coordinatorReason(). It checks:
// 1. each student gets the result we want: the right mentor first, or the coordinator
// 2. phrases that must survive the summary do (such as "lie-in"), and things a student ruled out
//    don't appear in their summary (such as "sport")
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
import { SUMMARY_FINGERPRINT } from './lib/summary-fingerprint.mjs';

const args = process.argv.slice(2);
const summariesFile = args.includes('--summaries') ? args[args.indexOf('--summaries') + 1] : 'scripts/fixtures/summaries-current.json';
const verbose = args.includes('--verbose');

/**
 * @typedef {{ id: string, group: string, style: string, expect: string, answers: string[],
 *   mustKeep?: { question: number, phrase: string }[], mustNotMention?: string[] }} StudentCase
 */
/** @type {{ mentors: { id: string, label: string }[], students: StudentCase[] }} */
const cases = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));
/** @type {{ promptFingerprint: string, made: string, model: string, summaries: Record<string, string[][]> }} */
const saved = JSON.parse(readFileSync(summariesFile, 'utf8'));

console.log(`Summaries: ${summariesFile} (made ${saved.made.slice(0, 16).replace('T', ' ')} with ${saved.model})`);
if (saved.promptFingerprint !== SUMMARY_FINGERPRINT) {
  console.log(`NOTE: made with prompt ${saved.promptFingerprint}, but the prompt is now ${SUMMARY_FINGERPRINT}. Make them again to test the current prompt.`);
}
const missing = [...cases.mentors, ...cases.students].filter((profile) => !saved.summaries[profile.id]);
if (missing.length) {
  console.log(`Missing summaries for: ${missing.map((profile) => profile.id).join(', ')}. Run make-summary-fixtures.mjs first.`);
  process.exit(2);
}

/** Lower case, hyphens as spaces, single spaces: so "Lie-in" and "lie in" count as the same. */
const normalise = (/** @type {string} */ text) => text.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
const percent = (/** @type {number | null} */ score) => (score === null ? '  –  ' : score.toFixed(3));

const mentors = await Promise.all(
  cases.mentors.map(async (mentor) => ({ id: mentor.id, name: mentor.id, itemVectors: await embedSummaries(saved.summaries[mentor.id]) }))
);

let failures = 0;
console.log('\n-- 1. Who comes first');
console.log(`${'Student'.padEnd(20)} ${'Expected'.padEnd(12)} ${'Actual'.padEnd(30)} Result`);
/** @type {Map<string, { id: string, actual: string, expectedScore: number | null }[]>} */
const groups = new Map();
for (const student of cases.students) {
  const ranked = rankMentors(await embedSummaries(saved.summaries[student.id]), mentors);
  const reason = coordinatorReason(ranked);
  const actual = reason ? 'coordinator' : ranked[0].id;
  const pass = actual === student.expect;
  if (!pass) failures++;
  const detail = reason ? `coordinator (${reason})` : `${ranked[0].id} ${percent(ranked[0].score)}`;
  console.log(`${student.id.padEnd(20)} ${student.expect.padEnd(12)} ${detail.padEnd(30)} ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass || verbose) {
    for (const mentor of ranked.slice(0, 3)) {
      console.log(`${''.padEnd(24)}${mentor.id.padEnd(12)} ${percent(mentor.score)} from ${mentor.questionsCompared}/6 questions`);
    }
    console.log(`${''.padEnd(24)}summary: ${saved.summaries[student.id].map((phrases) => `[${phrases.join(', ')}]`).join(' ')}`);
  }
  const expectedScore = ranked.find((mentor) => mentor.id === student.expect)?.score ?? null;
  groups.set(student.group, [...(groups.get(student.group) ?? []), { id: student.id, actual, expectedScore }]);
}

console.log('\n-- 2. What the summaries keep and leave out');
for (const student of cases.students) {
  const summaries = saved.summaries[student.id];
  for (const { question, phrase } of student.mustKeep ?? []) {
    const kept = summaries[question - 1].some((item) => normalise(item).includes(normalise(phrase)));
    if (!kept) failures++;
    console.log(`${kept ? 'PASS' : 'FAIL'}  ${student.id}: question ${question} keeps "${phrase}"  [${summaries[question - 1].join(', ')}]`);
  }
  for (const word of student.mustNotMention ?? []) {
    const found = summaries.flat().filter((item) => normalise(item).includes(normalise(word)));
    if (found.length) failures++;
    console.log(`${found.length ? 'FAIL' : 'PASS'}  ${student.id}: never mentions "${word}"${found.length ? `  (found: ${found.join(', ')})` : ''}`);
  }
}

console.log('\n-- 3. Same student, different writing styles');
for (const [group, members] of groups) {
  if (members.length < 2) continue;
  const same = members.every((member) => member.actual === members[0].actual);
  if (!same) failures++;
  const scores = members.map((member) => member.expectedScore).filter((score) => score !== null);
  const spread = scores.length === members.length ? Math.max(...scores) - Math.min(...scores) : null;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${group}: ${members.map((member) => member.actual).join(' / ')}` +
    (spread === null ? '' : `   spread of the expected mentor's score: ${spread.toFixed(3)}`));
}

const total = cases.students.length;
console.log(`\n${failures === 0 ? 'Everything matched.' : `${failures} check(s) failed.`} (${total} students, ${cases.mentors.length} mentors)`);
process.exit(failures === 0 ? 0 : 1);
