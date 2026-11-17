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
 * Loads the signed-in student's saved checklist, or null if they haven't saved one (or aren't signed in).
 * null means "not known", so the chat says nothing about the checklist instead of guessing: it must
 * never claim to see a checklist that was never saved.
 * @returns {Promise<Task[] | null>}
 */
export async function loadSavedChecklist() {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  const saved = (await getDoc(doc(db, 'students', user.uid))).data()?.checklist;
  if (!Array.isArray(saved)) return null;
  // Keep only well-formed tasks, in case the record was edited by hand in the console.
  return saved
    .filter((task) => task && typeof task.id === 'string' && typeof task.title === 'string')
    .map((task) => ({ id: task.id, title: task.title, done: task.done === true }));
}
