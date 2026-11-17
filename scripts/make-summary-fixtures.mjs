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
import { geminiFromEnv } from './lib/gemini-rest.mjs';

const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'scripts/fixtures/summaries-current.json';
const force = args.includes('--force');
// Exits with a message if a setting is missing from .env or .env.development.local.
const gemini = geminiFromEnv(process.env);

/** @type {{ mentors: { id: string, answers: string[] }[], students: { id: string, answers: string[] }[] }} */
const cases = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));
const profiles = [...cases.mentors, ...cases.students];

/** @type {{ about: string, model: string, promptFingerprint: string, made: string, summaries: Record<string, import('#lib/matching/summary-prompt.js').Summary> }} */
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

/**
 * One summary request, shaped exactly as the Firebase SDK sends it (see summarise.js).
 * @param {string[]} answers
 */
async function summarise(answers) {
  const cleaned = cleanAnswers(answers);
  const text = await gemini.generate(MODEL_NAME, {
    contents: [{ role: 'user', parts: [{ text: requestText(cleaned) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: responseSchema(cleaned.length) },
    systemInstruction: { role: 'system', parts: [{ text: INSTRUCTIONS }] }
  });
  return readReply(text, cleaned.length);
}

const todo = profiles.filter((profile) => force || !out.summaries[profile.id]);
console.log(`Model ${MODEL_NAME}, prompt ${fingerprint}. ${profiles.length - todo.length} already done, ${todo.length} to do.`);
for (const [i, profile] of todo.entries()) {
  out.summaries[profile.id] = await summarise(profile.answers);
  out.made = new Date().toISOString();
  writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`  ${String(i + 1).padStart(2)}/${todo.length}  ${profile.id}`);
}
console.log(`Saved ${Object.keys(out.summaries).length} profiles to ${outFile}.`);
