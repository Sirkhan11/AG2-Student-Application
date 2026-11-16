// Regression test for the embed.js retry fix: if the model fails to load, the next call must try
// again, instead of getting the same failure back until the page is reloaded.
//
// It runs the real src/lib/matching/embed.js in Node, but swaps '@huggingface/transformers' for a
// stand-in whose pipeline() fails the first time and works after that. Nothing is downloaded and
// Firebase isn't involved.
//
// Run from the project folder (needs Node 22.15 or later, for module.registerHooks):
//   node scripts/check-embed-retry.mjs
// To see the old bug, pass the path to another copy of embed.js, such as the version before the fix:
//   git show <commit before the fix>:src/lib/matching/embed.js > ~/old-embed.js
//   node scripts/check-embed-retry.mjs ~/old-embed.js

import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const embedPath = process.argv[2] ?? fileURLToPath(new URL('../src/lib/matching/embed.js', import.meta.url));

// A stand-in for the model library: pipeline() fails the first time (like a blocked download), then works.
const fakeLibrary = `
  let calls = 0;
  export async function pipeline() {
    globalThis.downloadsTried = ++calls;
    if (calls === 1) throw new Error('model download blocked');
    return async () => ({ data: new Float32Array([0.6, 0.8]) });
  }`;

// Whenever anything imports '@huggingface/transformers', hand it the stand-in instead.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@huggingface/transformers') {
      return { url: 'data:text/javascript,' + encodeURIComponent(fakeLibrary), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});

const { embed } = await import(pathToFileURL(path.resolve(embedPath)).href);
const downloadsTried = () => /** @type {any} */ (globalThis).downloadsTried;
/** Resolves to true if the promise succeeded, false if it failed. @param {Promise<unknown>} promise */
const succeeded = (promise) => promise.then(() => true, () => false);

/** @type {boolean[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} detail */
function report(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}

console.log(`Testing ${embedPath}\n`);

// 1. Two calls at once while the download is blocked: both fail, but they share one attempt.
const [first, second] = await Promise.all([succeeded(embed('a')), succeeded(embed('b'))]);
report('While blocked, both calls fail and share one download attempt',
  !first && !second && downloadsTried() === 1, `${downloadsTried()} attempt(s)`);

// 2. The next call (the download works now) must try again rather than reuse the failure.
const retry = await succeeded(embed('c'));
report('After a failure, the next call tries a fresh download and works',
  retry && downloadsTried() === 2, `${downloadsTried()} attempt(s), ${retry ? 'worked' : 'failed'}`);

// 3. Once loaded, the model is reused rather than downloaded again.
const again = await succeeded(embed('d'));
report('Once loaded, the model is reused, not downloaded again',
  again && downloadsTried() === 2, `${downloadsTried()} attempt(s)`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
