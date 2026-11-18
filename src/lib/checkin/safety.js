// The check-in chat's first safety layer, checked in the app before anything is sent to Gemini.
// If a message suggests someone may be at risk, the chat shows SAFETY_MESSAGE straight away, and the
// message is NOT sent to Gemini: the reply doesn't depend on the AI, and the most sensitive messages
// never reach Google. Nothing is reported to anyone; the student decides who to tell.
// No Firebase here, so scripts/check-checkin.mjs can test it in Node.
//
// Trade-off: a phrase list misses things people say in other ways (Gemini's instructions are the
// second layer), and it sometimes matches when someone isn't at risk. Showing support numbers to
// someone who didn't need them costs far less than missing someone who did.

/** Phrases that suggest someone may be at risk. Matched without caring about capitals. */
const CRISIS_PATTERNS = [
  /\bsuicid/,
  // Not "kill me": "this essay is killing me" is everyday talk.
  /\bkill(ing)? myself\b/,
  /\bend(ing)? (my life|it all)\b/,
  /\bself[- ]?harm/,
  /\b(hurt|hurting|harm|harming|cut|cutting) myself\b/,
  /\boverdos/,
  /\bwant(ed)? to die\b/,
  /\b(don't|do not) want to (live|be alive|be here|wake up)\b/,
  /\bno (point|reason) (in )?(living|going on)\b/,
  /\bcan't go on\b/,
  /\b(abused|abusing me|assaulted|raped)\b/,
  /\b(don't|do not|not) feel safe\b/,
  // Not "in danger of failing", which students say about deadlines.
  /\bin danger\b(?! of)/
];

/**
 * What the chat shows instead of an AI reply. The last line points to the Need help now page, which
 * has all three numbers and Shout's text line (src/lib/need-help/urgent.js): keep the two in step.
 */
export const SAFETY_MESSAGE =
  'I’m really sorry you’re going through this, and you don’t have to deal with it on your own. ' +
  'If you’re in danger or might act on these thoughts, call 999 now. For urgent help that isn’t an ' +
  'emergency, call NHS 111. You can talk to Samaritans any time, for free, on 116 123. ' +
  'The Need help now page has these numbers too, and Shout’s free text line if you’d rather text.';

/**
 * True if the message suggests the student may be at risk.
 * @param {string} text
 */
export function isCrisis(text) {
  // Phones often type curly apostrophes (don’t), so make them straight before matching.
  const normalised = text.toLowerCase().replace(/[‘’]/g, "'");
  return CRISIS_PATTERNS.some((pattern) => pattern.test(normalised));
}

/**
 * True if any of these, typed by the student, suggests they may be at risk. For the boxes whose words
 * go on to Gemini or a person (the mentor questions, mentor sign-up and the rest), checked before
 * anything is sent: one that does gets SAFETY_MESSAGE, and nothing is sent (agent1.md A13).
 * @param {...(string | null | undefined)} texts
 */
export const crisisIn = (...texts) => texts.some((text) => typeof text === 'string' && isCrisis(text));

/** The error code for something typed that suggests they may be at risk, so nothing was sent (mentor sign-up). */
export const AT_RISK = 'safety/at-risk';

/**
 * Words that suggest someone is worried or upset (short of a crisis): straight after finding a mentor,
 * the chat then says nothing rather than suggest things (afterMatch in chat-turns.js). Erring on the
 * side of quiet: a message that isn't sent costs nothing.
 */
const WORRIED = [
  /\b(worr|stress|anxious|anxiety|lonely|homesick|upset|scared|afraid|panick|overwhelm|nervous|miserable|unhappy|struggl|crying|grief|griev)/,
  /\bfeel(ing|s)? (really |so |very |quite |a bit |pretty )?(down|low|alone|awful|horrible|terrible|rubbish|sad|lost|isolated)\b/,
  /\b(horrible|awful|terrible|rough|hard|bad|tough) (week|day|time|few days)\b/
];

/**
 * True if the message suggests the student is worried or upset.
 * @param {string} text
 */
export function seemsWorried(text) {
  const normalised = text.toLowerCase().replace(/[‘’]/g, "'");
  return isCrisis(text) || WORRIED.some((pattern) => pattern.test(normalised));
}
