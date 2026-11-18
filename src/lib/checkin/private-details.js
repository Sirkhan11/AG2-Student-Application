// Blanks contact details out of text before it goes to Gemini, as Google keeps what it's sent for a
// limited time (on the paid tier, to detect misuse and for safety, security and legal reasons):
// anything shaped like an email address, UK mobile numbers and full UK postcodes. Used for the student's
// chat messages (chat.js) and for what the chat is told about them (opener.js). No Firebase here.

const EMAIL_ADDRESS = /\S+@\S+\.\S+/g;
const UK_MOBILE = /(\+44\s?7|\b07)\d{3}\s?\d{3}\s?\d{3}\b/g;
/** A full UK postcode (NE1 8ST, ne18st): the GP finder takes one, and it never goes to Gemini. */
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

/**
 * The text with email addresses, UK mobile numbers and full UK postcodes replaced by "[email]",
 * "[phone number]" and "[postcode]".
 * @param {string} text
 */
export function blankContactDetails(text) {
  return text.replace(EMAIL_ADDRESS, '[email]').replace(UK_MOBILE, '[phone number]').replace(UK_POSTCODE, '[postcode]');
}
