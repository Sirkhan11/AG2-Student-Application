import { watchSignedIn } from '#lib/firebase/auth.js';

// The check-in chat's conversation, kept in memory while the app is open in this browser tab, so
// switching to another page (such as Mentor) and back doesn't wipe it, cards and all. Nothing is
// stored anywhere: it goes when the page is reloaded or the tab is closed, and it's cleared when the
// student logs out (on any page) or someone else logs in. The chat page reads and writes it, and
// startsAfresh() in keep-chat.js decides when to start a new conversation.
//
// Only ever changed in the browser: on the server, a module like this is shared by everyone's
// requests, so the chat page only changes it from code that runs in the browser.

/**
 * One bubble. kind marks the fixed safety message or an error. links are shown under it: a
 * suggested society, Northumbria Sport club or NSU service as a card with its details (see
 * reply-links.js), anything else
 * as a button (external ones open in a new tab).
 * @typedef {{ role: 'assistant' | 'user', text: string, kind?: 'safety' | 'error',
 *   links?: { label: string, href: string, external?: boolean, kind?: 'society' | 'club' | 'service',
 *     nsuId?: number, slug?: string, serviceId?: string }[] }} Message
 */

/**
 * @typedef {{ uid: string | null, messages: Message[], draft: string, waiting: boolean,
 *   started: boolean, conversation: number }} ChatSession
 */

/**
 * - uid: whose conversation it is, or null before one starts
 * - draft: what they've typed but not sent yet
 * - waiting: true while waiting for a reply, so only one message is sent at a time
 * - started: true once the first messages are in, so coming back shows them instead of starting again
 * - conversation: goes up each time it's cleared, so a reply for a conversation that's gone is dropped
 */
export const chatSession = $state(
  /** @type {ChatSession} */ ({ uid: null, messages: [], draft: '', waiting: false, started: false, conversation: 0 })
);

/** The Gemini conversation behind the messages. Not $state, as the page never shows it. */
/** @type {ReturnType<typeof import('#lib/checkin/chat.js').startCheckinChat> | null} */
let gemini = null;

export function geminiChat() {
  return gemini;
}

/** @param {ReturnType<typeof import('#lib/checkin/chat.js').startCheckinChat>} chat */
export function setGeminiChat(chat) {
  gemini = chat;
}

/**
 * Empties the conversation, ready for a new one.
 * @param {string | null} [uid] whose the new one will be
 */
export function clearChat(uid = null) {
  chatSession.uid = uid;
  chatSession.messages = [];
  chatSession.draft = '';
  chatSession.waiting = false;
  chatSession.started = false;
  chatSession.conversation++;
  gemini = null;
}

let watching = false;

/**
 * Clears the conversation whenever the student logs out, wherever they are in the app. The chat page
 * calls this; after the first call it keeps listening for as long as the app is open.
 */
export function clearChatOnSignOut() {
  if (watching) return;
  watching = true;
  watchSignedIn((signedIn) => {
    if (!signedIn) clearChat();
  });
}
