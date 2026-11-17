import { doc, getDoc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';
import { summaryToSave } from '#lib/matching/summary-prompt.js';
import { MAX_REASONS } from '#lib/matching/explain.js';
import { MAX_AVAILABILITY_LENGTH, MEETING_FREQUENCIES } from '#lib/matching/meeting.js';

/*
 * A student's match lives at matches/{student uid}, so each student has at most one. Only that student
 * can create or read it (the coordinator uses the Firebase console), and nobody can change or delete it
 * from the app. firestore.rules allows exactly these fields:
 * - status 'matched': mentorId, mentorName, reasons (up to 3), meetingFrequency, availability, createdAt
 * - status 'coordinator': meetingFrequency, availability, createdAt (no mentor yet)
 *
 * Capacity: each mentor's public profile has studentCount. A student takes a place by creating their
 * match AND adding 1 to that mentor's studentCount in one batch, and the rules only allow that when the
 * mentor is approved, has room, and nothing else on their profile changes. So full mentors can't be
 * matched, without a server.
 */

// The choices and the limit live in meeting.js (no Firebase there, so the checks can use them); kept here too.
export { MAX_AVAILABILITY_LENGTH, MEETING_FREQUENCIES };

/**
 * What the student says about meeting, saved with their match so the coordinator can see it.
 * @typedef {{ meetingFrequency: string, availability: string }} MeetingPreferences
 */

/**
 * A saved match, as loadMyMatch returns it. A match the coordinator set up by hand in the console
 * may leave things out, so anything missing is null (or an empty list of reasons).
 * @typedef {{ status: 'matched', mentorId: string | null, mentorName: string | null, reasons: string[],
 *   meetingFrequency: string | null, availability: string | null }
 *   | { status: 'coordinator', meetingFrequency: string | null, availability: string | null }} Match
 */

/**
 * What the coordinator needs to match a student by hand, as the match record can't hold answers.
 * @typedef {{ answers: string[], summary: import('#lib/matching/summary-prompt.js').Summary | null,
 *   reason: string, reasonText: string }} MentorRequest
 */

/** The signed-in user's uid. Matches are always saved under it. */
function currentUid() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('You need to be logged in.');
  return user.uid;
}

/**
 * Checks the meeting preferences before saving, so a bad value fails here with a clear message
 * instead of as a refusal from the rules.
 * @param {MeetingPreferences} preferences
 */
function checkedPreferences(preferences) {
  const availability = preferences.availability.trim();
  if (!MEETING_FREQUENCIES.includes(preferences.meetingFrequency)) {
    throw new Error(`meetingFrequency must be one of: ${MEETING_FREQUENCIES.join(', ')}.`);
  }
  if (availability.length > MAX_AVAILABILITY_LENGTH) {
    throw new Error(`availability can be at most ${MAX_AVAILABILITY_LENGTH} characters.`);
  }
  return { meetingFrequency: preferences.meetingFrequency, availability };
}

/**
 * Takes one of a mentor's places for the signed-in student: creates their match and adds 1 to the
 * mentor's studentCount, in one batch, so either both happen or neither does.
 *
 * The rules refuse it (error code 'permission-denied') if the mentor is unapproved or full, or the
 * student already has a match. A mentor can fill up between ranking and saving, so on that error
 * the caller should rank again without them, or pass the student to the coordinator.
 * @param {{ id: string, name: string }} mentor
 * @param {string[]} reasons why they were matched, in words (up to MAX_REASONS)
 * @param {MeetingPreferences} preferences
 */
export async function takePlace(mentor, reasons, preferences) {
  const uid = currentUid();
  const batch = writeBatch(db);
  batch.set(doc(db, 'matches', uid), {
    status: 'matched',
    mentorId: mentor.id,
    mentorName: mentor.name,
    reasons: reasons.slice(0, MAX_REASONS),
    ...checkedPreferences(preferences),
    createdAt: serverTimestamp()
  });
  // increment(1) is applied to the count as it is when the write lands, not as this browser last
  // saw it. So if two students take a mentor's last place at the same moment, the second write sees
  // the mentor already full, and the rules refuse it.
  batch.update(doc(db, 'mentors', mentor.id), { studentCount: increment(1) });
  await batch.commit();
}

/**
 * Saves that the signed-in student is waiting for the coordinator to find them a mentor. No mentor's
 * place is taken. Two writes, in one batch so there's never one without the other:
 * - students/{uid}.mentorRequest: their answers, Gemini's summary (null if Gemini failed) and why they
 *   were passed on. Merged in, so nothing else in their student record is overwritten.
 * - matches/{uid} with status 'coordinator', which can't hold answers (see firestore.rules).
 * @param {MeetingPreferences} preferences
 * @param {MentorRequest} request
 */
export async function passToCoordinator(preferences, request) {
  const uid = currentUid();
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'students', uid),
    {
      mentorRequest: {
        reason: request.reason,
        reasonText: request.reasonText,
        answers: request.answers.map((answer) => answer.trim()),
        // Likes, avoids and styles. Firestore can't store a list of lists, so likes and avoids each
        // have one list of phrases per question, under q1 to q6.
        summaries: request.summary ? summaryToSave(request.summary) : null,
        requestedAt: serverTimestamp()
      }
    },
    { merge: true }
  );
  batch.set(doc(db, 'matches', uid), {
    status: 'coordinator',
    ...checkedPreferences(preferences),
    createdAt: serverTimestamp()
  });
  await batch.commit();
}

/**
 * A mentor's display name from their public profile, or null if it can't be read (for example
 * they're not approved any more, so students can't read their profile).
 * @param {string} mentorId
 */
async function displayNameOf(mentorId) {
  try {
    const name = (await getDoc(doc(db, 'mentors', mentorId))).data()?.displayName;
    return typeof name === 'string' && name.trim() !== '' ? name : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string | null} the value if it's text with something in it, otherwise null
 */
const textOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

/**
 * Loads the signed-in student's match, or null if they haven't got one yet.
 *
 * Copes with a match the coordinator set up by hand in the console: missing reasons become an empty
 * list, a missing mentorName is looked up from the mentor's public profile, and anything else missing
 * is null. Any status other than 'matched' counts as still waiting for the coordinator.
 * @returns {Promise<Match | null>}
 */
export async function loadMyMatch() {
  const snapshot = await getDoc(doc(db, 'matches', currentUid()));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const meeting = {
    meetingFrequency: textOrNull(data.meetingFrequency),
    availability: textOrNull(data.availability)
  };
  if (data.status !== 'matched') return { status: 'coordinator', ...meeting };

  const mentorId = textOrNull(data.mentorId);
  return {
    status: 'matched',
    mentorId,
    mentorName: textOrNull(data.mentorName) ?? (mentorId ? await displayNameOf(mentorId) : null),
    reasons: Array.isArray(data.reasons) ? data.reasons.filter((reason) => textOrNull(reason) !== null) : [],
    ...meeting
  };
}
