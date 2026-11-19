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
// When a message could be an answer, it is one, or the student is asked (agent1.md A14): "I want to stop
// being so shy" and "go back to the gym" are answers. Stopping and starting again throw their answers
// away, so only the plain instruction ("stop", "start again") does it at once; asking in other words
// ("can I stop?", "can we start again?") gets a question first, with buttons. A message that suggests
// they may be at risk never gets here: the chat page answers it first (safety.js).
// No Firebase here, so the checks run it in Node.

/**
 * What a message means: their answer, or about the questions (asking what's saved, wanting the last
 * question again, starting again or stopping, plainly or asked in other words, a nudge such as
 * "please?", or an exclamation that isn't an answer), or a question for the chat, checked before it's kept.
 * @typedef {'answer' | 'about-saving' | 'redo' | 'restart' | 'ask-restart' | 'stop' | 'ask-stop' | 'nudge' | 'not-an-answer' | 'check'} ReplyKind
 */

/** Phones type curly apostrophes; spacing and capitals don't matter. @param {string} text */
const tidy = (text) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** Starts like a question to someone: "will…", "can…", "what…". */
const ASKING = /^(will|would|is|are|was|were|does|do|did|has|have|can|could|should|shall|may|might|who|what|when|where|why|how|which)\b/;

/** "Oh no", "oops", "sorry", "please" and the like, before or after the words that matter. */
const LEAD = String.raw`((oh no|oops|whoops|sorry|wait|ok|okay|please)[,!.]* )*`;
const TAIL = String.raw`( (now|please|then|here))*[.!?]*`;

/** The whole message is the plain instruction: "stop", "stop please", "stop the questions", "cancel". */
const STOP = new RegExp(`^${LEAD}(stop|cancel|quit|exit)( (it|this|that|the questions|asking))?${TAIL}$`);
/** The whole message asks to stop in other words: "can I stop?", "I want to stop". Asked first. */
const ASK_STOP = new RegExp(`^${LEAD}((can|could|may) (i|we)|i want to|i'd like to|i would like to|i wanna|let's|let me) (stop|cancel|quit|finish)( (it|this|the questions|asking))?${TAIL}$`);

/** Starting again, as the whole message: "start again", "start again?", "restart", "start over". */
const AGAIN = String.raw`(start again|start over|restart|begin again|start from the (start|beginning)|start the questions again)`;
const RESTART = new RegExp(`^${LEAD}${AGAIN}${TAIL}$`);
/** Asked in other words: "can we start again?", "I want to start over". Asked first. */
const ASK_RESTART = new RegExp(`^${LEAD}((can|could|may) (i|we)|i want to|i'd like to|i would like to|i wanna|let's|let me) ${AGAIN}${TAIL}$`);

/**
 * Wanting the last question again: the plain instruction as the whole message ("go back", "try
 * again"), or a request that ends the message ("…can I try again?"), so an answer that mentions going
 * back ("I go back home most weekends", "go back to the gym") stays an answer. It throws nothing away:
 * the question comes again, and what they'd answered stays until they answer it again.
 */
const REDO = [
  new RegExp(`^${LEAD}(go back|back|undo|redo|re-do|try again|go back (a|one) question|back (a|one) question|go back to the (last|previous) question)${TAIL}$`),
  new RegExp(`\\b(can|could|may) (i|we) (try (that |it |this )?again|redo( that| it)?|re-do( that| it)?|go back( (a|one) question| to the (last|previous) question)?|have (another|a) (go|try)( at that| at it)?|change (that|it|my( last)? answer|the last (one|answer)))${TAIL}$`),
  new RegExp(`^${LEAD}(i )?(didn'?t|did not) (mean (that|it)|answer (that |it |this )?(right|correctly|properly))${TAIL}$`),
  new RegExp(`^${LEAD}(wrong|bad) (answer|one)${TAIL}$`)
];

/**
 * Asking whether what they type is saved or kept, or who sees it: "will that be saved?", "is this
 * kept?", "who can see my answers?". Passive or about seeing, so "is it OK if I keep to myself?" and
 * "I'd like help saving money" don't count.
 */
const ABOUT_SAVING = [
  /\b(be|been|being|get|gets|is|are|was|were)( (it|this|that|these|they|those|my (answer|answers|message|reply)))? (saved|kept|stored|recorded|shared|seen|read)\b/,
  /\bwho (can |will |gets to |could )?(see|sees|read|reads)\b/,
  /\b(do|does|will|would) (you|it|the app|this|that) (save|keep|store|record|share)( (it|this|that|them|my answers?|my messages?|what i (type|write|say)))\b/
];

/** Nothing but a nudge: please, ok, hello, a question mark. */
const NUDGE = /^(please|pls|plz|go on|ok|okay|k|yes|yeah|yep|sure|hello|hi|hey|hiya|well|and|so|\?+|hm+|um+|erm+|uh+)[.!?]*$/;

/** Words that are only an exclamation, never an answer to any of the six ("ooo poop"). */
const EXCLAIM = /^(o+h*|a+h+|o+o+h*|oops|whoops|lol+|lmao|haha+|ha|hehe+|poo+p*|damn|dang|ugh+|meh|eh|wow|omg|ffs|bruh|yikes|blah)$/;

/**
 * What the student meant by a message during the questions.
 * @param {string} text what they typed
 * @returns {ReplyKind}
 */
export function understandReply(text) {
  const said = tidy(text);
  // Nothing typed: each step's own check says what's needed ("Please answer question 1.").
  if (!said) return 'answer';
  if (STOP.test(said)) return 'stop';
  if (ASK_STOP.test(said)) return 'ask-stop';
  if (RESTART.test(said)) return 'restart';
  if (ASK_RESTART.test(said)) return 'ask-restart';
  if (REDO.some((pattern) => pattern.test(said))) return 'redo';
  if (NUDGE.test(said)) return 'nudge';
  const words = said.replace(/[.!?,]+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length && words.every((word) => EXCLAIM.test(word))) return 'not-an-answer';
  const asking = ASKING.test(said) || said.endsWith('?');
  if (asking && ABOUT_SAVING.some((pattern) => pattern.test(said))) return 'about-saving';
  // A question for the chat rather than an answer ("what societies are there?"): checked with them.
  // An answer with a question mark in it ("Climbing? I think") is still an answer.
  if (ASKING.test(said) && said.endsWith('?')) return 'check';
  return 'answer';
}
