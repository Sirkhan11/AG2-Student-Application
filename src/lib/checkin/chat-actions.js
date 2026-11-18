// Things the check-in chat can do for a student right there in the chat, rather than sending them to a
// page. Gemini only proposes one, by choosing it as its reply's action (chat-prompt.js says when, and
// the app only allows the ones that make sense at that moment). The app shows a card and does the rest
// itself (asking any questions), and nothing starts or is saved until the student taps. Reminders and
// remembering something have their own cards (TaskSuggestionCard, RememberCard).
// No Firebase here, so the checks can use it in Node.

/**
 * One thing the chat can do: its id (the action Gemini chooses), and either what its offer card says
 * (for one started with Start, ChatOfferCard.svelte), or shows: 'card' for one whose card the page
 * shows straight away, as it's information or a form that only sends when they tap.
 * @typedef {{ id: string, card?: { title: string, text: string }, shows?: 'card' }} ChatAction
 */

/** @type {readonly ChatAction[]} */
export const CHAT_ACTIONS = Object.freeze([
  {
    id: 'mentor',
    card: { title: 'Find a mentor here?', text: 'I’ll ask six short questions here in the chat. Nothing is saved until you choose Find my mentor.' }
  },
  // Their mentor's name, how to get in touch and how often they asked to meet, read from their own
  // record by the card, so Gemini never sees them.
  { id: 'your-mentor', shows: 'card' },
  // The form goes only to the mentoring coordinator: never to the mentor, and never to Gemini.
  { id: 'change-mentor', shows: 'card' }
]);
// Going through the checklist (checklist and checklist-offer) has no card: the chat starts asking
// straight away, or offers it in one line with Yes and Not now (checklist-talk.js).

/** @param {string} id */
export const chatAction = (id) => CHAT_ACTIONS.find((action) => action.id === id) ?? null;
