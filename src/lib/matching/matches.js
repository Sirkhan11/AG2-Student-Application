import { doc, getDoc, increment, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';

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

/** How often a student would like to meet: the same choices as the mentor sign-up form. */
export const MEETING_FREQUENCIES = ['weekly', 'every two weeks', 'monthly'];

/** The most reasons a match can store (firestore.rules checks the same number). */
export const MAX_REASONS = 3;

/** The longest availability text a match can store (firestore.rules checks the same number). */
export const MAX_AVAILABILITY_LENGTH = 200;

/**
 * What the student says about meeting, saved with their match so the coordinator can see it.
 * @typedef {{ meetingFrequency: string, availability: string }} MeetingPreferences
 */

/**
 * A saved match, as loadMyMatch returns it.
 * @typedef {({ status: 'matched', mentorId: string, mentorName: string, reasons: string[] }
 *   | { status: 'coordinator' }) & MeetingPreferences} Match
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
 * Saves that the signed-in student is waiting for the coordinator to find them a mentor (matching
 * couldn't pick one, or Gemini failed). No mentor's place is taken.
 * @param {MeetingPreferences} preferences
 */
export async function passToCoordinator(preferences) {
  await setDoc(doc(db, 'matches', currentUid()), {
    status: 'coordinator',
    ...checkedPreferences(preferences),
    createdAt: serverTimestamp()
  });
}

/**
 * Loads the signed-in student's match, or null if they haven't got one yet.
 * @returns {Promise<Match | null>}
 */
export async function loadMyMatch() {
  const snapshot = await getDoc(doc(db, 'matches', currentUid()));
  return snapshot.exists() ? /** @type {Match} */ (snapshot.data()) : null;
}
