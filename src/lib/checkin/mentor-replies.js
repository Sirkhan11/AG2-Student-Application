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
 * "please?", an exclamation that isn't an answer, or a question about the questions, answered there
 * and then: faq), or a question for the chat, checked before it's kept.
 * @typedef {'answer' | 'about-saving' | 'redo' | 'restart' | 'ask-restart' | 'stop' | 'ask-stop' | 'nudge' | 'not-an-answer' | 'faq' | 'check'} ReplyKind
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

/**
 * Questions about the questions themselves, answered there and then, with or without a question mark
 * ("how many questions are there", "what is a mentor"; agent1.md A15). Each starts the message, so a
 * real answer that starts the same way ("How about a bit of both", "What I enjoy most is football")
 * isn't one.
 * @typedef {'how-many' | 'what-next' | 'optional' | 'mentor' | 'why' | 'repeat'} Faq
 * @type {{ topic: Faq, pattern: RegExp }[]}
 */
const FAQ = [
  { topic: 'how-many', pattern: /^(how many (questions|more|are (there|left))|how long (will|does|is|'s|would) (this|it|that)|how much (more|longer)|how many (have i|do i|left))/ },
  { topic: 'what-next', pattern: /^(what happens (next|after|then|now|after this)|what('s| is) next|what comes next|then what)/ },
  { topic: 'optional', pattern: /^(do i (have|need) to( (answer|do|reply))?|is (this|it|that) (compulsory|mandatory|required|optional)|are (these|they|the questions) (compulsory|mandatory|required|optional)|must i|can i skip)/ },
  { topic: 'mentor', pattern: /^(what('s| is) a mentor|what (do|does) (a )?mentors? do|who (are|is|will be) (the |my )?mentors?|what('s| is) (the |a )?mentor for)/ },
  { topic: 'why', pattern: /^(what do you mean|what does (that|this|it) mean|why (do|does|are|is|would|should) (you|it|this|that|i)|why (these|this) questions?|what('s| is) (this|that|it) for)/ },
  { topic: 'repeat', pattern: /^((can|could|would) you )?(repeat|say) (that|it|the question)( again)?|^what was the question|^(sorry|pardon)[,.!?]*( what)?[.!?]*$/ }
];

/**
 * Starts like a question to someone, with no question mark ("is this ok", "can you help"): checked with
 * them, as they may not mean it as their answer. The word after the question word has to be one a
 * question needs ("is this", "do you", "what does"), so "Is hard to say but friends", "Do sports mostly",
 * "When I have time I like hiking", "Where I can, with others", "Who knows, maybe climbing" and "Can't
 * say really" stay answers.
 */
const QUESTION = /^((how|what|why|when|where|who|which)( (many|much|long|often|exactly))? (do|does|did|is|are|was|were|will|would|can|could|should|shall|have|has|happens|happened|am)\b|(what|how|who|where|why)'s\b|(can|could|would|will) (you|we)\b|(do|does|did) (i|you|we|it|this|that|these)\b|(is|are|was|were) (this|it|that|these|those|there|you)\b|(should|shall|must) (i|we)\b)/;

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
  if (faqTopic(text)) return 'faq';
  // A question for the chat rather than an answer ("what societies are there?", "is this ok"): checked
  // with them. An answer with a question mark in it ("Climbing? I think") is still an answer.
  if ((ASKING.test(said) && said.endsWith('?')) || QUESTION.test(said)) return 'check';
  return 'answer';
}

/**
 * Which question about the questions this is ("how many questions are there"), or null.
 * @param {string} text
 * @returns {Faq | null}
 */
export function faqTopic(text) {
  const said = tidy(text).replace(/[?!.]+$/, '');
  return FAQ.find((faq) => faq.pattern.test(said))?.topic ?? null;
}

/** The words that, on their own or together, make a reply to one of the cards that ask first. */
const CARD_WORDS = {
  yes: ['yes please', 'yes i do', 'yes i would', 'of course', 'go ahead', 'go on', 'do it', 'please do', 'i do', 'i would', "i'd like that", "that's right", 'that is right', 'yes', 'yeah', 'yea', 'yep', 'yup', 'ya', 'aye', 'sure', 'definitely', 'absolutely', 'please', 'correct'],
  no: ['no thank you', 'no thanks', 'not yet', 'not now', 'not really', 'actually no', 'no actually', 'never mind', 'nevermind', "i don't", 'i do not', "don't", 'no', 'nope', 'nah', 'naw'],
  unsure: ['i guess', 'not sure', "i don't know", 'all right', 'alright', 'okay', 'ok', 'k', 'fine', 'maybe', 'whatever', 'dunno', 'idk', 'hmm', 'hm', 'um', 'erm', 'eh', 'meh'],
  // Words that only go with the others ("yes thanks", "go on then", "actually no").
  filler: ['thank you', 'thanks', 'then', 'actually', 'cheers', 'mate']
};
/** Each card's own words: its button, and what people say for it. "Carry on" is a no to stopping or starting again, but could be either to "Is that your answer?" */
const CARD_OWN = {
  stop: { yes: ['stop the questions', 'stop now', 'stop it', 'stop please', 'stop'], no: ["let's carry on", 'carry on', 'keep going', 'keep asking', 'continue'], unsure: [] },
  restart: { yes: ['start from the beginning', 'start again', 'start over', 'restart'], no: ["let's carry on", 'carry on', 'keep going', 'continue'], unsure: [] },
  answer: { yes: ['keep it as my answer', "that's my answer", "it's my answer", 'keep it', 'keep that', 'it is'], no: ['let me answer again', 'answer again', 'not my answer', "it's not", 'it is not'], unsure: ['carry on', 'keep going'] }
};

/**
 * A typed reply to one of the cards that ask first (agent1.md A15): "yes please" and "yeah go on" are
 * a yes, "nah" and "no carry on" a no, however worded, and never kept as an answer. Unsure when it could
 * be either ("ok", or yes and no together), so the card stays and asks again; null when it isn't a reply
 * to the card at all ("A long walk on Sunday"), which is then understood as usual.
 * @param {string} text
 * @param {'answer' | 'stop' | 'restart'} card
 * @returns {'yes' | 'no' | 'unsure' | null}
 */
export function cardReply(text, card) {
  let rest = tidy(text).replace(/[,.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!rest) return null;
  const own = CARD_OWN[card];
  /** @type {[string, string][]} */
  const phrases = [
    ...own.yes.map((phrase) => /** @type {[string, string]} */ ([phrase, 'yes'])), ...own.no.map((phrase) => /** @type {[string, string]} */ ([phrase, 'no'])), ...own.unsure.map((phrase) => /** @type {[string, string]} */ ([phrase, 'unsure'])),
    ...CARD_WORDS.yes.map((phrase) => /** @type {[string, string]} */ ([phrase, 'yes'])), ...CARD_WORDS.no.map((phrase) => /** @type {[string, string]} */ ([phrase, 'no'])),
    ...CARD_WORDS.unsure.map((phrase) => /** @type {[string, string]} */ ([phrase, 'unsure'])), ...CARD_WORDS.filler.map((phrase) => /** @type {[string, string]} */ ([phrase, 'filler']))
  ].sort((a, b) => b[0].length - a[0].length);
  const found = new Set();
  while (rest) {
    const match = phrases.find(([phrase]) => rest === phrase || rest.startsWith(`${phrase} `));
    if (!match) return null;
    found.add(match[1]);
    rest = rest.slice(match[0].length).trim();
  }
  if (found.has('yes') && found.has('no')) return 'unsure';
  if (found.has('yes')) return 'yes';
  if (found.has('no')) return 'no';
  return 'unsure';
}
