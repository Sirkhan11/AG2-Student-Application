// Summarises every profile in scripts/fixtures/matching-cases.json with Gemini, once, and saves the
// results, so the matching checks can run again and again without Gemini.
//
// It makes exactly the request the app makes (instructions, reply shape and answer format all come
// from src/lib/matching/summary-prompt.js), but over REST instead of through the Firebase SDK,
// because the SDK's App Check needs a browser. Instead, it swaps the dev App Check debug token
// (VITE_APPCHECK_DEBUG_TOKEN in .env.development.local) for an App Check token, as the SDK does on
// localhost, and sends that with each request. Secrets are never printed.
//
// One request per profile (all six answers), at most one every 5 seconds: 12 a minute, under the
// free tier's 15. If Gemini still says "too many requests", it waits a minute and tries again.
// Results are saved after every profile, so if it stops, running it again carries on where it left off.
//
// Run from the project folder (takes about 3 minutes for 32 profiles):
//   node --env-file=.env --env-file=.env.development.local scripts/make-summary-fixtures.mjs
// Options: --out <file> (default scripts/fixtures/summaries-current.json), --force (redo every profile)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  cleanAnswers, INSTRUCTIONS, MODEL_NAME, readReply, requestText, responseSchema
} from '#lib/matching/summary-prompt.js';
import { SUMMARY_FINGERPRINT as fingerprint } from './lib/summary-fingerprint.mjs';

const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'scripts/fixtures/summaries-current.json';
const force = args.includes('--force');
const SPACING_MS = 5_000;

const env = process.env;
for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_APPCHECK_DEBUG_TOKEN']) {
  if (!env[name]) {
    console.log(`Missing ${name}. Run with --env-file=.env --env-file=.env.development.local from the project folder.`);
    process.exit(2);
  }
}
const apiKey = /** @type {string} */ (env.VITE_FIREBASE_API_KEY);
const projectId = /** @type {string} */ (env.VITE_FIREBASE_PROJECT_ID);
const appId = /** @type {string} */ (env.VITE_FIREBASE_APP_ID);

/** @type {{ mentors: { id: string, answers: string[] }[], students: { id: string, answers: string[] }[] }} */
const cases = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));
const profiles = [...cases.mentors, ...cases.students];

/** @type {{ about: string, model: string, promptFingerprint: string, made: string, summaries: Record<string, string[][]> }} */
let out = {
  about: 'Gemini summaries of the profiles in matching-cases.json, made by make-summary-fixtures.mjs. Regenerate rather than edit by hand.',
  model: MODEL_NAME,
  promptFingerprint: fingerprint,
  made: new Date().toISOString(),
  summaries: {}
};
if (existsSync(outFile) && !force) {
  const saved = JSON.parse(readFileSync(outFile, 'utf8'));
  if (saved.promptFingerprint === fingerprint) out = saved;
  else console.log(`${outFile} was made with a different prompt (${saved.promptFingerprint}), so starting again.`);
}

/** Swaps the dev debug token for a short-lived App Check token, as the SDK does on localhost. */
async function appCheckToken() {
  const response = await fetch(
    `https://content-firebaseappcheck.googleapis.com/v1/projects/${projectId}/apps/${appId}:exchangeDebugToken?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ debug_token: env.VITE_APPCHECK_DEBUG_TOKEN }) }
  );
  if (!response.ok) throw new Error(`App Check refused the debug token (HTTP ${response.status}). Is it registered in the console?`);
  return (await response.json()).token;
}

const wait = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One summary request, shaped exactly as the Firebase SDK sends it (see summarise.js).
 * @param {string} token
 * @param {string[]} answers
 */
async function summarise(token, answers) {
  const cleaned = cleanAnswers(answers);
  const body = {
    contents: [{ role: 'user', parts: [{ text: requestText(cleaned) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: responseSchema(cleaned.length) },
    systemInstruction: { role: 'system', parts: [{ text: INSTRUCTIONS }] }
  };
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${projectId}/models/${MODEL_NAME}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'X-Firebase-AppCheck': token, 'X-Firebase-Appid': appId },
      body: JSON.stringify(body)
    });
    if (response.status === 429 && attempt <= 3) {
      console.log('      Too many requests: waiting a minute, then trying again.');
      await wait(65_000);
      continue;
    }
    // 500 and 503 can mean "this model is experiencing high demand", which passes, so wait and retry.
    if ((response.status === 500 || response.status === 503) && attempt <= 4) {
      console.log(`      Gemini is busy (HTTP ${response.status}): waiting ${20 * attempt} seconds, then trying again.`);
      await wait(20_000 * attempt);
      continue;
    }
    if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const reply = await response.json();
    const text = reply.candidates?.[0]?.content?.parts?.map((/** @type {{ text?: string }} */ part) => part.text ?? '').join('') ?? '';
    return readReply(text, cleaned.length);
  }
}

const todo = profiles.filter((profile) => force || !out.summaries[profile.id]);
console.log(`Model ${MODEL_NAME}, prompt ${fingerprint}. ${profiles.length - todo.length} already done, ${todo.length} to do.`);
let token = await appCheckToken();
let tokenTime = Date.now();
let last = 0;
for (const [i, profile] of todo.entries()) {
  if (Date.now() - tokenTime > 30 * 60_000) {
    token = await appCheckToken(); // App Check tokens last about an hour
    tokenTime = Date.now();
  }
  await wait(Math.max(0, last + SPACING_MS - Date.now()));
  last = Date.now();
  out.summaries[profile.id] = await summarise(token, profile.answers);
  out.made = new Date().toISOString();
  writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`  ${String(i + 1).padStart(2)}/${todo.length}  ${profile.id}`);
}
console.log(`Saved ${Object.keys(out.summaries).length} profiles to ${outFile}.`);
