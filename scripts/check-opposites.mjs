// Measures how MiniLM (the app's embed.js) scores some opposite and some genuinely similar phrase
// pairs, as evidence for why styles like "staying in" or "going out" shouldn't be compared by
// embedding: "quiet nights in" and "nights out" score higher than real synonyms do.
//
// It's a measurement, not a pass/fail test of our code: MiniLM gives these numbers whatever we
// change. It only fails if a score moves from the recorded value, which would mean the model itself
// changed (and every threshold would need checking again).
//
// Run from the project folder (the first run downloads the MiniLM model, about 23 MB):
//   node scripts/check-opposites.mjs

import { embed } from '#lib/matching/embed.js';
import { similarity } from '#lib/matching/similarity.js';

/** needsCoordinator's weakest acceptable score, and the cut-off for naming a phrase as a reason. */
const THRESHOLD = 0.3;
const REASON_CUT_OFF = 0.6;

/** [phrase, phrase, kind, score measured on 17 November 2026] */
const PAIRS = /** @type {const} */ ([
  ['quiet nights in', 'nights out', 'opposite', 0.71],
  ['staying in', 'partying', 'opposite', 0.429],
  ['early riser', 'night owl', 'opposite', 0.224],
  ['partying', 'going clubbing', 'similar', 0.575],
  ['gigs', 'live music', 'similar', 0.39]
]);

let changed = 0;
console.log(`${'Pair'.padEnd(34)} ${'Kind'.padEnd(9)} Score  Recorded`);
for (const [a, b, kind, recorded] of PAIRS) {
  const score = similarity(await embed(a), await embed(b));
  const moved = Math.abs(score - recorded) > 0.01;
  if (moved) changed++;
  const flags = [
    kind === 'opposite' && score > THRESHOLD ? `above ${THRESHOLD}` : '',
    kind === 'opposite' && score >= REASON_CUT_OFF ? `would be named as a shared reason (>= ${REASON_CUT_OFF})` : '',
    moved ? 'CHANGED from the recorded score' : ''
  ].filter(Boolean).join('; ');
  console.log(`${`${a} / ${b}`.padEnd(34)} ${kind.padEnd(9)} ${score.toFixed(3)}  ${recorded.toFixed(3)}${flags ? `  <- ${flags}` : ''}`);
}
console.log(changed === 0 ? '\nAll scores as recorded.' : `\n${changed} score(s) changed: has the embedding model changed?`);
process.exit(changed === 0 ? 0 : 1);
