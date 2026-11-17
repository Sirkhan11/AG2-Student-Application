// The Late arrivals page (src/routes/late-arrivals) as data, like the NHS guide: each fact links to
// the Northumbria page it comes from (checked on 17 November 2026), and the catch-up steps, which no
// Northumbria page lists, are marked as advice. check-late-arrivals.mjs checks the sources and,
// with --links, that every link still answers.

/** @typedef {{ label: string, href: string }} Link */
/**
 * A point: a fact with its source, advice (a sensible step, not a university rule), or both kinds
 * with a link to act on or a page in the app.
 * @typedef {{ text: string, source?: Link, advice?: boolean, link?: Link, app?: Link }} Point
 * @typedef {{ id: string, title: string, points: Point[], numbered?: boolean }} Section
 */

export const SOURCES = {
  meetAndGreet: { label: 'Northumbria University: Meet and Greet', href: 'https://www.northumbria.ac.uk/study-at-northumbria/admissions/meet-and-greet/' },
  ask4Help: { label: 'Northumbria University: Ask4Help', href: 'https://www.northumbria.ac.uk/about-us/university-services/student-library-and-academic-services/student-engagement/ask4help/' },
  commonQueries: { label: 'Northumbria University: preparing to join us', href: 'https://corp.northumbria.ac.uk/study-at-northumbria/admissions/preparing-to-join-us-common-queries/' }
};

export const LINKS = {
  delayedArrival: { label: 'Managing your delayed arrival', href: 'https://myportal.northumbria.ac.uk/kbarticle/KA-02016' },
  contactForm: { label: 'Northumbria’s contact form', href: 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=3c9X5zUfV0Svj3ycaxQ347DHHMUjSFZPgC45ikea8aNUOUVQQ0tBR1VLSFlSOVE1QkRTSEJWRlQ1Si4u' },
  enrolment: { label: 'Right to Study check and enrolment', href: 'https://myportal.northumbria.ac.uk/kbarticle/KA-01089' },
  ask4HelpOnline: { label: 'Ask4Help Online', href: 'https://myportal.northumbria.ac.uk/Help-and-support' }
};

/** The Blackboard section of the checklist, for everything modules have released so far. */
export const BLACKBOARD_SECTION = { label: 'Your modules on Blackboard', href: '/checklist#blackboard' };

/** @type {Section[]} */
export const SECTIONS = [
  {
    id: 'deadline',
    title: 'Don’t travel after your CAS deadline',
    points: [
      {
        text: 'You must arrive in the UK and complete both a Right to Study check and university enrolment before the deadline shown on your Confirmation of Acceptance for Studies (CAS).',
        source: SOURCES.meetAndGreet
      },
      { text: 'Don’t travel to the UK after that deadline.', source: SOURCES.meetAndGreet }
    ]
  },
  {
    id: 'worried',
    title: 'If you think you’ll be late',
    points: [
      {
        text: 'Contact the university straight away by sending an enquiry through “Managing your delayed arrival” in the Student Portal. They can advise you on your options.',
        source: SOURCES.meetAndGreet,
        link: LINKS.delayedArrival
      },
      { text: 'If you can’t get into the Student Portal yet, use Northumbria’s contact form instead.', source: SOURCES.meetAndGreet, link: LINKS.contactForm },
      {
        text: 'Ask4Help, the university’s student support service, is available online, on campus and by phone, 24/7 during term time.',
        source: SOURCES.ask4Help,
        link: LINKS.ask4HelpOnline
      }
    ]
  },
  {
    id: 'catch-up',
    title: 'Catching up once you’re here',
    numbered: true,
    points: [
      { text: 'Enrol, after your Right to Study check if you’re an international student.', source: SOURCES.meetAndGreet, link: LINKS.enrolment },
      { text: 'See everything your modules have released so far, with deadlines, in the Blackboard section of your checklist.', advice: true, app: BLACKBOARD_SECTION },
      { text: 'Email your module tutors to agree how to catch up on what you’ve missed.', advice: true },
      { text: 'If you’re stuck, ask Ask4Help Online.', source: SOURCES.commonQueries, link: LINKS.ask4HelpOnline }
    ]
  }
];
