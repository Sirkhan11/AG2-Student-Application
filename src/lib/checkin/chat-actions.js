// Things the check-in chat can do for a student right there in the chat, rather than sending them to a
// page. Gemini only offers one, by writing its marker in a reply. The app takes the marker out, shows a
// card, and does the rest itself (asking any questions), and nothing starts or is saved until the
// student taps. The chat's instructions are built from this list (chat-prompt.js), so each new action
// (changing mentor, the GP finder and so on, later) adds one entry here. No Firebase here, so the
// checks can use it in Node.

/**
 * One thing the chat can do: its id (what the app's card is for), a heading and the marker for the
 * chat's instructions, the rules for when and how Gemini offers it, and (for one started from the
 * offer card, ChatOfferCard.svelte) what that card says.
 * @typedef {{ id: string, title: string, marker: string, rules: string[], card?: { title: string, text: string } }} ChatAction
 */

/** @type {readonly ChatAction[]} */
export const CHAT_ACTIONS = Object.freeze([
  {
    id: 'task',
    title: 'Reminders for their checklist',
    marker: '{{task: Open a bank account}}',
    rules: [
      "Once in the conversation, at a natural point, ask whether there's anything they'd like reminding about while they settle in, and offer to add it to their checklist. A natural point is when you've finished helping with what they asked, or they've told you how they're settling in, and you aren't asking them anything else. Not while they're worried or upset. Ask this only once: if you've asked earlier in the conversation, don't ask again, whatever they said.",
      "If they name something, suggest one short task for it, written as {{task: Open a bank account}}: a few words starting with a verb, under 60 characters. The app shows it as a card they can add with one tap. Suggest one task at a time: if they name several, suggest the first and offer the next one after.",
      "Never say you've added a task or that you will: only they can, with the card's Add button.",
      "If it's already on their checklist (see what the app knows about them below), don't suggest it again: say it's already there and point them to their [[Checklist]]."
    ]
  },
  {
    id: 'mentor',
    title: 'Finding them a student mentor',
    marker: '{{mentor}}',
    rules: [
      'Offer it only when they ask for a mentor, ask for someone to help them settle in or organise their work, say yes to the mentor offer in your first messages, or talk about their mentor when they haven’t got one yet: write one short sentence saying you can find them one here, then {{mentor}}, for example "You haven’t got a mentor yet, but I can find you one here. {{mentor}}". The app then asks its own questions and does the matching.',
      "Don't bring it up otherwise: when they ask about something else (societies, sport, keeping fit, the NHS and so on), help with that, and never offer a mentor instead.",
      "Don't offer it if they already have a mentor, the coordinator is already finding them one, or they're a mentor themselves, and don't offer it again in this chat after they've said not now, unless they ask (see what the app knows about them below).",
      "Never ask them the matching questions, or what they want in a mentor, yourself."
    ],
    card: { title: 'Find a mentor here?', text: 'I’ll ask six short questions here in the chat. Nothing is saved until you choose Find my mentor.' }
  }
]);

/** @param {string} id */
export const chatAction = (id) => CHAT_ACTIONS.find((action) => action.id === id) ?? null;

/** An offer marker with nothing after the name, such as {{mentor}}. Reminders have their own: task-suggestions.js. */
const OFFER = /\{\{\s*([a-z][a-z-]*)\s*\}\}/gi;

/** The actions offered by a bare marker (not ones that carry words, like {{task: …}}). */
const BARE = new Set(CHAT_ACTIONS.filter((action) => !action.marker.includes(':')).map((action) => action.id));

/**
 * Takes the offer markers out of a reply: the text the student sees, and what was offered (the first
 * one: one offer at a time). Any other bare marker is just taken out, so the student never sees one.
 * Runs before tasksInReply, which takes out any half-written marker.
 * @param {string} reply
 * @returns {{ text: string, offers: string[] }}
 */
export function offersInReply(reply) {
  /** @type {string[]} */
  const offers = [];
  const text = reply
    .replace(OFFER, (_, id) => {
      const action = String(id).toLowerCase();
      if (offers.length === 0 && BARE.has(action)) offers.push(action);
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,!?])/g, '$1')
    .trim();
  return { text, offers };
}

/**
 * The "Things you can do in the chat" part of the chat's instructions, built from CHAT_ACTIONS.
 * @returns {string}
 */
export function chatActionsInstructions() {
  const actions = CHAT_ACTIONS.map((action) => `${action.title} (${action.marker}):\n${action.rules.map((rule) => `- ${rule}`).join('\n')}`);
  return [
    'Things you can do in the chat:',
    '- You only ever offer one of these, by writing its marker in your reply, after a short sentence for the student. The marker is what shows them the card: if you say you can do something here, its marker must be in that same reply. Nothing starts or is saved until they tap the card, and the app does the rest itself, asking any questions it needs.',
    "- Never ask the app's questions yourself, never collect the answers, and never say it's done or that it will be: they choose, and the app does it.",
    '- Offer one thing at a time, and never instead of helping with what they asked.',
    '',
    actions.join('\n\n')
  ].join('\n');
}
