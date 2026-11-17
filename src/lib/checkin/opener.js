// The check-in chat's first message, and what Gemini is told about the student. Both are built from
// the student's own data (their match record, checklist, and the course and interests they gave at
// sign-up), not written by Gemini, so the first message never invents a task and doesn't use up a
// Gemini request just because the page opened. No Firebase here, so scripts/check-checkin.mjs can
// test it in Node.

import { aboutYou, aboutYouForGemini, tidyText } from '#lib/checkin/about-you.js';

export { tidyProfile } from '#lib/checkin/about-you.js';

/** @typedef {import('#lib/matching/matches.js').Match} Match */
/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/**
 * A button under the first messages. action: one of the chat's own actions (chat-actions.js), which
 * the button starts right there in the chat; href is where it goes otherwise (a plain link).
 * @typedef {{ label: string, href: string, action?: string }} Link
 */

/** How each default checklist task reads in "you haven't … yet", by task id (see DEFAULT_TASKS in checklist/tasks.js). */
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
 * @param {{ match: Match | null | undefined, tasks: Task[] | null, checklistSaved?: boolean, justSignedUp: boolean, isMentor?: boolean }} input
 *   match is null if they have no match record, and undefined if it couldn't be loaded; isMentor is
 *   true for someone who signed up as a mentor, who isn't offered one;
 *   tasks is null if the checklist couldn't be loaded; checklistSaved is false when they've never
 *   changed it (tasks are then the five defaults, unticked: they may have done some without
 *   ticking them, so the message doesn't say they haven't); justSignedUp is true when they've come
 *   straight from /find-mentor
 * @returns {{ messages: string[], links: Link[] }}
 */
export function buildOpener({ match, tasks, checklistSaved = true, justSignedUp, isMentor = false }) {
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
  } else if (match === null && !isMentor) {
    first = `${hello} How’s your day been? If you’d like a student mentor, you can answer a few questions to be matched.`;
    // Starts finding a mentor right here in the chat (chat-actions.js), rather than opening the page.
    links.push({ label: 'Find a mentor', href: '/find-mentor', action: 'mentor' });
  } else {
    first = `${hello} How’s your day been?`;
  }
  const messages = [first];

  // 2. Their checklist: a society first (as a question), then up to 3 other tasks by name.
  if (tasks && tasks.length > 0 && !checklistSaved) {
    // Never ticked anything: point them to it, without claiming what they haven't done.
    messages.push('Your checklist has a few things that help with settling in, like registering with a GP and joining a society. Have a look when you’re ready.');
    links.push({ label: 'Open your checklist', href: '/checklist' });
  } else if (tasks && tasks.length > 0) {
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

/** How long each saved reason for their match can be, as Gemini is told it. */
const MAX_REASON_LENGTH = 160;

/**
 * Describes the student for Gemini's instructions, using only what the chat needs: the about-you
 * record (about-you.js: their first name, course, interests and arrival date from sign-up, the summary
 * of their answers from finding a mentor, and what they asked the chat to remember), their mentor
 * match (status, the reasons saved with it, and how often they asked to meet) and their checklist.
 * Never their full name, their email, their mentor's name or id, or their availability note. Their own
 * checklist tasks are counted but not named, as they could contain anything.
 * isMentor: they signed up as a mentor, so they're never offered one. mentorNote: what happened to
 * finding a mentor in this chat, so Gemini doesn't offer it again ('declined': they said not now;
 * 'stopped': they stopped part way; 'no-mentors': there were none available). today, as the sign-up
 * form writes dates (2026-11-17), tells Gemini whether they've arrived yet.
 * @param {{ match: Match | null | undefined, tasks: Task[] | null, checklistSaved?: boolean,
 *   profile?: Parameters<typeof aboutYou>[0], isMentor?: boolean,
 *   mentorNote?: 'declined' | 'stopped' | 'no-mentors' | null, today?: string | null }} input
 */
export function describeForGemini({ match, tasks, checklistSaved = true, profile = null, isMentor = false, mentorNote = null, today = null }) {
  const about = aboutYou(profile);
  const lines = [];
  if (isMentor) {
    lines.push('Mentor: they’re a mentor themselves (they signed up as one), so don’t offer to find them one.');
  } else if (match?.status === 'matched') {
    lines.push('Mentor: they have one. They’ve been matched with a student mentor, and the mentoring coordinator will introduce them. You aren’t told the mentor’s name: if they ask who it is, tell them it’s on the Your Mentor page.');
    const reasons = (match.reasons ?? []).map((reason) => tidyText(reason, MAX_REASON_LENGTH)).filter(Boolean).slice(0, 3);
    lines.push(
      reasons.length
        ? `Why the app matched them (they see the same reasons on the Your Mentor page): ${reasons.join('; ')}.`
        : 'Why the app matched them: not recorded, so if they ask, say the Your Mentor page has what there is.'
    );
  } else if (match?.status === 'coordinator') {
    lines.push('Mentor: the mentoring coordinator is finding them a mentor by hand.');
  } else if (match === null && mentorNote === 'no-mentors') {
    lines.push('Mentor: they asked in this chat, but there are no mentors available yet, so don’t offer again in this chat.');
  } else if (match === null) {
    lines.push('Mentor: they haven’t got one yet. If they want one, you can find them one here in the chat (see Finding them a student mentor).');
    if (mentorNote === 'declined') lines.push('They said not now to finding a mentor in this chat: don’t offer it again unless they ask for a mentor. If they do, offer it as usual, with {{mentor}}.');
    if (mentorNote === 'stopped') lines.push('They started finding a mentor in this chat and stopped: don’t offer it again unless they ask for a mentor. If they do, offer it as usual, with {{mentor}}.');
  } else {
    lines.push('Mentor: not known.');
  }
  const frequency = match?.status === 'matched' || match?.status === 'coordinator' ? tidyText(match.meetingFrequency, 40) : '';
  if (frequency) lines.push(`How often they asked to meet their mentor: ${frequency}.`);

  if (tasks && !checklistSaved) {
    lines.push(`Checklist: they haven’t ticked anything off yet, and may not have opened it, so don’t say they haven’t done these. It starts with: ${tasks.map((task) => task.title).join(', ')}.`);
  } else if (tasks) {
    const titles = (/** @type {boolean} */ done) =>
      tasks.filter((task) => task.done === done && task.id in NOT_DONE).map((task) => task.title);
    const ownLeft = tasks.filter((task) => !task.done && !(task.id in NOT_DONE)).length;
    lines.push(`Checklist, not done yet: ${titles(false).join(', ') || 'nothing from the standard list'}.`);
    lines.push(`Checklist, done: ${titles(true).join(', ') || 'nothing from the standard list yet'}.`);
    if (ownLeft > 0) lines.push(`They also have ${plural(ownLeft, 'task')} of their own still to do (not shared with you).`);
  } else {
    lines.push('Checklist: not known.');
  }

  return [...aboutYouForGemini(about, today), ...lines].join('\n');
}
