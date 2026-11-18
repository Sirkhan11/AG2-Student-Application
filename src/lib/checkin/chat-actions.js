// The cards for the chat's mentor actions, which Gemini asks for with its mentor tool (chat-tools.js,
// which only offers the ones that make sense at that moment): offering to find a mentor here (Start
// and Not now), their mentor, and the form to ask for a different one. The app shows the card and does
// the rest itself, and nothing starts or is saved until the student taps. Reminders and remembering
// something have their own cards (TaskSuggestionCard, RememberCard).
// No Firebase here, so the checks can use it in Node.

/**
 * One thing the chat can do: its id (from Gemini's mentor tool), and either what its offer card says
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

/** @param {string} id */
export const chatAction = (id) => CHAT_ACTIONS.find((action) => action.id === id) ?? null;
