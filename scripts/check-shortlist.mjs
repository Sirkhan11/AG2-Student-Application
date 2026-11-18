// Checks the app's short list of likely societies, clubs and services for a chat message
// (src/lib/suggestions/), offline, with no Gemini:
// 1. The catalogue: every name is unique (societies, clubs, services and app pages), restricted
//    societies and services left out of the chat aren't in it, and every card links somewhere real.
// 2. The everyday words: every name they point to is in the catalogue.
// 3. Reading a message: the longest phrase wins ("ice hockey" isn't "hockey"), "not" and "don't like"
//    rule things out to the end of the sentence or a "but", an answer like "No, I like football"
//    rules nothing out, and a worry ("I don't have money for food") is never ruled out.
// 4. The short list for each case measure-chat.mjs asks Gemini about: something we'd expect is on it,
//    and nothing that's wrong for that student is. Gemini can only suggest from this list, so this is
//    the ceiling on how well suggestions can fit.
// Run from the project folder: node scripts/check-shortlist.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_PAGES } from '#lib/checkin/app-pages.js';
import { NOT_IN_CHAT, serviceById } from '#lib/nsu/services.js';
import { AUDIENCE, societyById } from '#lib/societies/societies.js';
import { CLUBS } from '#lib/sport/clubs.js';
import { SUGGESTIONS, suggestionNamed } from '#lib/suggestions/catalogue.js';
import { EVERYDAY, NOT_BY_NAME } from '#lib/suggestions/everyday-words.js';
import { readText, shortlist, SHORTLIST_SIZE } from '#lib/suggestions/shortlist.js';
import { EXPECT, EXTRA } from './lib/suggestion-cases.mjs';

let failures = 0;
/** @param {string} name @param {() => void} test */
function check(name, test) {
  try {
    test();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').join('\n      ')}`);
  }
}

const names = (/** @type {string} */ message, extra = {}) => shortlist({ message, ...extra }).map(({ suggestion }) => suggestion.name);

check('every name in the catalogue is unique, and none is also an app page', () => {
  const all = [...SUGGESTIONS.map((s) => s.name.toLowerCase()), ...APP_PAGES.map((page) => page.name.toLowerCase())];
  assert.deepEqual(all.filter((name, i) => all.indexOf(name) !== i), []);
});

check('restricted societies and services left out of the chat are never in the catalogue', () => {
  for (const id of Object.keys(AUDIENCE)) assert.equal(suggestionNamed(/** @type {{ name: string }} */ (societyById(Number(id))).name), null);
  for (const id of NOT_IN_CHAT) assert.equal(suggestionNamed(/** @type {{ name: string }} */ (serviceById(id)).name), null);
  assert.equal(SUGGESTIONS.filter((s) => s.kind === 'club').length, CLUBS.length);
});

check('every card links to a page in the app or NSU’s site', () => {
  for (const s of SUGGESTIONS) {
    assert.ok(s.link.href.startsWith('/') || s.link.href.startsWith('https://'), `${s.name}: ${s.link.href}`);
    assert.equal(s.link.kind, s.kind);
    assert.equal(s.link.label, s.name);
  }
});

check('every name the everyday words point to is in the catalogue', () => {
  const missing = [...new Set([...EVERYDAY.flatMap((entry) => entry.mean), ...NOT_BY_NAME])].filter((name) => !suggestionNamed(name));
  assert.deepEqual(missing, []);
});

check('the longest phrase wins: "ice hockey" is Ice Hockey, never the Hockey club; "table tennis" isn’t Tennis', () => {
  assert.deepEqual(names("I'm really into ice hockey"), ['Ice Hockey']);
  assert.ok(names('I play table tennis').includes('Table Tennis'));
  assert.ok(!names('I play table tennis').includes('Tennis'));
  assert.ok(names('rock climbing at the weekend').includes('Climbing'));
  assert.ok(!names('rock climbing at the weekend').includes('Rock'));
});

check('"not" and "don’t like" rule out what follows, to the end of the sentence or a "but"', () => {
  assert.ok(!names('Gigs and live music. Not sport.').includes('Sport'));
  assert.ok(!names('Gigs and live music. Not sport.').some((name) => CLUBS.some((club) => club.name === name)), 'ruling out sport rules out the clubs');
  assert.deepEqual(names("I'm not into sport, clubbing or gaming. I don't like loud nights out."), []);
  assert.ok(names("I'm not Ukrainian, but I'd love to learn about Ukrainian culture").includes('Ukrainian'));
  assert.ok(!names('Hiking and climbing. Not the gym.').includes('Pilates'));
  assert.ok(names('Not really into gaming but I love swimming').includes('Swimming'));
});

check('asking with "not" rules nothing out: "can you not check if there is a gym society?" (Thomas, on the live site), "is there not…", "why not"; "can you not suggest sport" still does', () => {
  for (const asked of ['can you not check if there is a gym society?', 'Could you not find a gym society for me?', 'is there not a gym society?', 'Is there no gym society?']) {
    assert.ok(names(asked).includes('Olympic Weightlifting'), asked);
  }
  assert.ok(names('why not the gym then').includes('Olympic Weightlifting'));
  assert.ok(!names('can you not suggest sport please').includes('Sport'), '"please don’t" still rules it out');
});

check('an answer ("No, I like football") rules nothing out, and nor does "not sure"', () => {
  assert.ok(names('No, I like football mostly').includes('Football'));
  assert.ok(names('Not really, more into swimming').includes('Swimming'));
  assert.ok(names("I'm not sure, maybe climbing?").includes('Climbing'));
});

check('a worry is never ruled out: "I don’t have money for food" still gets the Food Pantry', () => {
  assert.deepEqual(names("I don't have money for food"), ['Food Pantry', 'Cost of Living']);
  assert.ok(names("I've run out of money for food this week").includes('Food Pantry'));
});

check('everyday senses don’t count: "book an appointment", "running late", "good food"', () => {
  assert.deepEqual(names('I need to book an appointment'), []);
  assert.deepEqual(names("I'm running late for my lecture"), []);
  assert.deepEqual(names('A nice view and good food'), []);
});

check('what they’d rather avoid (from their answers) is never on the list, unless they ask for it now', () => {
  assert.ok(!names('Any ideas for this weekend?', { likes: ['live music'], avoids: ['partying'] }).includes('Beer'));
  assert.ok(names('Any ideas for this weekend?', { likes: ['live music'], avoids: ['partying'] }).includes('Gigs'));
  assert.ok(names('Actually, is there a beer society?', { avoids: ['drinking'] }).includes('Beer'));
});

check('suggestions from earlier in the chat stay on the list, so "How do I join?" can show the same card', () => {
  assert.deepEqual(names('How do I join?', { before: ['Climbing'] }), ['Climbing']);
});

check(`at most ${SHORTLIST_SIZE}, with why each is there`, () => {
  const list = shortlist({ message: 'Football, gigs, gaming, reading, climbing, swimming and films' });
  assert.equal(list.length, SHORTLIST_SIZE);
  assert.ok(list.every(({ why }) => why.length > 0 && why.every((reason) => reason.includes('"'))));
  assert.deepEqual(readText('Not sport.')[0], { names: ['Sport'], said: 'sport', ruledOut: true, weak: false, rulesOutClubs: true });
});

// 4. measure-chat.mjs's suggestion cases (scripts/lib/suggestion-cases.mjs): what we'd expect is on
// the list, and nothing wrong is.
const fixtures = JSON.parse(readFileSync('scripts/fixtures/matching-cases.json', 'utf8'));
for (const [group, expect] of Object.entries(EXPECT)) {
  const extra = EXTRA.find((/** @type {{ group: string }} */ e) => e.group === group);
  const asker = fixtures.students.find((/** @type {{ group: string }} */ s) => s.group === group);
  const message = extra?.message ?? `${asker.answers[1]} ${asker.answers[2]} Are there any societies you'd recommend?`;
  check(`the short list for "${group}"`, () => {
    const list = names(message);
    if (expect.anyOf.length) assert.ok(list.some((name) => expect.anyOf.includes(name)), `none of ${expect.anyOf.slice(0, 6).join(', ')} in: ${list.join(', ')}`);
    const wrong = list.filter((name) => expect.mustNot?.includes(name));
    assert.deepEqual(wrong, [], `shouldn't be on it: ${wrong.join(', ')}`);
  });
}

console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
