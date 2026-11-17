// A link that opens Outlook on the web (outlook.office.com, the student's university Microsoft 365
// account) with a new calendar item already filled in. Made on the phone from what the page shows:
// nothing goes to the app's server, and no Microsoft permissions are needed. The student's own tap
// sends it to Microsoft.
//
// On phones, a .ics file often never reaches Outlook (the Outlook app doesn't import them, and iPhones
// hand them to Apple Calendar), hence this link next to the .ics. Microsoft doesn't document it, and
// its path has changed before (/calendar/0/deeplink/compose, /calendar/action/compose), so it lives in
// this one function: if it stops working, this is the only place to change.

/** "2026-11-20T13:30:00Z": UTC, ending in Z, without milliseconds. @param {string | number} time */
const utc = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Outlook on the web's "new event" page for a calendar entry (see ics.js for the entries).
 * @param {import('./ics.js').CalendarEntry} entry
 */
export function outlookWebUrl(entry) {
  const query = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: entry.title,
    startdt: utc(entry.start),
    enddt: utc(entry.end),
    body: entry.description ?? ''
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${query}`;
}
