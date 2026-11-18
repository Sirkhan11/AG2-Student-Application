import { HOW_TO } from '#lib/checklist/how-to.js';
import { societyById, SOCIETIES, suggestible } from '#lib/societies/societies.js';
import { CHAT_CAMPUS } from '#lib/suggestions/catalogue.js';
import { shortlist } from '#lib/suggestions/shortlist.js';

// What Home shows as a dashboard (src/routes/home), worked out on the phone from the student's own
// record: the next checklist task and the button that does it, "Week 2 at Northumbria" when the
// arrival date they gave makes it true, and Societies for you. Home never calls Gemini, and nothing
// here is sent anywhere. No Firebase here, so the checks can test it in Node.

/** @typedef {import('#lib/checklist/tasks.js').Task} Task */
/** @typedef {import('#lib/societies/societies.js').Society} Society */

/**
 * The first task still to do, with the screen in the app that does it (how-to.js, do) when there is
 * one; null once everything's ticked.
 * @param {Task[]} tasks
 * @returns {{ id: string, title: string, do: { label: string, href: string } | null } | null}
 */
export function nextTask(tasks) {
  const task = tasks.find((candidate) => !candidate.done);
  return task ? { id: task.id, title: task.title, do: HOW_TO[task.id]?.do ?? null } : null;
}

/**
 * "Week 2 at Northumbria", only when the arrival date they gave at sign-up (2026-09-20) makes it
 * true: they've arrived, and it's within their first year. Otherwise null, and Home says nothing.
 * @param {unknown} arrivalDate
 * @param {Date} today
 */
export function weekLine(arrivalDate, today) {
  const parts = typeof arrivalDate === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrivalDate.trim()) : null;
  if (!parts) return null;
  const arrival = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(arrival)) return null;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.floor((now - arrival) / 86_400_000);
  if (days < 0 || days >= 52 * 7) return null;
  return `Week ${Math.floor(days / 7) + 1} at Northumbria`;
}

/**
 * Societies for you: up to two that match their interests, through the chat's own matching
 * (shortlist.js, the one line this depends on: societies only, not clubs or services), and one to try
 * that isn't a match, from the rest on the chat's campus, which changes each day. Nothing is invented:
 * with no interests, or none that match, there are no matches, and Home says so.
 * @param {string[]} interests from sign-up
 * @param {number} [day] which day it is (for the one to try), as a whole number of days
 * @returns {{ matches: Society[], tryNew: Society | null }}
 */
export function societiesForYou(interests, day = Math.floor(Date.now() / 86_400_000)) {
  /** @type {Society[]} */
  const matches = [];
  if (interests.length) {
    for (const { suggestion } of shortlist({ message: '', interests })) {
      const society = suggestion.kind === 'society' && suggestion.link.nsuId !== undefined ? societyById(suggestion.link.nsuId) : null;
      if (society && !matches.includes(society)) matches.push(society);
      if (matches.length === 2) break;
    }
  }
  const rest = SOCIETIES.filter((society) => society.campus === CHAT_CAMPUS && suggestible(society) && !matches.includes(society));
  return { matches, tryNew: rest.length ? rest[((day % rest.length) + rest.length) % rest.length] : null };
}
