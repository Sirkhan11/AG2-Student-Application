// How to do each standard checklist task: two to four short steps, a link to act on, and the
// official pages the steps are drafted from (checked on 17 November 2026; the enrolment steps are
// the ones the project lead gave, which these pages back up). The checklist page shows them under
// each task, and the check-in chat can walk a student through them. Every task, standard or their
// own, also has "Stuck? Contact Ask4Help" (ASK4HELP). check-checklist-how-to.mjs checks them, and
// with --links that every link and source still answers. No Firebase here, so the checks run it in Node.

/** @typedef {{ label: string, href: string }} Link */
/**
 * steps: what to do, in order; link: where to do it (a page in the app, or an outside page);
 * sources: the official pages the steps come from; chat: something the chat itself can do for it,
 * as a button that asks it (going through the checklist in the chat, checklist-flow.js); do: the
 * screen in the app that gets the task done, as a short button on the task itself on the checklist
 * page (only tasks with such a screen have one; the rest keep "How to").
 * @typedef {{ steps: string[], link: Link, sources: Link[], chat?: { label: string, ask: string }, do?: Link }} HowTo
 */

/**
 * Ask4Help, the university's student help service: Ask4Help Online, on the Student Portal, and its
 * phone number, from Northumbria's counselling and mental health FAQs ("you can contact Ask4Help
 * by telephoning 0191 227 4646"), as on the Need help page.
 */
export const ASK4HELP = Object.freeze({
  online: { label: 'Ask4Help Online', href: 'https://myportal.northumbria.ac.uk/Help-and-support' },
  phone: '0191 227 4646',
  tel: 'tel:+441912274646'
});

/** The Student Portal, where students enrol, upload their photo and find Ask4Help Online. */
const STUDENT_PORTAL = { label: 'Open the Student Portal', href: 'https://myportal.northumbria.ac.uk/' };

/** The official pages the steps come from. */
export const SOURCES = Object.freeze({
  enrolment: { label: 'Northumbria University: Enrolment', href: 'https://www.northumbria.ac.uk/about-us/university-services/student-library-and-academic-services/registry-records-and-returns/enrolment' },
  visaEnrolment: { label: 'Northumbria University: Enrolment for students needing a UK student visa', href: 'https://www.northumbria.ac.uk/study-at-northumbria/immigration/enrolment/' },
  smartcards: { label: 'Northumbria University: Student Smartcards', href: 'https://www.northumbria.ac.uk/about-us/university-services/student-library-and-academic-services/registry-records-and-returns/student-smartcards/' },
  registerGp: { label: 'NHS: Register with a GP surgery', href: 'https://www.nhs.uk/nhs-services/gps/how-to-register-with-a-gp-surgery/' },
  northumbriaGp: { label: 'Northumbria University: Registering with a doctor', href: 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/international-student-support/registering-with-a-doctor/' },
  dentist: { label: 'NHS: How to find an NHS dentist', href: 'https://www.nhs.uk/nhs-services/dentists/how-to-find-an-nhs-dentist/' },
  society: { label: 'Northumbria Students’ Union: a society’s page (Salsa and Bachata)', href: 'https://mynsu.co.uk/activities/view/91' },
  associate: { label: 'Northumbria Students’ Union: Associate Members', href: 'https://mynsu.co.uk/societies/associate-members' },
  security: { label: 'Northumbria University: Security Service', href: 'https://www.northumbria.ac.uk/about-us/facilities-services/safety-on-campus/security-service/' },
  safety: { label: 'Northumbria University: Student Safety and Wellbeing', href: 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/welfare-and-health-support/student-safety-and-wellbeing/' },
  ask4HelpPhone: { label: 'Northumbria University: counselling and mental health FAQs', href: 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/frequently-asked-questions/' }
});

/**
 * Each standard task's how-to, by its id in DEFAULT_TASKS (tasks.js). What each step rests on:
 * - enrol: the Right to Study check comes first for students needing UK immigration permission, and
 *   "You cannot enrol at the University until the Right to Study check is complete"; log on to the
 *   Student Portal and select "Enrol" from the main menu, then follow the on-screen steps, with "a
 *   passport-style photograph ready to upload"; "a confirmation email to both your University and
 *   personal email addresses"; the "Understanding the Enrolment Process" article, "Step-by-step
 *   guidance in your Student Portal" (visaEnrolment, enrolment).
 * - gp: "Please register as soon as possible. Do not wait until you are unwell" (northumbriaGp);
 *   "Most people will need to register near where they live"; online, the form "takes about 15
 *   minutes", or a form at the surgery; free; "You do not need ID, proof of address or proof of
 *   immigration status"; you're told "usually within 5 days" (registerGp).
 * - student-id: the Smartcard is the university ID card; "ready two working days after you enrol and
 *   upload your photograph" (asked at enrolment, or Upload Photo in the Student Portal); collected
 *   from the campus where the programme is taught, with times and places in the Ask4Help Online
 *   article "Collecting your Student Smartcard from Campus"; a passport, photographic driving licence
 *   or PASS card, and "You must bring a physical copy of your id" (smartcards).
 * - society: the app's Societies page lists them, with memberships and a link to join; a society's
 *   NSU page says "Select a membership type to join our society", with Student and Associate
 *   memberships to add to the basket (society); associate membership is for alumni, staff and
 *   students at other institutions (associate).
 * - dentist: "Find an NHS dentist near you"; "Ask for an NHS appointment", as some practices offer
 *   private ones too; "You may be asked to join a waiting list"; "Most adults need to pay for NHS
 *   dental appointments"; if you can't find one, your local integrated care board "may be able to
 *   tell you where you can get a local dental appointment" (dentist).
 * - contacts: Campus Security, "3200 (0191 227 3200)" for emergencies only and "3999 (0191 227
 *   3999)" for general enquiries, staffed 24 hours (security); 999 for police, ambulance and fire,
 *   and 101 for a non-emergency police response (safety); Ask4Help on 0191 227 4646 (ask4HelpPhone).
 * @type {Readonly<Record<string, HowTo>>}
 */
export const HOW_TO = Object.freeze({
  enrol: {
    steps: [
      'If you need a UK student visa, do your Right to Study check first: you can’t enrol until it’s complete.',
      'Log in to the Student Portal, choose Enrol from the main menu and follow the steps. Have a passport-style photo ready to upload.',
      'Once you’ve enrolled, a confirmation email goes to your university and personal email addresses.',
      'There’s step-by-step guidance in “Understanding the enrolment process” in Ask4Help Online, on the Student Portal.'
    ],
    link: STUDENT_PORTAL,
    sources: [SOURCES.visaEnrolment, SOURCES.enrolment]
  },
  gp: {
    steps: [
      'Register as soon as you can: don’t wait until you’re unwell.',
      'Find a surgery near where you live. The GP Finder here shows the ones near you.',
      'Register online if the surgery offers it (it takes about 15 minutes), or fill in a form at the surgery. It’s free, and you don’t need ID or proof of address.',
      'The surgery should tell you when you’re registered, usually within 5 days.'
    ],
    link: { label: 'Find a GP', href: '/gp-finder' },
    do: { label: 'Find a GP', href: '/gp-finder' },
    sources: [SOURCES.registerGp, SOURCES.northumbriaGp]
  },
  'student-id': {
    steps: [
      'Your student ID is your Smartcard. Enrol, and upload a passport-style photo (you’re asked when you enrol, or use Upload Photo in the Student Portal).',
      'It’s ready two working days later. Collect it from the campus where your course is taught: “Collecting your Student Smartcard from Campus” in Ask4Help Online says when and where.',
      'Take physical photo ID: a passport, photo driving licence or PASS card. A copy on your phone won’t do.'
    ],
    link: STUDENT_PORTAL,
    sources: [SOURCES.smartcards]
  },
  society: {
    steps: [
      'Browse the societies here by campus and category.',
      'Open one to see what it does, its membership prices and how to get in touch.',
      'To join, go to its page on the Students’ Union website, choose the Student membership and add it to your basket. (Associate membership is for alumni, staff and students elsewhere.)'
    ],
    link: { label: 'Browse societies', href: '/societies' },
    do: { label: 'Browse', href: '/societies' },
    chat: { label: 'Suggest some for me', ask: 'Could you suggest a society that would suit me?' },
    sources: [SOURCES.society, SOURCES.associate]
  },
  dentist: {
    steps: [
      'Find a dentist near you with NHS Find a dentist.',
      'Contact the practice and ask for an NHS appointment, as some also see private patients. You may be asked to join a waiting list.',
      'Most adults pay for NHS dental appointments: the NHS Guide here explains the charges.',
      'If you can’t find one, your local integrated care board (ICB), which runs dental services in your area, may be able to tell you where to get an appointment.'
    ],
    link: { label: 'NHS Find a dentist', href: 'https://www.nhs.uk/service-search/find-a-dentist/' },
    do: { label: 'Find one', href: '/gp-finder?tab=dentist' },
    sources: [SOURCES.dentist]
  },
  contacts: {
    steps: [
      'Save Campus Security: 0191 227 3200 for emergencies on campus (it’s staffed 24 hours) and 0191 227 3999 for anything else.',
      'Save Ask4Help, the university’s student help service: 0191 227 4646.',
      'For police, ambulance or fire in an emergency, call 999. For the police when it isn’t an emergency, call 101.'
    ],
    link: { label: 'Need help now', href: '/need-help' },
    do: { label: 'See them', href: '/need-help' },
    sources: [SOURCES.security, SOURCES.safety, SOURCES.ask4HelpPhone]
  }
});

/**
 * Steps that only apply to students who need a UK student visa, by task. A home student (what they
 * said at sign-up: student-type.js) doesn't see them; an international student, or one who hasn't said,
 * does. Each must be one of that task's steps: check-sign-up.mjs checks.
 */
export const VISA_ONLY_STEPS = Object.freeze({ enrol: Object.freeze([HOW_TO.enrol.steps[0]]) });

/**
 * A page in the app that helps international students with a task, by task: Arriving late, for the CAS
 * deadline and catching up, which only applies to students on a visa. The app can't tell whether anyone
 * is late (it doesn't know the deadline), so it points to the guide rather than deciding.
 * @type {Readonly<Record<string, Link>>}
 */
export const INTERNATIONAL_POINTERS = Object.freeze({
  enrol: { label: 'Arriving after your CAS deadline, or after teaching has started? Read Arriving late', href: '/late-arrivals' }
});

/**
 * A task's how-to for this student, or null for one of their own. With what they said at sign-up: a
 * home student doesn't get the visa-only steps (VISA_ONLY_STEPS); an international student also gets
 * the pointer for them (INTERNATIONAL_POINTERS), or null.
 * @param {string} id
 * @param {import('#lib/students/student-type.js').StudentType | null} [studentType]
 * @returns {(HowTo & { pointer: Link | null }) | null}
 */
export function howToFor(id, studentType = null) {
  const howTo = HOW_TO[id];
  if (!howTo) return null;
  const visaOnly = VISA_ONLY_STEPS[/** @type {keyof typeof VISA_ONLY_STEPS} */ (id)] ?? [];
  return {
    ...howTo,
    steps: studentType === 'home' ? howTo.steps.filter((step) => !visaOnly.includes(step)) : howTo.steps,
    pointer: studentType === 'international' ? (INTERNATIONAL_POINTERS[id] ?? null) : null
  };
}

/** Whether a link leaves the app (opens in a new tab). @param {Link} link */
export const isOutside = (link) => /^https?:\/\//.test(link.href);

/**
 * What the check-in chat may say about each standard task when it goes through the checklist as a
 * conversation (its how_to tool, chat-tools.js), from the same official pages as HOW_TO (see SOURCES, and the NHS
 * guide's REGISTERING for a GP). Gemini is given only this, and the task's steps, to help with it.
 * - question: how the chat asks about the task, answered Yes or Not yet
 * - needsFirst: a task that has to be done before it, and how the chat asks about that first
 * - first, where, bring, after, contact: what's needed first; where to go, or how to do it online;
 *   what to take; what happens next; who to contact if they're stuck. Only what the pages say.
 * - tool: what the chat can do for it there and then: the GP finder or a dentist search (the
 *   postcode is typed into the app's card and never goes to Gemini), the key contacts card, the
 *   Student Portal link, or suggesting societies
 * - toBeConfirmed: what the official pages don't confirm yet, for the team to check. It's never told
 *   to Gemini, so the chat says it doesn't know rather than guess.
 * @typedef {{ question: string, needsFirst?: { task: string, question: string }, first: string[], where: string[],
 *   bring: string[], after: string[], contact: string[], tool?: 'gp-finder' | 'dentist-finder' | 'contacts' | 'portal' | 'societies',
 *   toBeConfirmed: string[] }} Talk
 */

/** Ask4Help, as the chat says it. */
const ASK4HELP_LINE = 'Ask4Help, the university’s student help service: Ask4Help Online on the Student Portal, or call 0191 227 4646.';

/**
 * The numbers on the key contacts card (contacts), from the pages in SOURCES (security, safety and
 * ask4HelpPhone).
 */
export const KEY_CONTACTS = Object.freeze([
  { name: 'Campus Security: emergencies on campus', phone: '0191 227 3200', tel: 'tel:+441912273200', note: 'Staffed 24 hours. Emergencies only.' },
  { name: 'Campus Security: anything else', phone: '0191 227 3999', tel: 'tel:+441912273999', note: 'Staffed 24 hours.' },
  { name: 'Ask4Help', phone: ASK4HELP.phone, tel: ASK4HELP.tel, note: 'The university’s student help service.' },
  { name: 'Police, ambulance or fire in an emergency', phone: '999', tel: 'tel:999', note: null },
  { name: 'Police, when it isn’t an emergency', phone: '101', tel: 'tel:101', note: null }
]);

/** @type {Readonly<Record<string, Talk>>} */
export const TALK = Object.freeze({
  enrol: {
    question: 'Have you enrolled yet?',
    first: [
      'If you need a UK student visa, your Right to Study check comes first: you can’t enrol until it’s complete. It can be started before you arrive, but it’s only completed in the UK once you’ve shown proof of entry, and it can take up to 5 working days.'
    ],
    where: [
      'Online: log in to the Student Portal, choose Enrol from the main menu, then “Enrol on your programme”, and follow the steps on screen.',
      'There’s step-by-step guidance in “Understanding the Enrolment Process” in the Student Portal.'
    ],
    bring: ['A passport-style photo, ready to upload.'],
    after: [
      'A confirmation email goes to your university and personal email addresses.',
      'It can take up to 48 hours before you can use all the university’s systems.',
      'You need to have arrived and enrolled by your course’s start date.'
    ],
    contact: ['No login details yet: Applicant Services.', 'A forgotten username or password: IT Chat, open 24/7.', `Anything else: ${ASK4HELP_LINE}`],
    tool: 'portal',
    toBeConfirmed: []
  },
  gp: {
    question: 'Have you registered with a GP yet?',
    first: ['Nothing: register as soon as you can, and don’t wait until you’re unwell.'],
    where: [
      'Find a surgery near where you live: the GP finder in the chat shows the nearest.',
      'Register online if the surgery offers it (it takes about 15 minutes), or fill in a form at the surgery.',
      'At the Newcastle campus, Northumbria sends students to the Student GP Registration website.'
    ],
    bring: [
      'Registering is free, and you don’t need ID, proof of address or proof of immigration status.',
      'Sometimes a surgery may ask for extra documents, so take your passport and tenancy agreement if you have them.'
    ],
    after: ['The surgery should tell you when you’re registered, usually within 5 days.'],
    contact: ['The surgery, about registering there.', ASK4HELP_LINE],
    tool: 'gp-finder',
    toBeConfirmed: []
  },
  'student-id': {
    question: 'Have you collected your student ID yet?',
    needsFirst: { task: 'enrol', question: 'Have you enrolled yet? You need to do that first.' },
    first: [
      'Enrol, and upload a passport-style photo: you’re asked when you enrol, or use Upload Photo in the Student Portal (My Info, then Home, then Useful Links).'
    ],
    where: [
      'Your student ID is your Smartcard. Collect it from the campus where your course is taught: “Collecting your Student Smartcard from Campus” in Ask4Help Online says when and where.'
    ],
    bring: ['Physical photo ID: a passport, photo driving licence or PASS card. A copy on your phone won’t do.'],
    after: ['It’s ready 2 working days after you’ve enrolled and uploaded your photo.'],
    contact: [ASK4HELP_LINE],
    tool: 'portal',
    toBeConfirmed: ['Whether students book a time to collect it.']
  },
  society: {
    question: 'Have you joined a society yet?',
    first: [],
    where: [
      'Browse the societies in the app, by campus and category. Each one’s page has what it does, its membership prices and how to get in touch.',
      'To join, go to its page on the Students’ Union website, choose the Student membership and add it to your basket. Associate membership is for alumni, staff and students elsewhere.'
    ],
    bring: [],
    after: [],
    contact: ['The society itself: its page in the app has how to get in touch.'],
    tool: 'societies',
    toBeConfirmed: ['Whether you need to log in to the Students’ Union website, or to have enrolled, before you can join.']
  },
  dentist: {
    question: 'Have you found a dentist yet?',
    first: [],
    where: [
      'Find a dentist near you with NHS Find a dentist: the search in the chat opens it for your postcode.',
      'Contact the practice and ask for an NHS appointment, as some also see private patients. You may be asked to join a waiting list.'
    ],
    bring: [],
    after: ['Most adults pay for NHS dental appointments: the NHS Guide in the app explains the charges.'],
    contact: ['If you can’t find one, your local integrated care board (ICB), which runs dental services in your area, may be able to tell you where to get an appointment.'],
    tool: 'dentist-finder',
    toBeConfirmed: ['What to take to a first dental appointment.', 'What to do in a dental emergency.']
  },
  contacts: {
    question: 'Have you saved your key contacts yet?',
    first: [],
    where: [
      'The key contacts card in the chat has them, ready to save in your phone: Campus Security (0191 227 3200 for emergencies on campus, staffed 24 hours, and 0191 227 3999 for anything else), Ask4Help (0191 227 4646), 999 for police, ambulance or fire in an emergency, and 101 for the police when it isn’t an emergency.'
    ],
    bring: [],
    after: [],
    contact: [],
    tool: 'contacts',
    toBeConfirmed: ['Whether to add the university’s safety app (SafeZone), which wasn’t on the pages read.']
  }
});

/** A task's conversation details, or null for one of their own. @param {string} id */
export const talkFor = (id) => TALK[id] ?? null;

/**
 * What the chat says with its GP finder or dentist search, whenever a student asks where the nearest
 * GP or dentist is: the app's own words, from the how-tos above (TALK.gp and TALK.dentist), so the
 * chat never refuses to help find one and never makes anything up.
 */
export const FINDER_LINES = Object.freeze({
  gp: 'Find a surgery near you below. To register, use its website if it offers it (about 15 minutes) or fill in a form at the surgery. It’s free, and you don’t need ID, though a surgery may ask for your passport and tenancy agreement.',
  dentist: 'Find a dentist near you below, then contact the practice and ask for an NHS appointment. You may be asked to join a waiting list, and most adults pay for NHS dental appointments.'
});

/**
 * How to do a standard task, in one line for the chat's ordinary instructions (where, and what to
 * take), so it can answer "how do I enrol?" from any message without making anything up.
 * @param {string} id @param {string} title
 */
export function howToLine(id, title) {
  const talk = TALK[id];
  return talk ? `${title}: ${[...talk.first.slice(0, 1), ...talk.where, ...talk.bring.slice(0, 1)].join(' ')}` : '';
}
