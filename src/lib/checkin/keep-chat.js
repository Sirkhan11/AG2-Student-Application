// When the check-in chat starts a new conversation instead of showing the one it kept in memory
// (see chat-session.svelte.js). A plain function with no Firebase, so check-checkin.mjs can test it.

/**
 * True when the chat should start a new conversation: there isn't one yet, the one kept is someone
 * else's, or they've just asked for a mentor (the new conversation then knows about their match).
 * Otherwise the chat shows the kept conversation as they left it.
 * @param {{ keptUid: string | null, started: boolean, uid: string | null, fromFindMentor: boolean }} state
 */
export function startsAfresh({ keptUid, started, uid, fromFindMentor }) {
  return !started || keptUid === null || keptUid !== uid || fromFindMentor;
}
