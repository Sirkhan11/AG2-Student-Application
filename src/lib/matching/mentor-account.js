import { doc, getDoc } from 'firebase/firestore';
import { db, getFirebaseAuth } from '#lib/firebase/client.js';

// Whether the signed-in account is a mentor's, kept apart from mentors.js (which brings in the matching
// model), so the check-in chat can ask without loading all of that.

/**
 * True if the signed-in user has a mentor profile (mentors/{uid}), so student-only pages can turn
 * mentors away. It's only a page guard: there are no roles yet, so the rules can't tell a mentor
 * account from a student one.
 */
export async function hasMentorProfile() {
  const user = getFirebaseAuth().currentUser;
  if (!user) return false;
  try {
    return (await getDoc(doc(db, 'mentors', user.uid))).exists();
  } catch (err) {
    // A mentor can always read their own profile, so a refusal means there isn't one.
    if (/** @type {{ code?: string }} */ (err).code === 'permission-denied') return false;
    throw err;
  }
}
