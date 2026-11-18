// The four one-tap cards at the top of Need help now (src/routes/need-help), most urgent first, as the
// group's wireframe has them: 999, NHS 111, Samaritans and Shout. Each number and its words were
// checked against the service's own page on CHECKED_ON, and nothing is from memory: what a page
// doesn't say is left out (the NHS pages don't say 111 is free or round the clock, so the card
// doesn't). check-layout.mjs checks each card has its official source and the right tel: or sms:
// link, and with --links that the pages still answer. No Firebase here, so the checks run it in Node.

/** @typedef {{ label: string, href: string }} Link */
/**
 * One card: its heading, a line under it, the link that calls or texts (tel: or sms:), its tone
 * ('danger' for 999, the filled red one), and the official page it was checked against.
 * @typedef {{ id: string, title: string, words: string, href: string, tone: 'danger' | 'soft', source: Link }} UrgentHelp
 */

/** When the numbers and words were last checked against their sources. */
export const CHECKED_ON = '18 November 2026';

/** @type {readonly UrgentHelp[]} */
export const URGENT_HELP = Object.freeze([
  {
    id: '999',
    title: 'Call 999',
    // NHS: "999 is for life-threatening emergencies like serious road traffic accidents, strokes and heart attacks."
    words: 'If you or someone else is in immediate danger: life-threatening emergencies.',
    href: 'tel:999',
    tone: 'danger',
    source: { label: 'NHS: when to call 999', href: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-call-999/' }
  },
  {
    id: '111',
    title: 'Call NHS 111',
    // NHS: "NHS 111 can help if you think you need medical help right now", and for mental health, "call
    // 111 and select the mental health option". The pages don't give an option number, hours or cost.
    words: 'Urgent medical help that isn’t life-threatening. For urgent mental health help, select the mental health option.',
    href: 'tel:111',
    tone: 'soft',
    source: { label: 'NHS: where to get urgent help for mental health', href: 'https://www.nhs.uk/nhs-services/mental-health-services/where-to-get-urgent-help-for-mental-health/' }
  },
  {
    id: 'samaritans',
    title: 'Call Samaritans: 116 123',
    // Samaritans: "call us any time, from any phone for FREE", "Open 24 hours a day", "365 days a year".
    words: 'Someone to talk to, any time: free, 24 hours a day, 365 days a year.',
    href: 'tel:116123',
    tone: 'soft',
    source: { label: 'Samaritans: contact a Samaritan', href: 'https://www.samaritans.org/how-we-can-help/contact-samaritan/' }
  },
  {
    id: 'shout',
    title: 'Text SHOUT to 85258',
    // Shout: "text the word 'Shout' to 85258"; "a free, confidential and 24/7 text messaging service for
    // anyone in the UK who needs support".
    words: 'If you’d rather text: free, confidential and 24/7, for anyone in the UK.',
    href: 'sms:85258?&body=SHOUT',
    tone: 'soft',
    source: { label: 'Shout: get help', href: 'https://giveusashout.org/get-help/' }
  }
]);
