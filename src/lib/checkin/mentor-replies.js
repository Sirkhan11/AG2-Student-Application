// What a student's message means while the chat asks the six mentor questions (mentor-flow.js): most
// messages, however short, are their answer, and a few are about the questions themselves. Worked out
// here on the phone, without Gemini, so nothing typed during the questions reaches Gemini until Find my
// mentor, as the note before them says (ANSWERS_NOTE), and it costs no requests.
// From Thomas's own test on 18 November (agent1.md A13), where each of these was kept as an answer:
//   "will that last message be saved as a answer"     -> about-saving (say how, then the question again)
//   "oh no i didnt answer correctly can i try again?"  -> redo (back to the question they answered last)
//   "ooo poop"                                          -> not-an-answer (not kept)
//   "start again?"                                      -> restart (from question 1, nothing kept)
//   "please?"                                           -> nudge (the question again)
// And a question for the chat ("what societies are there?") is checked with them before it's kept. A
// message that suggests they may be at risk never gets here: the chat page answers it first (safety.js).
// No Firebase here, so the checks run it in Node.

/**
 * What a message means: their answer, or about the questions (asking what's saved, wanting the last
 * question again, starting again, stopping, a nudge such as "please?", or an exclamation that isn't an
 * answer), or a question for the chat, which is checked with them before it's kept.
 * @typedef {'answer' | 'about-saving' | 'redo' | 'restart' | 'stop' | 'nudge' | 'not-an-answer' | 'check'} ReplyKind
 */

/** Phones type curly apostrophes; spacing and capitals don't matter. @param {string} text */
const tidy = (text) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** Starts like a question to someone: "will…", "can…", "what…". */
const ASKING = /^(will|would|is|are|was|were|does|do|did|has|have|can|could|should|shall|may|might|who|what|when|where|why|how|which)\b/;

/** Stopping: the word on its own, or asking to. */
const STOP = [/^(stop|cancel|quit|exit)( (it|this|that|now|please|the questions|asking))*[.!?]*$/, /\b(i want to|i'd like to|i would like to|can i|can we|please) (stop|cancel|quit)\b/];

/** Starting the questions again. */
const RESTART = /\b(start (again|over|from the (start|beginning))|restart|begin again|start the questions again|do (it|them|these|this) all again)\b/;

/**
 * Wanting the last question again: asked about their own answer, so a real answer that happens to
 * say "again" ("I'd like to try climbing again") stays an answer.
 */
const REDO = [
  /\b(can|could|may) i (try|have (a go|another go|another try)|answer|do|redo|change)\b.*\b(again|that|it|answer|one)\b/,
  /\b(let me|i'll|i want to|i'd like to) (try|answer|redo|change) (that|it|this|my answer|the last one)\b/,
  /\b(try|answer|do) (that|it|this|the last one) again\b/,
  /^(can i |could i )?(try again|redo( that| it)?|re-do( that| it)?|go back|undo( that)?)[.!?]*$/,
  /\b(didn'?t|did not|don'?t|do not) (mean (that|it|to)|answer (that |it |this )?(right|correctly|properly))\b/,
  /\b(wrong|bad|silly) (answer|one)\b/,
  /\b(go back|previous question|last question|change my (last )?answer|change that answer)\b/
];

/** Asking whether what they type is saved or kept, or who sees it, about the questions themselves. */
const SAVED = /\b(saved?|saving|kept|keep|stored?|recorded?|sent|shared|see|sees|seen|read|reads)\b/;
const ABOUT_THIS = /\b(this|that|these|it|them|my (answer|answers|message|reply)|last message|that message|an answer|a answer|the answers?|as (a|an|my) answer)\b/;

/** Nothing but a nudge: please, ok, hello, a question mark. */
const NUDGE = /^(please|pls|plz|go on|ok|okay|k|yes|yeah|yep|sure|hello|hi|hey|hiya|well|and|so|\?+|hm+|um+|erm+|uh+)[.!?]*$/;

/** Words that are only an exclamation, never an answer to any of the six ("ooo poop"). */
const EXCLAIM = /^(o+h*|a+h+|o+o+h*|oops|whoops|oh no|uh oh|lol+|lmao|haha+|ha|hehe+|poo+p*|damn|dang|ugh+|meh|eh|wow|omg|ffs|bruh|yikes|blah)$/;

/**
 * What the student meant by a message during the questions.
 * @param {string} text what they typed
 * @returns {ReplyKind}
 */
export function understandReply(text) {
  const said = tidy(text);
  const words = said.replace(/[.!?,]+/g, ' ').trim().split(' ').filter(Boolean);
  // Nothing typed: each step's own check says what's needed ("Please answer question 1.").
  if (!said) return 'answer';
  if (STOP.some((pattern) => pattern.test(said))) return 'stop';
  if (NUDGE.test(said)) return 'nudge';
  if (words.length && words.every((word) => EXCLAIM.test(word))) return 'not-an-answer';
  const asking = ASKING.test(said) || said.endsWith('?');
  // About the questions themselves: only when it's short, or asked, so a real answer that mentions
  // starting again or saving ("help saving money") stays an answer.
  const aboutThem = asking || words.length <= 6;
  if (aboutThem && RESTART.test(said)) return 'restart';
  if (aboutThem && REDO.some((pattern) => pattern.test(said))) return 'redo';
  if (asking && SAVED.test(said) && ABOUT_THIS.test(said)) return 'about-saving';
  // A question for the chat rather than an answer ("what societies are there?"): checked with them.
  // An answer with a question mark in it ("Climbing? I think") is still an answer.
  if (ASKING.test(said) && said.endsWith('?')) return 'check';
  return 'answer';
}
