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
 * One bubble. kind marks the fixed safety message, an error, or the chat being unavailable (Gemini's
 * credit has run out). links are shown under it: a suggested society, Northumbria Sport club or NSU
 * service as a card with its details (see reply-links.js), anything else as a button (external ones
 * open in a new tab).
 * task is a checklist task the chat suggested, shown as a card with Add and No thanks; state says
 * what's happened to it (kept here, so it stays the same when they come back to the chat).
 * offer is one of the chat's own actions Gemini offered (chat-actions.js), shown as a card with Start
 * and Not now. flow is a card from an action the app is running in the chat (mentor-flow.js), such as
 * the meeting choices or the answers to check. A link with an action starts that action in the chat.
 * @typedef {{ role: 'assistant' | 'user', text: string, kind?: 'safety' | 'error' | 'unavailable',
 *   links?: { label: string, href: string, external?: boolean, kind?: 'society' | 'club' | 'service',
 *     nsuId?: number, slug?: string, serviceId?: string, action?: string }[],
 *   task?: SuggestedTask, offer?: Offer, flow?: import('#lib/checkin/mentor-flow.js').FlowCard & { id: number } }} Message
 */

/** @typedef {{ action: string, state: 'offered' | 'started' | 'declined' }} Offer */

/**
 * @typedef {{ title: string, state: 'offered' | 'added' | 'queued' | 'declined' | 'exists' | 'full', existing?: string }} SuggestedTask
 */

/**
 * @typedef {{ uid: string | null, messages: Message[], draft: string, waiting: boolean,
 *   started: boolean, unavailable: boolean, conversation: number,
 *   flow: import('#lib/checkin/mentor-flow.js').FlowState | null }} ChatSession
 */

/**
 * - uid: whose conversation it is, or null before one starts
 * - draft: what they've typed but not sent yet
 * - waiting: true while waiting for a reply, so only one message is sent at a time
 * - started: true once the first messages are in, so coming back shows them instead of starting again
 * - unavailable: true once Gemini has said its credit has run out, so the message box is switched off
 * - conversation: goes up each time it's cleared, so a reply for a conversation that's gone is dropped
 * - flow: where an action the app is running in the chat is (finding a mentor), or null
 */
export const chatSession = $state(
  /** @type {ChatSession} */ ({ uid: null, messages: [], draft: '', waiting: false, started: false, unavailable: false, conversation: 0, flow: null })
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

/** The action the app is running in the chat (finding a mentor), made when it's first started. */
/** @type {ReturnType<typeof import('#lib/checkin/mentor-flow.js').createMentorFlow> | null} */
let flow = null;

export const chatFlow = () => flow;

/** @param {ReturnType<typeof import('#lib/checkin/mentor-flow.js').createMentorFlow> | null} next */
export function setChatFlow(next) {
  flow = next;
}

/**
 * What Gemini was told about the student (describeForGemini's input), kept so it can be told again
 * when that changes in the chat, such as a mentor found here. Not $state: the page never shows it.
 * @type {Parameters<typeof import('#lib/checkin/opener.js').describeForGemini>[0] | null}
 */
let facts = null;

export const chatFacts = () => facts;

/** @param {Parameters<typeof import('#lib/checkin/opener.js').describeForGemini>[0] | null} next */
export function setChatFacts(next) {
  facts = next;
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
  chatSession.unavailable = false;
  chatSession.conversation++;
  chatSession.flow = null;
  gemini = null;
  flow = null;
  facts = null;
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
