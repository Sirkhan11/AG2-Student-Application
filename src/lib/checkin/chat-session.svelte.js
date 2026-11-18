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
 * service as a card with its details (see catalogue.js), anything else as a button (external ones
 * open in a new tab).
 * task is a checklist task the chat suggested, shown as a card with Add and No thanks; state says
 * what's happened to it (kept here, so it stays the same when they come back to the chat).
 * offer is one of the chat's own actions Gemini offered (chat-actions.js), shown as a card with Start
 * and Not now. note is something Gemini offered to remember (remember-notes.js), shown as a card with
 * Remember and Not now. appCard is a card the chat showed straight away (its own actions with
 * shows: 'card': their mentor, or asking for a different one). flow is a card from an action the app is
 * running in the chat (mentor-flow.js), such as the meeting choices or the answers to check. A link with
 * an action starts that action in the chat.
 * quick is the replies under the chat's question (open until one is used, or a newer message has its
 * own); tool is a card the app shows under a reply (the GP finder, a dentist search, the key
 * contacts); ask4help shows the Ask4Help card; calendar is a calendar card (Outlook on the web, or a
 * file) for something they'd rather keep in their own calendar.
 * undo is how to put back a change the chat made (a checklist change, or something remembered or
 * forgotten: chat-do.js), for the Undo button on the line confirming it (done once used). celebrate: the message
 * telling them they've just been matched, for confetti; cleared once it has played, so it never replays.
 * first: Gemini's first reply in this conversation, for a little sparkle.
 * @typedef {{ role: 'assistant' | 'user', text: string, kind?: 'safety' | 'error' | 'unavailable',
 *   links?: { label: string, href: string, external?: boolean, kind?: 'society' | 'club' | 'service',
 *     nsuId?: number, slug?: string, serviceId?: string, action?: string }[],
 *   task?: SuggestedTask, offer?: Offer, note?: OfferedNote, appCard?: 'your-mentor' | 'change-mentor',
 *   flow?: import('#lib/checkin/mentor-flow.js').FlowCard & { id: number },
 *   quick?: { options: { label: string, value: string }[], open: boolean },
 *   tool?: 'gp-finder' | 'dentist-finder' | 'contacts', ask4help?: boolean,
 *   undo?: { change: import('#lib/checkin/chat-do.js').Undo, done: boolean },
 *   calendar?: { title: string }, celebrate?: boolean, first?: boolean }} Message
 */

/** @typedef {{ action: string, state: 'offered' | 'started' | 'declined' }} Offer */

/**
 * A note the chat offered to remember, and what's happened to it: 'saved', not now ('declined'),
 * already remembered ('exists'), no room ('full'), or never remembered ('refused', see screenNote).
 * @typedef {{ text: string, state: 'offered' | 'saved' | 'declined' | 'exists' | 'full' | 'refused' }} OfferedNote
 */

/**
 * @typedef {{ title: string, state: 'offered' | 'added' | 'queued' | 'declined' | 'exists' | 'full', existing?: string }} SuggestedTask
 */

/**
 * @typedef {{ uid: string | null, messages: Message[], draft: string, waiting: boolean,
 *   started: boolean, unavailable: boolean, conversation: number, replied: boolean,
 *   flow: import('#lib/checkin/mentor-flow.js').FlowState | null }} ChatSession
 */

/**
 * - uid: whose conversation it is, or null before one starts
 * - draft: what they've typed but not sent yet
 * - waiting: true while waiting for a reply, so only one message is sent at a time
 * - started: true once the first messages are in, so coming back shows them instead of starting again
 * - unavailable: true once Gemini has said its credit has run out, so the message box is switched off
 * - conversation: goes up each time it's cleared, so a reply for a conversation that's gone is dropped
 * - replied: true once Gemini's first reply has shown, which gets a little sparkle
 * - flow: where an action the app is running in the chat is (finding a mentor), or null
 */
export const chatSession = $state(
  /** @type {ChatSession} */ ({ uid: null, messages: [], draft: '', waiting: false, started: false, unavailable: false, conversation: 0, replied: false, flow: null })
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
 * The action the app runs in the chat (finding a mentor), made the first time it's started in this
 * conversation.
 * @type {{ mentor?: ReturnType<typeof import('#lib/checkin/mentor-flow.js').createMentorFlow> }}
 */
let flows = {};
/** @type {'mentor' | null} */
let running = null;

/** The action running now (or last run), whose cards and Stop the page uses. */
export const chatFlow = () => (running ? flows[running] ?? null : null);

/** @template {'mentor'} K @param {K} kind @returns {(typeof flows)[K] | null} */
export const chatFlowFor = (kind) => flows[kind] ?? null;

/**
 * Keeps an action for this conversation, and makes it the one running.
 * @template {'mentor'} K @param {K} kind @param {NonNullable<(typeof flows)[K]>} flow
 */
export function setChatFlow(kind, flow) {
  flows[kind] = flow;
  running = kind;
}

/** Makes an action kept earlier the one running again. @param {'mentor'} kind */
export function runChatFlow(kind) {
  running = kind;
}

/**
 * The changes the chat makes for Gemini's tools (chat-do.js), with the page's stores. Made the first
 * time they're needed in this conversation. Not $state: the page never shows them.
 * @type {ReturnType<typeof import('#lib/checkin/chat-do.js').createChatDo> | null}
 */
let changes = null;

export const chatChanges = () => changes;

/** @param {ReturnType<typeof import('#lib/checkin/chat-do.js').createChatDo>} next */
export function setChatChanges(next) {
  changes = next;
}

/**
 * What Gemini was told about the student (describeForGemini's input), kept so it can be told again
 * when that changes in the chat, such as a mentor found here. Not $state: the page never shows it.
 * @type {Parameters<typeof import('#lib/checkin/opener.js').describeForGemini>[0] | null}
 */
let facts = null;

/** What the app knows now: the running chat's (it keeps the checklist and notes up to date itself). */
export const chatFacts = () => gemini?.facts() ?? facts;

/** @param {Parameters<typeof import('#lib/checkin/opener.js').describeForGemini>[0] | null} next */
export function setChatFacts(next) {
  facts = next;
}

/**
 * Tells Gemini what the app knows now, keeping the conversation so far (see retell in chat-turns.js):
 * after a mentor is found in the chat, or when the student's notes change (one saved from a card in
 * the chat, or deleted on the "What the chat knows about you" page). Does nothing if no chat is
 * running in this tab: the next one is told when it starts.
 * @param {Partial<Parameters<typeof import('#lib/checkin/opener.js').describeForGemini>[0]>} change
 */
export function tellGemini(change) {
  const now = chatFacts();
  if (!now) return;
  facts = { ...now, ...change };
  gemini?.retell(facts);
}

/**
 * The student's notes have changed: a running chat is told.
 * @param {string[]} notes their words, oldest first
 */
export function notesChanged(notes) {
  const now = chatFacts();
  if (now) tellGemini({ profile: { ...now.profile, notes } });
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
  chatSession.replied = false;
  chatSession.flow = null;
  gemini = null;
  flows = {};
  running = null;
  facts = null;
  changes = null;
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
