// The app's abilities, as tools Gemini can call from any message (function calling). Gemini decides
// what to look up or do from what the student means; the app checks every call and carries it out:
// - lookups the app answers here: search the societies, clubs and services; read a task's how-to
// - changes the app makes and confirms in a line with Undo (chat-do.js): the checklist, and what the
//   chat remembers
// - things the app shows under the reply: the GP or dentist finder, key contacts, Ask4Help, a
//   calendar card, an app page, a reminder to add, something to remember, their mentor, quick replies
// No Firebase here, so the checks run it in Node.

import { chatOptions } from '#lib/checkin/opener.js';
import { FINDER_LINES, HOW_TO, howToFor, talkFor, talkForStudent } from '#lib/checklist/how-to.js';
import { defaultTasks } from '#lib/checklist/tasks.js';
import { SUGGESTIONS, suggestionNamed } from '#lib/suggestions/catalogue.js';
import { shortlist } from '#lib/suggestions/shortlist.js';

/** At most this many results from a search, and cards under one reply. */
export const MAX_RESULTS = 8;
export const MAX_CARDS = 3;
/** At most this many quick replies under one message. */
export const MAX_QUICK = 3;

/** "One of their own" tasks: Gemini is never told their words (the app matches them itself). */
export const OWN_TASK = 'one of their own';
export const NOT_SURE = 'not sure';

/** The app pages the chat can show as a button. */
export const CHAT_PAGES = Object.freeze({
  'NHS guide': { label: 'NHS guide', href: '/nhs-guide' },
  'Arriving late': { label: 'Arriving late', href: '/late-arrivals' },
  'Need help now': { label: 'Need help now', href: '/need-help' },
  'What the chat knows about you': { label: 'What the chat knows about you', href: '/about-you' }
});

/** How each kind of suggestion is described to Gemini. */
const KIND_WORDS = Object.freeze({ society: "Students' Union society", club: 'Northumbria Sport club', service: 'NSU service' });

/** The standard tasks (the ones with a how-to), by id and title, as the checklist names them. */
const STANDARD_TITLES = Object.freeze(defaultTasks().filter((task) => talkFor(task.id)).map((task) => ({ id: task.id, title: task.title })));

/** What the GP finder and dentist search do, for Gemini to explain (the app's own words). */
export const FINDERS = FINDER_LINES;

/**
 * The tools Gemini is offered for this student, as function declarations. Mentor actions are offered
 * only when they fit (chatOptions in opener.js): finding one only without a mentor (and not a mentor
 * themselves), changing only with one.
 * @param {import('#lib/checkin/chat-turns.js').ChatFacts} facts
 */
export function chatTools(facts) {
  const options = chatOptions(facts);
  const mentorActions = [
    'show',
    ...(options.mentor !== 'no' ? ['find', 'offer'] : []),
    ...(options.hasMentor ? ['change'] : [])
  ];
  const tasks = [...STANDARD_TITLES.map((task) => task.title), OWN_TASK, NOT_SURE];
  /** @param {string} description @param {string[]} [values] */
  const string = (description, values) => ({ type: 'string', description, ...(values ? { enum: values } : {}) });
  /** @param {string} name @param {string} description @param {Record<string, object>} [properties] @param {string[]} [required] */
  const declare = (name, description, properties = {}, required = Object.keys(properties)) => ({
    name,
    description,
    parameters: { type: 'object', properties, required }
  });
  return [
    {
      functionDeclarations: [
        declare(
          'search_societies_clubs_services',
          "Looks up what the app has: the Students' Union's societies, Northumbria Sport's clubs and NSU's services (help and advice), on the Newcastle campus. Use it whenever they're after something to join or do, or help with something, before you name anything. Search for what they mean, in a few plain words (for \"can you not check if there's a gym society?\", search \"gym\").",
          { query: string('What to look for, in a few plain words') }
        ),
        declare(
          'how_to',
          "The app's own steps for one of the standard checklist tasks: what's needed first, where to go or how to do it online, what to take, what happens next and who to contact. Use it before explaining how to do one.",
          { task: string('The task', STANDARD_TITLES.map((task) => task.title)) }
        ),
        declare(
          'change_checklist',
          "Changes their checklist: tick a task (only when they've said they've done it), untick one, add one (a reminder is a task on their checklist), remove one (when they ask you to, or tell you they don't need it), or rename one of their own. The app checks it, makes it, and shows a line with Undo; it tells you what happened.",
          {
            change: string('What to do', ['tick', 'untick', 'add', 'remove', 'rename']),
            task: string(`Which task: one of the standard ones by its title, "${OWN_TASK}" for one they added themselves (you aren't told those; the app matches their words), or "${NOT_SURE}" (the app then asks which). For add, "${NOT_SURE}".`, tasks),
            new_title: string('For add: the new task, starting with a verb ("Open a bank account"). For rename: the new name. Otherwise empty.'),
            their_words: string("Their words, copied exactly from their messages, that show what they want: for a tick, where they say they've done it; for one of their own tasks, where they name it.")
          },
          ['change', 'task', 'their_words']
        ),
        declare('remember', 'Remembers something they asked you to remember, for later chats (they can see and delete it). Never health, money, worries, safety, other people or contact details.', {
          note: string('What to remember, short, in their words where you can')
        }),
        declare('forget', "Forgets something you remember for them, or everything if they ask.", {
          note: string('The note as you were told it, or "everything"')
        }),
        declare('offer_to_remember', "Shows a card asking whether to remember something useful they've mentioned but didn't ask you to remember (such as a plan). They tap to say yes. The card asks, so don't ask it yourself.", {
          note: string('What it would remember, short')
        }),
        declare('suggest_reminder', "Shows a card offering to add a task to their checklist that they didn't ask for: a specific one that would help with something they've said (never a vague one). They tap Add (the card asks, so don't ask it yourself). When they ask for one, use change_checklist instead.", {
          task: string('The task, starting with a verb')
        }),
        declare('show_finder', 'Shows the GP finder (surgeries near where they live) or the dentist finder (NHS dentists near where they live). They type their postcode into it or use their location: never ask for either yourself.', {
          which: string('Which one', ['gp', 'dentist'])
        }),
        declare('show_key_contacts', 'Shows the key contacts card: Campus Security, Ask4Help, 999 and 101, to call or save.'),
        declare('show_ask4help', "Shows Ask4Help, the university's student help service, when that's really the best next step."),
        declare('show_calendar', "Shows a card to put one specific thing in their own calendar (Outlook on the web, or a calendar file), such as a task from their checklist. The app keeps nothing. When they'd rather keep things in their own calendar (such as Outlook), offer it in words; show it when there's a specific thing to put in.", {
          title: string('The thing to put in, as the calendar entry is called (such as "Register with a GP")')
        }),
        declare('show_page', "Shows a button to one of the app's pages, when the page itself is what helps: the NHS guide when they ask how the NHS works or whether they pay to see a doctor (answer in one short sentence yourself, without prices or other figures: seeing a GP is free, but they'll still pay for some things, such as prescriptions, dental treatment and eye tests, and the guide has the details); Arriving late when an international student might arrive after their CAS deadline or after teaching has started (the app knows neither date, so never tell them they'll be fine or that they're late: the page says what to do and who to ask); Need help now when they might be in danger.", {
          page: string('Which page', Object.keys(CHAT_PAGES))
        }),
        declare(
          'mentor',
          `Their student mentor: "show" shows their mentor here (or that they haven't got one yet) whenever they ask about their mentor, rather than sending them to a page${mentorActions.includes('find') ? '; "find" starts the six short questions that find them one, here in the chat, when they ask for one (the app asks them, so never ask them yourself); "offer" shows a card offering that, when they might like one but didn\'t ask' : ''}${mentorActions.includes('change') ? '; "change" shows the form to ask the mentoring coordinator for a different mentor (only the coordinator sees why: never ask them why yourself)' : ''}.`,
          { action: string('What to do', mentorActions) }
        ),
        declare('suggest_replies', 'Shows up to three quick replies under your message, for a question with obvious short answers.', {
          replies: { type: 'array', items: { type: 'string' }, description: 'Up to three short replies, as they would say them' }
        })
      ]
    }
  ];
}

/**
 * The app's societies, clubs and services that fit what was asked: the app's own index (shortlist.js:
 * everyday words, names and categories) for the words Gemini searched, then name and description
 * words, then, for a kind ("sport clubs", "societies"), everything of that kind.
 * @param {string} query
 * @returns {{ name: string, what: string }[]}
 */
export function searchCatalogue(query) {
  // The kind they're after, if they said ("sport clubs", "any societies?", "help services"): those first.
  const kind = /\b(?:clubs?|teams?)\b/i.test(query) ? 'club' : /\bsociet/i.test(query) ? 'society' : /\bservices?\b|\badvice\b/i.test(query) ? 'service' : null;
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9&']+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'any', 'for', 'there', 'society', 'societies', 'club', 'clubs', 'team', 'teams', 'service', 'services', ...(kind === 'club' ? ['sport', 'sports'] : [])].includes(word));
  // A kind and nothing else ("sport clubs", "societies"): everything of that kind.
  if (kind && words.length === 0) return SUGGESTIONS.filter((item) => item.kind === kind).slice(0, 40).map(describe);
  /** @type {import('#lib/suggestions/catalogue.js').Suggestion[]} */
  const found = shortlist({ message: query }, MAX_RESULTS).map((item) => item.suggestion);
  if (found.length < MAX_RESULTS && words.length) {
    const scored = SUGGESTIONS.filter((item) => !found.includes(item))
      .map((item) => ({ item, score: words.filter((word) => `${item.name} ${item.about}`.toLowerCase().includes(word)).length }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    found.push(...scored.slice(0, MAX_RESULTS - found.length).map((entry) => entry.item));
  }
  const ordered = kind ? [...found.filter((item) => item.kind === kind), ...found.filter((item) => item.kind !== kind)] : found;
  return ordered.map(describe);
}

/** A suggestion as Gemini is told it: its name, and what it is. @param {import('#lib/suggestions/catalogue.js').Suggestion} item */
const describe = (item) => ({ name: item.name, what: `${KIND_WORDS[item.kind]}: ${item.about}` });

/**
 * A standard task's how-to, for Gemini to explain in its own words: the steps, and what's needed
 * first, where, what to take, what happens next and who to contact. The task's link goes under the
 * reply as a button (linkFor). It's the version their checklist page shows them: a home student isn't
 * told the visa-only lines (howToFor, talkForStudent), and an international student also hears about
 * the page that helps them (Arriving late, for enrolling).
 * @param {string} title
 * @param {import('#lib/students/student-type.js').StudentType | null} [studentType] what they said at sign-up
 * @returns {Record<string, unknown>}
 */
export function howTo(title, studentType = null) {
  const task = STANDARD_TITLES.find((item) => item.title === title);
  if (!task) return { error: 'Not one of the standard tasks.' };
  const talk = /** @type {import('#lib/checklist/how-to.js').Talk} */ (talkForStudent(task.id, studentType));
  const forThem = howToFor(task.id, studentType);
  return {
    task: task.title,
    steps: forThem?.steps ?? [],
    first: talk.first,
    where: talk.where,
    bring: talk.bring,
    after: talk.after,
    contact: talk.contact,
    ...(talk.needsFirst ? { needs_first: talk.needsFirst.task } : {}),
    ...(forThem?.pointer ? { also_for_them: `${forThem.pointer.label}: the app's Arriving late page (show_page), if it fits. The app doesn't know their CAS deadline or when teaching starts, so never say whether they're late or fine.` } : {}),
    shown_with_your_reply:
      talk.tool === 'gp-finder' ? 'the GP finder' : talk.tool === 'dentist-finder' ? 'the dentist finder' : talk.tool === 'contacts' ? 'the key contacts card' : linkFor(task.id) ? `a button: ${linkFor(task.id)?.label}` : 'nothing'
  };
}

/**
 * What the app shows with a task's how-to: the finder or contacts card for the tasks done there, or
 * the task's link (such as the Student Portal) as a button.
 * @param {string} id
 * @returns {import('#lib/suggestions/catalogue.js').ReplyLink | null}
 */
export function linkFor(id) {
  const tool = talkFor(id)?.tool;
  if (tool === 'gp-finder' || tool === 'dentist-finder' || tool === 'contacts' || tool === 'societies') return null;
  const link = HOW_TO[id]?.link;
  return link ? { label: link.label, href: link.href, external: /^https?:\/\//.test(link.href) } : null;
}

/** A standard task's id from its title, or null. @param {string} title */
export const standardTask = (title) => STANDARD_TITLES.find((task) => task.title === title)?.id ?? null;

/** A name as a pattern that only matches it as whole words. @param {string} name @param {boolean} anyCase */
const named = (name, anyCase) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, anyCase ? 'iu' : 'u');

/**
 * The cards for the societies, clubs and services a reply names, as whole words: any the app knows,
 * written as the app writes them, and those its searches found in any capitals ("sports news" is never
 * the Sport card). In the order they're named, at most MAX_CARDS.
 * @param {string} text the reply
 * @param {Set<string>} found every name a search has returned in this conversation
 * @returns {import('#lib/suggestions/catalogue.js').ReplyLink[]}
 */
export function cardsFor(text, found) {
  return SUGGESTIONS.map((item) => item.name)
    .map((name) => ({ name, at: text.search(named(name, found.has(name))) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at || b.name.length - a.name.length)
    // A name inside a longer one that's also named (Football in Women's Football) isn't a card of its own.
    .filter((entry, i, all) => !all.some((other, j) => j !== i && other.name.length > entry.name.length && other.at <= entry.at && other.at + other.name.length >= entry.at + entry.name.length))
    .map((entry) => suggestionNamed(entry.name)?.link)
    .filter((link) => link !== undefined && link !== null)
    .slice(0, MAX_CARDS);
}
