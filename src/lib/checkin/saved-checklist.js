import { doc, getDoc } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';

/*
 * The check-in chat only READS the student's checklist. Saving it is the checklist page's job, which
 * is a separate piece of work. The two agree on this format, stored at students/{uid}.checklist:
 *   [{ id: string, title: string, done: boolean }, ...]
 * The five default tasks always use these ids, which is how the chat recognises them:
 *   'gp', 'student-id', 'society', 'dentist', 'contacts'
 * Tasks the student adds use any other id.
 */

/** @typedef {{ id: string, title: string, done: boolean }} Task */

/**
 * What the check-in chat reads from the signed-in student's record (students/{uid}), in one read:
 * their saved checklist, and the course and interests they gave when they signed up. Nothing else is
 * taken from it: not their name, email or arrival date. The course and interests are passed on as
 * saved; describeForGemini() in opener.js tidies them.
 * tasks is null if they haven't saved a checklist (or aren't signed in). null means "not known", so
 * the chat says nothing about the checklist instead of guessing: it must never claim to see a
 * checklist that was never saved.
 * @returns {Promise<{ tasks: Task[] | null, course: unknown, interests: unknown }>}
 */
export async function loadForChat() {
  const user = getFirebaseAuth().currentUser;
  if (!user) return { tasks: null, course: null, interests: null };
  const data = (await getDoc(doc(db, 'students', user.uid))).data();
  const saved = data?.checklist;
  return {
    // Keep only well-formed tasks, in case the record was edited by hand in the console.
    tasks: Array.isArray(saved)
      ? saved
          .filter((task) => task && typeof task.id === 'string' && typeof task.title === 'string')
          .map((task) => ({ id: task.id, title: task.title, done: task.done === true }))
      : null,
    course: data?.course ?? null,
    interests: data?.interests ?? null
  };
}
