// The check-in chat's first message, and what Gemini is told about the student. Both are built from
// the student's own data (their match record and checklist), not written by Gemini, so the first
// message never invents a task and doesn't use up a Gemini request just because the page opened.
// No Firebase here, so scripts/check-checkin.mjs can test it in Node.

/** @typedef {import('#lib/matching/matches.js').Match} Match */
/** @typedef {import('#lib/checkin/saved-checklist.js').Task} Task */
/** @typedef {{ label: string, href: string }} Link */

/** How each default checklist task reads in "you haven't … yet", by task id (see saved-checklist.js). */
const NOT_DONE = {
  gp: 'registered with a GP',
  'student-id': 'collected your student ID',
  society: 'joined a society',
  dentist: 'found a dentist',
  contacts: 'saved your key contacts'
};

/** At most this many tasks are named in the first message; the rest are counted. */
const MAX_TASKS_NAMED = 3;

/**
 * Joins items the way a person would write them: "a", "a or b", "a, b or c".
 * @param {string[]} items
 * @param {'and' | 'or'} word
 */
function inWords(items, word) {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`;
}

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Builds the chat's first messages and the buttons under them.
 * @param {{ match: Match | null | undefined, tasks: Task[] | null, justSignedUp: boolean }} input
 *   match is null if they have no match record, and undefined if it couldn't be loaded;
 *   tasks is null if the checklist couldn't be loaded; justSignedUp is true when they've come
 *   straight from /find-mentor
 * @returns {{ messages: string[], links: Link[] }}
 */
export function buildOpener({ match, tasks, justSignedUp }) {
  /** @type {Link[]} */
  const links = [];
  const hello = justSignedUp ? 'Thanks for answering those questions.' : 'Hi!';

  // 1. Their mentor, then how their day's been.
  let first;
  if (match?.status === 'matched') {
    first = `${hello} You’ve been matched with ${match.mentorName ?? 'a mentor'}, and your coordinator will introduce you. While you wait, how’s your day been?`;
    links.push({ label: 'Your mentor', href: '/mentor' });
  } else if (match?.status === 'coordinator') {
    first = `${hello} We’re finding you a mentor, and we’ll let you know soon. While you wait, how’s your day been?`;
  } else if (match === null) {
    first = `${hello} How’s your day been? If you’d like a student mentor, you can answer a few questions to be matched.`;
    links.push({ label: 'Find a mentor', href: '/find-mentor' });
  } else {
    first = `${hello} How’s your day been?`;
  }
  const messages = [first];

  // 2. Their checklist: a society first (as a question), then up to 3 other tasks by name.
  if (tasks && tasks.length > 0) {
    const notDone = tasks.filter((task) => !task.done);
    if (notDone.length === 0) {
      messages.push('I can see your checklist’s all done. Nice work!');
    } else {
      const societyLeft = notDone.some((task) => task.id === 'society');
      const others = notDone.filter((task) => task.id !== 'society' && task.id in NOT_DONE);
      const named = others.slice(0, MAX_TASKS_NAMED).map((task) => NOT_DONE[/** @type {keyof NOT_DONE} */ (task.id)]);
      // Everything else not done: default tasks past the first 3, and tasks the student added.
      const extra = notDone.length - named.length - (societyLeft ? 1 : 0);

      const parts = [];
      if (societyLeft) parts.push('Have you joined a society yet?');
      if (named.length > 0) {
        const more = extra > 0 ? `, plus ${plural(extra, 'other task')}` : '';
        parts.push(`I can see on your checklist that you haven’t ${inWords(named, 'or')} yet${more}.`);
      } else if (extra > 0) {
        parts.push(`I can see you’ve got ${plural(extra, 'task')} left on your checklist.`);
      }
      // One thing left reads as "that" (or "finding one" for a society); more than one, "any of these".
      const thingsLeft = (societyLeft ? 1 : 0) + named.length + extra;
      if (thingsLeft > 1) parts.push('Would you like help with any of these?');
      else parts.push(societyLeft ? 'Would you like help finding one?' : 'Would you like help with that?');
      messages.push(parts.join(' '));

      const gp = notDone.some((task) => task.id === 'gp');
      const dentist = notDone.some((task) => task.id === 'dentist');
      if (gp || dentist) {
        links.push({ label: gp && dentist ? 'Find a GP or dentist' : gp ? 'Find a GP' : 'Find a dentist', href: '/gp-finder' });
      }
      if (societyLeft) links.push({ label: 'Browse societies', href: '/societies' });
      links.push({ label: 'Open your checklist', href: '/checklist' });
    }
  }

  return { messages, links };
}

/**
 * Describes the student for Gemini's instructions, using only what the chat needs: no names (not
 * theirs, not their mentor's), and their own checklist tasks are counted but not named, as they
 * could contain anything.
 * @param {{ match: Match | null | undefined, tasks: Task[] | null }} input
 */
export function describeForGemini({ match, tasks }) {
  const lines = [];
  if (match?.status === 'matched') {
    lines.push('Mentor: matched with a student mentor; the mentoring coordinator will introduce them. You don’t know who the mentor is.');
  } else if (match?.status === 'coordinator') {
    lines.push('Mentor: the mentoring coordinator is finding them a mentor by hand.');
  } else if (match === null) {
    lines.push('Mentor: they haven’t asked for one yet. They can on the Find a mentor page.');
  } else {
    lines.push('Mentor: not known.');
  }

  if (tasks) {
    const titles = (/** @type {boolean} */ done) =>
      tasks.filter((task) => task.done === done && task.id in NOT_DONE).map((task) => task.title);
    const ownLeft = tasks.filter((task) => !task.done && !(task.id in NOT_DONE)).length;
    lines.push(`Checklist, not done yet: ${titles(false).join(', ') || 'nothing from the standard list'}.`);
    lines.push(`Checklist, done: ${titles(true).join(', ') || 'nothing from the standard list yet'}.`);
    if (ownLeft > 0) lines.push(`They also have ${plural(ownLeft, 'task')} of their own still to do (not shared with you).`);
  } else {
    lines.push('Checklist: not known.');
  }
  return lines.join('\n');
}
