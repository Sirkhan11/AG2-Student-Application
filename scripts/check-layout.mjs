// Checks the five screens laid out like the group's wireframes (design-reference/, ignored by git):
// the bottom bar, Need help now, the GP and dentist finder, the checklist and Home.
// 1. Offline, in Node: the bottom bar's tabs come from one list (nav-tabs.js) that the bar draws and
//    the page transitions crossfade between (Home, Checklist, Chat in the middle, Societies, More),
//    and Mentor stays one tap away on More.
// Run from the project folder:
//   node scripts/check-layout.mjs
//   npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-layout.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TAB_PATHS, TABS } from '#lib/nav-tabs.js';
import { TABS as TRANSITION_TABS, transitionFor } from '#lib/page-transitions.js';
import { emulators } from './lib/emulator-app.mjs';

const source = (/** @type {string} */ file) => readFileSync(file, 'utf8');

/** @type {[string, () => void][]} */
const offline = [
  ['The bottom bar: Home, Checklist, Chat in the middle, Societies where Mentor was, More; in one list that the bar draws and the transitions crossfade between', () => {
    assert.deepEqual(TABS.map((tab) => tab.name), ['Home', 'Checklist', 'Chat', 'Societies', 'More']);
    assert.deepEqual([...TAB_PATHS], ['/home', '/checklist', '/check-in', '/societies', '/more']);
    assert.equal(TRANSITION_TABS, TAB_PATHS, 'the transitions use the same list');
    assert.equal(transitionFor('/home', '/societies'), 'tab', 'between tabs: a crossfade');
    assert.equal(transitionFor('/home', '/mentor'), 'forward', 'Mentor is a page below the bar now');
    assert.equal(transitionFor('/societies', '/societies/15'), 'forward');
    const bar = source('src/lib/components/BottomNav.svelte');
    assert.match(bar, /import \{ TABS \} from '#lib\/nav-tabs\.js';/);
    assert.match(bar, /const links = TABS;/);
    assert.doesNotMatch(bar, /href: '\/mentor'/, 'no tab list of its own');
    assert.match(source('src/lib/page-transitions.js'), /export const TABS = TAB_PATHS;/);
  }],
  ['Mentor stays one tap away: Your Mentor is first on More', () => {
    const more = source('src/routes/more/+page.svelte');
    assert.match(more, /const menu = \/\*\* @type \{const\} \*\/ \(\[\s*\{ name: 'Your Mentor', href: '\/mentor', icon: 'mentor' \},/);
  }]
];

let failed = 0;
let total = 0;
for (const [name, check] of offline) {
  total++;
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}

const where = emulators();
if (!where) {
  console.log('\n(The browser checks need the emulators: npx --engine-strict=false firebase-tools emulators:exec --only auth,firestore --project demo-ag2 "node scripts/check-layout.mjs")');
}
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
