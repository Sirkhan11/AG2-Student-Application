// The check-in chat's first message, and what Gemini is told about the student. Both are built from
// the student's own data (their match record, checklist, and the course and interests they gave at
// sign-up), not written by Gemini, so the first message never invents a task and doesn't use up a
// Gemini request just because the page opened. No Firebase here, so scripts/check-checkin.mjs can
// test it in Node.

import { aboutYou, aboutYouForGemini, tidyText } from '#lib/checkin/about-you.js';
import { OWN_TASK_FOR_GEMINI, questionFor } from '#lib/checkin/checklist-talk.js';
import { talkFor } from '#lib/checklist/how-to.js';

export { tidyProfile } from '#lib/checkin/about-you.js';

/** @typedef {import('#lib/matching/matches.js').Match} Match */
/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/**
 * A button under the first messages. action: one of the chat's own actions (chat-actions.js), which
 * the button starts right there in the chat; href is where it goes otherwise (a plain link).
 * @typedef {{ label: string, href: string, action?: string }} Link
 */

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Whether a task is one of the standard ones (with a how-to), rather than one of their own. @param {Task} task */
const standard = (task) => talkFor(task.id) !== null;

/**
 * Builds the chat's first messages and the buttons under them. With something left on their
 * checklist, the chat starts going through it straight away: the last message asks about the first
 * task still to do (asks is its id), with Yes and Not yet under it (checklist-talk.js), and nothing
 * else asks a question, so there's only ever one. Straight after finding a mentor (justSignedUp), it
 * doesn't, as the chat's next message is about what might suit them.
 * @param {{ match: Match | null | undefined, tasks: Task[] | null, checklistSaved?: boolean, justSignedUp: boolean, isMentor?: boolean, forGemini?: boolean }} input
 *   match is null if they have no match record, and undefined if it couldn't be loaded; checklistSaved
 *   no longer matters here (asking about a task claims nothing about what they've done); isMentor is
 *   true for someone who signed up as a mentor, who isn't offered one; tasks is null if the checklist
 *   couldn't be loaded; justSignedUp is true when they've come straight from /find-mentor;
 *   forGemini: the version Gemini is told, which never has the words of one of their own tasks
 * @returns {{ messages: string[], links: Link[], asks: string | null }}
 */
export function buildOpener({ match, tasks, justSignedUp, isMentor = false, forGemini = false }) {
  /** @type {Link[]} */
  const links = [];
  const hello = justSignedUp ? 'Thanks for answering those questions.' : 'Hi!';
  const next = justSignedUp ? null : (tasks ?? []).find((task) => !task.done) ?? null;
  // Without a checklist question, the first message asks how their day's been; straight after finding
  // a mentor, the chat's next message asks something instead.
  const asking = !next && !justSignedUp;
  const day = asking ? ' How’s your day been?' : '';

  // 1. Their mentor.
  let first;
  if (match?.status === 'matched') {
    first = `${hello} You’ve been matched with ${match.mentorName ?? 'a mentor'}, and your coordinator will introduce you.${asking ? ' While you wait, how’s your day been?' : ''}`;
    links.push({ label: 'Your mentor', href: '/mentor' });
  } else if (match?.status === 'coordinator') {
    first = `${hello} We’re finding you a mentor, and we’ll let you know soon.${asking ? ' While you wait, how’s your day been?' : ''}`;
  } else if (match === null && !isMentor) {
    first = `${hello}${day} If you’d like a student mentor, you can answer a few questions to be matched.`;
    // Starts finding a mentor right here in the chat (chat-actions.js), rather than opening the page.
    links.push({ label: 'Find a mentor', href: '/find-mentor', action: 'mentor' });
  } else {
    first = next ? '' : `${hello}${day}`;
  }

  // 2. Their checklist: the first task still to do, or well done.
  /** @type {string[]} */
  const messages = [];
  if (next) {
    const question = forGemini && !standard(next) ? OWN_TASK_FOR_GEMINI.question : questionFor(next);
    if (first) messages.push(first);
    messages.push(`${first ? '' : `${hello} `}Let’s go through your checklist, one task at a time. ${question}`);
  } else {
    messages.push(first);
    if (!justSignedUp && tasks && tasks.length > 0) messages.push('I can see your checklist’s all done. Nice work!');
  }
  return { messages, links, asks: next?.id ?? null };
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
 * checklistNote: they said not now to going through their checklist in the chat, or stopped it
 * (checklist-talk.js), so it's only started again if they ask.
 * @param {{ match: Match | null | undefined, tasks: Task[] | null, checklistSaved?: boolean,
 *   profile?: Parameters<typeof aboutYou>[0], isMentor?: boolean,
 *   mentorNote?: 'declined' | 'stopped' | 'no-mentors' | null, today?: string | null,
 *   checklistNote?: 'declined' | 'stopped' | null }} input
 */
export function describeForGemini({ match, tasks, checklistSaved = true, profile = null, isMentor = false, mentorNote = null, today = null, checklistNote = null }) {
  const about = aboutYou(profile);
  const lines = [];
  if (isMentor) {
    lines.push('Mentor: they’re a mentor themselves (they signed up as one), so don’t offer to find them one.');
  } else if (match?.status === 'matched') {
    lines.push('Mentor: they have one. They’ve been matched with a student mentor, and the mentoring coordinator will introduce them. You aren’t told the mentor’s name or how to reach them.');
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
    lines.push('Mentor: they haven’t got one yet.');
    if (mentorNote === 'declined') lines.push('They said not now to finding a mentor in this chat.');
    if (mentorNote === 'stopped') lines.push('They started finding a mentor in this chat and stopped.');
  } else {
    lines.push('Mentor: not known.');
  }
  const frequency = match?.status === 'matched' || match?.status === 'coordinator' ? tidyText(match.meetingFrequency, 40) : '';
  if (frequency) lines.push(`How often they asked to meet their mentor: ${frequency}.`);

  if (tasks && !checklistSaved) {
    lines.push(`Checklist: they haven’t ticked anything off yet, and may not have opened it, so don’t say they haven’t done these. It starts with: ${tasks.map((task) => task.title).join(', ')}.`);
  } else if (tasks) {
    const titles = (/** @type {boolean} */ done) =>
      tasks.filter((task) => task.done === done && standard(task)).map((task) => task.title);
    const ownLeft = tasks.filter((task) => !task.done && !standard(task)).length;
    lines.push(`Checklist, not done yet: ${titles(false).join(', ') || 'nothing from the standard list'}.`);
    lines.push(`Checklist, done: ${titles(true).join(', ') || 'nothing from the standard list yet'}.`);
    if (ownLeft > 0) lines.push(`They also have ${plural(ownLeft, 'task')} of their own still to do (not shared with you).`);
  } else {
    lines.push('Checklist: not known.');
  }

  if (checklistNote === 'declined') lines.push('They said not now to going through their checklist here.');
  if (checklistNote === 'stopped') lines.push('They went through some of their checklist here and stopped.');
  return [...aboutYouForGemini(about, today), ...lines].join('\n');
}

/**
 * What the app allows in an ordinary chat turn, from what it knows (ChatOptions in chat-prompt.js), so
 * Gemini is only ever offered actions that make sense now:
 * - finding a mentor: only with no match record (not a mentor themselves, and not when there were no
 *   mentors available); after they said not now or stopped, only if they ask
 * - going through their checklist: only with something left to do; after not now or stopping, only if
 *   they ask
 * - showing their mentor, or asking for a different one: only when they've been matched
 * @param {Parameters<typeof describeForGemini>[0]} facts
 * @returns {import('#lib/checkin/chat-prompt.js').ChatOptions}
 */
export function chatOptions({ match, tasks, isMentor = false, mentorNote = null, checklistNote = null }) {
  const left = (tasks ?? []).some((task) => !task.done);
  return {
    mentor: isMentor || match !== null || mentorNote === 'no-mentors' ? 'no' : mentorNote ? 'if-asked' : 'yes',
    checklist: !left ? 'no' : checklistNote ? 'if-asked' : 'yes',
    hasMentor: match?.status === 'matched'
  };
}
