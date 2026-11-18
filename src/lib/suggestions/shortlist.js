import { SUGGESTIONS, suggestionNamed } from '#lib/suggestions/catalogue.js';
import { EVERYDAY, NOT_BY_NAME, NOTHING, RULING_OUT, RULING_OUT_ENDS } from '#lib/suggestions/everyday-words.js';

// The app's short list of likely societies, clubs and services for one chat message, from what the
// student has just said, what they said earlier in the chat, the interests and course they gave at
// sign-up, and the summary of their answers from finding a mentor. Gemini may only suggest from this
// list (its reply's schema allows nothing else), and is told why each one is on it, so it can choose
// the ones that really fit. What they've ruled out ("Not sport.", or what they'd rather avoid in their
// answers) never goes on it, unless they've just asked for it.
// No Firebase here, so the checks can use it in Node.

/** How many go on the list for one message: enough to choose from, few enough to read closely. */
export const SHORTLIST_SIZE = 8;

/** How much each place counts. What they've just said counts most. */
const WEIGHT = { message: 4, earlier: 2, profile: 1.5, course: 1, before: 3.5 };
/** A general word (weak in everyday-words.js) counts this much of that. */
const WEAK = 0.25;

/**
 * One word of a message, as it's compared: lower case, no punctuation, and without a final "s" (not
 * after "s", "u" or "i", so "chess", "bus" and "this" stay as they are). pause: a comma or the end of
 * a sentence straight after it.
 * @typedef {{ word: string, raw: string, pause: 'comma' | 'end' | null }} Word
 */

/** @param {string} word */
const stem = (word) => (word.length > 3 && word.endsWith('s') && !/[sui]s$/.test(word) ? word.slice(0, -1) : word);

/**
 * The words of some text, for comparing: "Not sport. I'd love K-Pop!" gives not / sport (end) / id /
 * love / k / pop (end).
 * @param {string} text
 * @returns {Word[]}
 */
export function wordsOf(text) {
  /** @type {Word[]} */
  const words = [];
  const tidied = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[.!?;:\n]+/g, ' . ')
    .replace(/,/g, ' , ')
    .replace(/[^a-z0-9., ]+/g, ' ');
  for (const token of tidied.split(/\s+/)) {
    if (!token) continue;
    if (token === '.' || token === ',') {
      const last = words.at(-1);
      if (last && last.pause !== 'end') last.pause = token === '.' ? 'end' : 'comma';
      continue;
    }
    const word = token.replace(/[.,]/g, '');
    if (word) words.push({ word: stem(word), raw: word, pause: null });
  }
  return words;
}

/** A phrase's words, as compared. @param {string} phrase */
const phraseWords = (phrase) => wordsOf(phrase).map((word) => word.word);

/**
 * What a phrase means: the suggestions it points to (from EVERYDAY, or a name), nothing (NOTHING),
 * ruling out what follows (RULING_OUT), or the end of ruling out (RULING_OUT_ENDS).
 * @typedef {{ type: 'means', names: string[], need: boolean, weak: boolean, rulesOutClubs: boolean }
 *   | { type: 'nothing' } | { type: 'not' } | { type: 'but' }} Meaning
 */

/** Every phrase by its first word, longest first, so the longest phrase at a place wins. */
const PHRASES = (() => {
  /** @type {Map<string, { words: string[], meaning: Meaning }[]>} */
  const byFirst = new Map();
  /** @param {string} phrase @param {Meaning} meaning */
  const add = (phrase, meaning) => {
    const words = phraseWords(phrase);
    if (!words.length) return;
    const list = byFirst.get(words[0]) ?? [];
    // The same phrase twice (a name that's also an everyday word): the names go together.
    const same = list.find((known) => known.words.join(' ') === words.join(' '));
    if (same && same.meaning.type === 'means' && meaning.type === 'means') {
      same.meaning.names = [...new Set([...same.meaning.names, ...meaning.names])];
    } else if (!same) {
      list.push({ words, meaning });
    }
    byFirst.set(words[0], list);
  };
  for (const phrase of NOTHING) add(phrase, { type: 'nothing' });
  for (const phrase of RULING_OUT) add(phrase, { type: 'not' });
  for (const phrase of RULING_OUT_ENDS) add(phrase, { type: 'but' });
  for (const entry of EVERYDAY) {
    for (const phrase of entry.say) {
      add(phrase, { type: 'means', names: [...entry.mean], need: Boolean(entry.need), weak: Boolean(entry.weak), rulesOutClubs: Boolean(entry.rulesOutClubs) });
    }
  }
  for (const suggestion of SUGGESTIONS) {
    if (!NOT_BY_NAME.includes(suggestion.name)) add(suggestion.name, { type: 'means', names: [suggestion.name], need: false, weak: false, rulesOutClubs: false });
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  return byFirst;
})();

/**
 * What one piece of text says, phrase by phrase: each phrase that points to suggestions, the words
 * that matched, and whether it was ruled out ("not", "don't like", up to the end of the sentence or
 * a "but"). Help with a worry (need) is never ruled out.
 * @param {string} text
 * @returns {{ names: string[], said: string, ruledOut: boolean, weak: boolean, rulesOutClubs: boolean }[]}
 */
export function readText(text) {
  const words = wordsOf(text);
  /** @type {ReturnType<typeof readText>} */
  const found = [];
  let rulingOut = false;
  for (let i = 0; i < words.length; ) {
    const match = (PHRASES.get(words[i].word) ?? []).find((phrase) => phrase.words.every((word, j) => words[i + j]?.word === word));
    const length = match ? match.words.length : 1;
    const last = words[i + length - 1];
    if (match?.meaning.type === 'not') {
      // "No, I like football": an answer, not ruling anything out.
      rulingOut = last.pause === null;
    } else if (match?.meaning.type === 'but') {
      rulingOut = false;
    } else if (match?.meaning.type === 'means') {
      const { names, need, weak, rulesOutClubs } = match.meaning;
      found.push({ names, said: words.slice(i, i + length).map((word) => word.raw).join(' '), ruledOut: rulingOut && !need, weak, rulesOutClubs });
    }
    if (last.pause === 'end') rulingOut = false;
    i += length;
  }
  return found;
}

/**
 * One suggestion on the short list, with why it's there, in words for Gemini.
 * @typedef {{ suggestion: import('#lib/suggestions/catalogue.js').Suggestion, why: string[] }} Shortlisted
 */

/**
 * The short list for one message.
 * @param {{ message: string, earlier?: string[], interests?: string[], likes?: string[], avoids?: string[],
 *   course?: string | null, before?: string[] }} input
 *   message: what they've just said; earlier: their earlier messages in this chat, newest first;
 *   interests: from sign-up; likes and avoids: the summary of their answers from finding a mentor;
 *   course: from sign-up; before: the names suggested in this chat so far, newest first (kept on the
 *   list, so "How do I join?" can show the same card again)
 * @param {number} [size]
 * @returns {Shortlisted[]}
 */
export function shortlist({ message, earlier = [], interests = [], likes = [], avoids = [], course = null, before = [] }, size = SHORTLIST_SIZE) {
  /** @type {Map<string, { score: number, order: number, why: string[] }>} */
  const scores = new Map();
  /** What they've ruled out, and what they've just asked for (which wins over that). */
  const ruledOut = new Set();
  let clubsRuledOut = false;
  const askedNow = new Set();
  let order = 0;

  /** Names something specific counted for (not only a general word such as "societies"). */
  const specific = new Set();
  /** @param {string} name @param {number} weight @param {string} why @param {boolean} [weak] */
  const count = (name, weight, why, weak = false) => {
    const known = scores.get(name) ?? { score: 0, order: order++, why: [] };
    known.score += weight;
    if (!known.why.includes(why)) known.why.push(why);
    if (!weak) specific.add(name);
    scores.set(name, known);
  };
  /**
   * @param {string} text @param {number} weight @param {(said: string) => string} why
   * @param {boolean} [now] what they've just said
   */
  const read = (text, weight, why, now = false) => {
    for (const phrase of readText(text)) {
      if (phrase.ruledOut) {
        for (const name of phrase.names) ruledOut.add(name);
        if (phrase.rulesOutClubs) clubsRuledOut = true;
        continue;
      }
      phrase.names.forEach((name, i) => {
        if (now) askedNow.add(name);
        // The most likely names for a phrase come first, and count a little more.
        count(name, (phrase.weak ? WEAK : 1) * weight * (1 - i * 0.05), why(phrase.said), phrase.weak);
      });
    }
  };

  read(message, WEIGHT.message, (said) => `they said "${said}"`, true);
  earlier.slice(0, 3).forEach((text, i) => read(text, WEIGHT.earlier / (i + 1), (said) => `they said "${said}" earlier`));
  for (const interest of interests) read(interest, WEIGHT.profile, (said) => `an interest they gave when they signed up ("${said}")`);
  for (const like of likes) read(like, WEIGHT.profile, (said) => `from their answers when finding a mentor ("${said}")`);
  if (course) read(course, WEIGHT.course, () => 'their course');
  // What they'd rather avoid, from their answers: ruled out as if they'd said "not".
  for (const avoid of avoids) {
    for (const phrase of readText(avoid)) {
      for (const name of phrase.names) ruledOut.add(name);
      if (phrase.rulesOutClubs) clubsRuledOut = true;
    }
  }
  before.slice(0, 3).forEach((name) => {
    if (suggestionNamed(name)) count(name, WEIGHT.before, 'suggested earlier in this chat');
  });

  const allowed = [...scores.entries()]
    .map(([name, score]) => ({ suggestion: suggestionNamed(name), ...score, name }))
    .filter(
      (entry) =>
        entry.suggestion !== null &&
        (askedNow.has(entry.name) || (!ruledOut.has(entry.name) && !(clubsRuledOut && entry.suggestion.kind === 'club')))
    );
  // A general word on its own ("Any societies?" with nothing about what they like) gives no list, so
  // Gemini asks what they enjoy instead of offering something vague.
  const anySpecific = allowed.some((entry) => specific.has(entry.name));
  return allowed
    .filter((entry) => anySpecific || specific.has(entry.name))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, size)
    .map((entry) => ({ suggestion: /** @type {import('#lib/suggestions/catalogue.js').Suggestion} */ (entry.suggestion), why: entry.why.slice(0, 3) }));
}
