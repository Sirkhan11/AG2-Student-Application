// What the check-in chat's Gemini is told about the student, and the one line the app still writes
// itself: how finding a mentor went, straight after it, with the mentor's name (which Gemini is never
// told). Everything else the chat says, Gemini writes (chat-turns.js). No Firebase here, so the checks
// test it in Node.

import { aboutYou, aboutYouForGemini, tidyText } from '#lib/checkin/about-you.js';
import { talkFor } from '#lib/checklist/how-to.js';

export { tidyProfile } from '#lib/checkin/about-you.js';

/** @typedef {import('#lib/matching/matches.js').Match} Match */
/** @typedef {import('#lib/checklist/tasks.js').Task} Task */

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Whether a task is one of the standard ones (with a how-to), rather than one of their own. @param {Task} task */
const standard = (task) => talkFor(task.id) !== null;

/**
 * The app's line straight after they find a mentor on the Find a mentor page: matched (with the
 * mentor's name), or the coordinator finding one; null otherwise.
 * @param {Match | null | undefined} match
 */
export function matchLine(match) {
  if (match?.status === 'matched') return `Thanks for answering those questions. You’ve been matched with ${match.mentorName ?? 'a mentor'}, and your coordinator will introduce you.`;
  if (match?.status === 'coordinator') return 'Thanks for answering those questions. We’re finding you a mentor, and we’ll let you know soon.';
  return null;
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
 * checklistNote: they said not now to going through their checklist in the chat, or stopped (kept
 * for what the app may tell Gemini; nothing sets it now that Gemini goes through it itself).
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
    lines.push('Mentor: they haven’t got one yet: the mentoring coordinator is finding them a mentor by hand, so there are no reasons for a match yet. If they ask why they were matched, or who their mentor is, say the coordinator is still finding one and they’ll hear soon.');
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
 * What the app allows, from what it knows, so Gemini is only offered the mentor actions that make sense
 * now (chat-tools.js):
 * - finding a mentor: only with no match record (not a mentor themselves, and not when there were no
 *   mentors available); after they said not now or stopped, only if they ask
 * - going through their checklist: only with something left to do
 * - asking for a different mentor: only when they've been matched
 * @param {Parameters<typeof describeForGemini>[0]} facts
 * @returns {{ mentor: 'yes' | 'if-asked' | 'no', checklist: 'yes' | 'if-asked' | 'no', hasMentor: boolean }}
 */
export function chatOptions({ match, tasks, isMentor = false, mentorNote = null, checklistNote = null }) {
  const left = (tasks ?? []).some((task) => !task.done);
  return {
    mentor: isMentor || match !== null || mentorNote === 'no-mentors' ? 'no' : mentorNote ? 'if-asked' : 'yes',
    checklist: !left ? 'no' : checklistNote ? 'if-asked' : 'yes',
    hasMentor: match?.status === 'matched'
  };
}
