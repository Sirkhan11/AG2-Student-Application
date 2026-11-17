// Checks the two things in scripts/lib/gemini-rest.mjs that keep test runs from draining Gemini's
// prepaid credit: the scripts' daily budget (300 requests a day, shared) and stopping at once on a
// 402 (the credit has run out). The helper runs in a child process with a made-up fetch and its own
// budget file in a temporary folder, so nothing goes to Gemini and the real count isn't touched.
//
// Run from the project folder:
//   node scripts/check-gemini-budget.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { budgetFrom, countRequest, DAILY_BUDGET, requestsOn, today } from './lib/gemini-rest.mjs';

const folder = mkdtempSync(join(tmpdir(), 'gemini-budget-check-'));
const HELPER = pathToFileURL(resolve('scripts/lib/gemini-rest.mjs')).href;

// Sets up the helper with made-up settings, answers every request itself, and asks for a reply
// `calls` times. Prints how many requests reached "Gemini" when it ends, however it ends.
const HARNESS = `
const [helper, budgetFile, budget, statuses, calls] = process.argv.slice(2);
const answers = JSON.parse(statuses);
let geminiRequests = 0;
process.on('exit', () => console.log('requests that reached Gemini: ' + geminiRequests));
globalThis.fetch = async (url) => {
  if (String(url).includes('exchangeDebugToken')) return new Response(JSON.stringify({ token: 'made-up' }), { status: 200 });
  geminiRequests++;
  const status = answers.shift() ?? 200;
  const body = status === 200 ? { candidates: [{ content: { parts: [{ text: 'made-up reply' }] } }] } : { error: { message: 'made up' } };
  return new Response(JSON.stringify(body), { status });
};
const { geminiFromEnv } = await import(helper);
const gemini = geminiFromEnv({
  VITE_FIREBASE_API_KEY: 'made-up', VITE_FIREBASE_PROJECT_ID: 'made-up', VITE_FIREBASE_APP_ID: 'made-up',
  VITE_APPCHECK_DEBUG_TOKEN: 'made-up', GEMINI_BUDGET_FILE: budgetFile, GEMINI_SCRIPT_BUDGET: budget
});
for (let i = 0; i < Number(calls); i++) console.log('reply: ' + (await gemini.generate('made-up-model', { contents: [] })));
`;
const harness = join(folder, 'harness.mjs');
writeFileSync(harness, HARNESS);

/**
 * @param {string} budgetFile
 * @param {number} budget
 * @param {number[]} statuses what "Gemini" answers, in order (200 after these)
 * @param {number} calls
 */
const run = (budgetFile, budget, statuses, calls) =>
  spawnSync(process.execPath, [harness, HELPER, budgetFile, String(budget), JSON.stringify(statuses), String(calls)], { encoding: 'utf8', timeout: 30_000 });

/** @type {[string, () => void][]} */
const checks = [
  ['The count is per day, kept in a file, and starts again on a new day or if the file is unreadable', () => {
    const file = join(folder, 'count', 'gemini-requests.json');
    assert.equal(requestsOn(file, '2026-11-17'), 0, 'no file yet');
    assert.equal(countRequest(file, '2026-11-17'), 1);
    assert.equal(countRequest(file, '2026-11-17'), 2);
    assert.equal(requestsOn(file, '2026-11-17'), 2);
    assert.equal(requestsOn(file, '2026-11-18'), 0, 'a new day');
    writeFileSync(file, 'not json');
    assert.equal(requestsOn(file, '2026-11-17'), 0);
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  }],
  [`The budget is ${DAILY_BUDGET} a day unless GEMINI_SCRIPT_BUDGET gives a whole number of at least 1`, () => {
    assert.equal(DAILY_BUDGET, 300);
    assert.equal(budgetFrom({}), 300);
    assert.equal(budgetFrom({ GEMINI_SCRIPT_BUDGET: '50' }), 50);
    for (const value of ['0', '-3', '2.5', 'lots', '']) assert.equal(budgetFrom({ GEMINI_SCRIPT_BUDGET: value }), 300, value);
  }],
  ['Once the budget is used up, the script stops before sending another request', () => {
    const file = join(folder, 'budget.json');
    const result = run(file, 1, [], 2);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Gemini requests from the scripts today: 0 of 1\./);
    assert.match(result.stdout, /reply: made-up reply/);
    assert.match(result.stdout, /Stopped: the scripts have sent 1 Gemini requests today, the daily budget/);
    assert.match(result.stdout, /requests that reached Gemini: 1\n/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { date: today(), count: 1 });
    // The next run the same day stops straight away, without sending anything.
    const again = run(file, 1, [], 1);
    assert.equal(again.status, 1);
    assert.match(again.stdout, /requests that reached Gemini: 0\n/);
  }],
  ['A 402 (the credit has run out) stops the script at once: not tried again, nothing more sent', () => {
    const result = run(join(folder, 'credit.json'), 300, [402], 3);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /prepaid credit has run out \(HTTP 402\)/);
    assert.doesNotMatch(result.stdout, /reply:/);
    assert.match(result.stdout, /requests that reached Gemini: 1\n/);
  }]
];

let failed = 0;
try {
  for (const [name, check] of checks) {
    try {
      check();
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 6).join('\n      ')}`);
    }
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
