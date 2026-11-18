// How to do each standard checklist task: two to four short steps, a link to act on, and the
// official pages the steps are drafted from (checked on 17 November 2026; the enrolment steps are
// the ones the project lead gave, which these pages back up). The checklist page shows them under
// each task, and the check-in chat can walk a student through them. Every task, standard or their
// own, also has "Stuck? Contact Ask4Help" (ASK4HELP). check-checklist-how-to.mjs checks them, and
// with --links that every link and source still answers. No Firebase here, so the checks run it in Node.

/** @typedef {{ label: string, href: string }} Link */
/**
 * steps: what to do, in order; link: where to do it (a page in the app, or an outside page);
 * sources: the official pages the steps come from.
 * @typedef {{ steps: string[], link: Link, sources: Link[] }} HowTo
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
    sources: [SOURCES.dentist]
  },
  contacts: {
    steps: [
      'Save Campus Security: 0191 227 3200 for emergencies on campus (it’s staffed 24 hours) and 0191 227 3999 for anything else.',
      'Save Ask4Help, the university’s student help service: 0191 227 4646.',
      'For police, ambulance or fire in an emergency, call 999. For the police when it isn’t an emergency, call 101.'
    ],
    link: { label: 'Need help now', href: '/need-help' },
    sources: [SOURCES.security, SOURCES.safety, SOURCES.ask4HelpPhone]
  }
});

/** A task's how-to, or null for one of their own. @param {string} id */
export const howToFor = (id) => HOW_TO[id] ?? null;

/** Whether a link leaves the app (opens in a new tab). @param {Link} link */
export const isOutside = (link) => /^https?:\/\//.test(link.href);
