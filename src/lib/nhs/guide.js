import costs from '#lib/nhs/nhs-costs.json' with { type: 'json' };

// The NHS guide (src/routes/nhs-guide) as data, so a check can make sure every fact has its source.
// Each point is a fact with its official source, a link to another page in the app, or something
// marked "to be confirmed". Money figures are never written here: the text says {name} and the
// amount comes from nhs-costs.json, which has the date they were checked. Every fact was checked
// against its source on that date (check-nhs-guide.mjs --links checks the links still work).
// The GP finder shows REGISTERING from here too, so the two pages can't disagree.

/** @typedef {{ label: string, href: string }} Link */
/**
 * One point in a section. A fact has a source, and may have a further link; an app point links
 * another page in the app; a point marked toBeConfirmed has a link but couldn't be checked against
 * an official source (none at the moment).
 * @typedef {{ text: string, source?: Link, app?: Link, link?: Link, toBeConfirmed?: boolean }} Point
 * @typedef {{ term: string, meaning: string, source: Link }} Term
 * @typedef {{ id: string, title: string, intro: string, points: Point[], terms?: Term[] }} Section
 */

/** The official pages the facts come from. */
export const SOURCES = {
  surchargeCost: { label: 'GOV.UK: how much the health surcharge costs', href: 'https://www.gov.uk/healthcare-immigration-application/how-much-pay' },
  surcharge: { label: 'GOV.UK: paying for UK healthcare with your visa', href: 'https://www.gov.uk/healthcare-immigration-application' },
  register: { label: 'NHS: register with a GP surgery', href: 'https://www.nhs.uk/nhs-services/gps/how-to-register-with-a-gp-surgery/' },
  gpServices: { label: 'NHS: GP services', href: 'https://www.nhs.uk/nhs-services/gps/' },
  pharmacy: { label: 'NHS: how pharmacies can help', href: 'https://www.nhs.uk/nhs-services/pharmacies/how-pharmacies-can-help/' },
  nhs111: { label: 'NHS: when to use 111', href: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-use-111/' },
  ae: { label: 'NHS: when to go to A&E', href: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-go-to-ae/' },
  freeForEveryone: { label: 'NHS: services that are free to everyone', href: 'https://www.nhs.uk/nhs-services/visiting-or-moving-to-england/how-to-access-nhs-services-in-england-if-you-are-visiting-from-abroad/' },
  healthHub: { label: 'Northumbria University: Student Health Hub', href: 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/welfare-and-health-support/student-health-hub/' },
  prescriptions: { label: 'NHS: prescription charges', href: 'https://www.nhs.uk/nhs-services/prescriptions/nhs-prescription-charges/' },
  prepayment: { label: 'NHS: prescription prepayment certificates', href: 'https://www.nhs.uk/nhs-services/prescriptions/save-money-with-a-prescription-prepayment-certificate-ppc/' },
  dental: { label: 'NHS: how much NHS dental treatment costs', href: 'https://www.nhs.uk/nhs-services/dentists/how-much-nhs-dental-treatment-costs/' },
  findDentist: { label: 'NHS: how to find an NHS dentist', href: 'https://www.nhs.uk/nhs-services/dentists/how-to-find-an-nhs-dentist/' },
  lowIncome: { label: 'NHS: the NHS Low Income Scheme', href: 'https://www.nhs.uk/nhs-services/help-with-health-costs/nhs-low-income-scheme-lis/' },
  nhsApp: { label: 'NHS: the NHS App', href: 'https://www.nhs.uk/nhs-app/' },
  nhsAppHelp: { label: 'NHS: help with using the NHS App', href: 'https://www.nhs.uk/nhs-app/help/' },
  nhsNumber: { label: 'NHS: find your NHS number', href: 'https://www.nhs.uk/nhs-services/find-nhs-number/' },
  talkingTherapies: { label: 'NHS: talking therapies you can refer yourself to', href: 'https://www.nhs.uk/nhs-services/mental-health-services/find-nhs-talking-therapies-for-anxiety-and-depression/' },
  uniMentalHealth: { label: 'Northumbria University: mental health and wellbeing support', href: 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/counselling-and-mental-health-support/' },
  studentGpRegistration: { label: 'Student GP Registration', href: 'https://www.studentgpreg.org.uk/' },
  registeringWithADoctor: { label: 'Northumbria University: registering with a doctor', href: 'https://www.northumbria.ac.uk/study-at-northumbria/support-for-students/international-student-support/registering-with-a-doctor/' }
};

/** When the money figures were last checked against their sources, such as "17 November 2026". */
export const COSTS_CHECKED_ON = new Date(`${costs.checkedOn}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/London'
});

/**
 * The text with each {name} replaced by that figure from nhs-costs.json. An unknown name is left as
 * it is, so check-nhs-guide.mjs can spot it.
 * @param {string} text
 */
export function withFigures(text) {
  /** @type {Record<string, { amount: string }>} */
  const figures = costs.figures;
  return text.replace(/\{(\w+)\}/g, (whole, name) => figures[name]?.amount ?? whole);
}

/**
 * Registering with a GP: shown on the NHS guide and the GP finder, so the two say the same.
 * @satisfies {Record<string, Point>}
 */
export const REGISTERING = {
  free: {
    text: 'Registering with a GP surgery is free, and you do not need ID, proof of address or proof of immigration status.',
    source: SOURCES.register
  },
  documents: {
    text: 'Sometimes a surgery may ask for extra documents, so take your passport and tenancy agreement if you have them.',
    source: SOURCES.register
  },
  studentRegistration: {
    text: 'Newcastle campus: Northumbria sends you to the Student GP Registration website, which is run on behalf of Newcastle University and Northumbria University.',
    source: SOURCES.studentGpRegistration,
    link: SOURCES.registeringWithADoctor
  },
  healthHub: {
    text: 'The Student Health Hub is extra: it doesn’t replace registering with a GP.',
    source: SOURCES.healthHub
  }
};

/** @type {Section[]} */
export const SECTIONS = [
  {
    id: 'paid',
    title: 'What you’ve paid for',
    intro: 'If you’re here on a student visa, you paid for the NHS when you applied.',
    points: [
      { text: 'The immigration health surcharge is {healthSurcharge} a year for students, paid with your visa application.', source: SOURCES.surchargeCost },
      { text: 'It lets you use the NHS free of charge from the date your visa starts.', source: SOURCES.surcharge },
      { text: 'You’ll still pay for some things, such as prescriptions, dental treatment and eye tests (see What things cost).', source: SOURCES.surcharge }
    ]
  },
  {
    id: 'gp',
    title: 'Register with a GP',
    intro: 'Register with a GP surgery as soon as you arrive, before you’re ill.',
    points: [
      REGISTERING.free,
      REGISTERING.documents,
      REGISTERING.studentRegistration,
      { text: 'Find a surgery near where you live.', app: { label: 'GP finder', href: '/gp-finder' } }
    ]
  },
  {
    id: 'where',
    title: 'Where to go',
    intro: 'Pick the right place for how unwell you are.',
    points: [
      { text: 'A pharmacy for minor illnesses: pharmacists can treat some common conditions, such as sore throats, sinusitis and infected insect bites, without a GP appointment. This is called Pharmacy First.', source: SOURCES.pharmacy },
      { text: 'Your GP for anything ongoing.', source: SOURCES.gpServices },
      { text: 'NHS 111 if you need medical help now but it’s not an emergency: use 111 online, the NHS App, or call 111.', source: SOURCES.nhs111 },
      { text: 'Call 999 or go to A&E for serious injuries and life-threatening emergencies.', source: SOURCES.ae },
      { text: 'A&E is free for everyone.', source: SOURCES.freeForEveryone }
    ]
  },
  {
    id: 'hub',
    title: 'The Student Health Hub',
    intro: 'A drop-in health and wellbeing service for Northumbria and Newcastle University students.',
    points: [
      { text: 'Every Friday, 9:30am to 12:30pm, at Level 2, King’s Gate, Newcastle University, Barras Bridge, NE1 7RU.', source: SOURCES.healthHub },
      { text: 'Just walk in: no booking or referral needed.', source: SOURCES.healthHub },
      { text: 'GP services from Saville Medical Group, plus mental health, sexual health and wellbeing support.', source: SOURCES.healthHub },
      REGISTERING.healthHub
    ]
  },
  {
    id: 'costs',
    title: 'What things cost',
    intro: 'Charges in England. They change every April.',
    points: [
      { text: 'Prescriptions: {prescription} for each item, not each prescription.', source: SOURCES.prescriptions },
      { text: 'If you need a lot, a prepayment certificate can save money: {prepayment3Months} for 3 months or {prepayment12Months} for 12 months.', source: SOURCES.prepayment },
      { text: 'NHS dentist: Band 1 {dentalBand1} (check-up, X-rays, scale and polish), Band 2 {dentalBand2} (such as fillings or taking a tooth out), Band 3 {dentalBand3} (such as crowns or dentures).', source: SOURCES.dental },
      { text: 'You may have to join a waiting list for an NHS dentist, so look early.', source: SOURCES.findDentist },
      { text: 'Help with costs: the NHS Low Income Scheme (form HC1), if your savings are under {lowIncomeSavings}.', source: SOURCES.lowIncome }
    ]
  },
  {
    id: 'app',
    title: 'The NHS App',
    intro: 'Once you’re registered with a GP, the NHS App puts the basics on your phone.',
    points: [
      { text: 'You can use it if you’re 13 or over and registered with a GP surgery in England.', source: SOURCES.nhsApp },
      { text: 'Book or manage GP appointments, if your surgery offers it, and view test results.', source: SOURCES.gpServices },
      { text: 'Order and manage your prescriptions.', source: SOURCES.nhsAppHelp },
      { text: 'Find your NHS number.', source: SOURCES.nhsNumber }
    ]
  },
  {
    id: 'mental-health',
    title: 'Mental health',
    intro: 'You don’t have to wait until things are bad to ask for help.',
    points: [
      { text: 'Talk to your GP, who can refer you.', source: SOURCES.talkingTherapies },
      { text: 'NHS Talking Therapies: you can refer yourself if you’re 18 or over (16 or 17 in some areas), without a diagnosis.', source: SOURCES.talkingTherapies },
      { text: 'Northumbria’s mental health and wellbeing support, including one-to-one support with mental health practitioners.', source: SOURCES.uniMentalHealth },
      { text: 'If you need help now, see the Need help now page.', app: { label: 'Need help now', href: '/need-help' } }
    ]
  },
  {
    id: 'words',
    title: 'Words you’ll hear',
    intro: 'A few NHS words, in plain English.',
    points: [],
    terms: [
      { term: 'GP', meaning: 'A doctor at your local GP surgery, for health problems that aren’t emergencies.', source: SOURCES.gpServices },
      { term: 'Surgery', meaning: 'The place where GPs work. You register with one.', source: SOURCES.register },
      { term: 'A&E', meaning: 'Accident and emergency, for serious injuries and life-threatening emergencies. Also called the emergency department or casualty.', source: SOURCES.ae },
      { term: 'NHS 111', meaning: 'Help when you need medical help now but it’s not an emergency: online, in the NHS App or by calling 111.', source: SOURCES.nhs111 },
      { term: 'Prescription', meaning: 'Medicine a health professional says you need, which you collect from a pharmacy. Each item costs {prescription}.', source: SOURCES.prescriptions },
      { term: 'Pharmacy', meaning: 'A chemist, where pharmacists give medicines and advice on common illnesses.', source: SOURCES.pharmacy },
      { term: 'NHS number', meaning: 'A 10-digit number that identifies you in the NHS. You don’t need it to use NHS services.', source: SOURCES.nhsNumber }
    ]
  }
];
