// Blanks contact details out of text before it goes to Gemini, as Google's free tier may keep what
// it's sent: anything shaped like an email address, and UK mobile numbers. Used for the student's
// chat messages (chat.js) and for what the chat is told about them (opener.js). No Firebase here.

const EMAIL_ADDRESS = /\S+@\S+\.\S+/g;
const UK_MOBILE = /(\+44\s?7|\b07)\d{3}\s?\d{3}\s?\d{3}\b/g;

/**
 * The text with email addresses and UK mobile numbers replaced by "[email]" and "[phone number]".
 * @param {string} text
 */
export function blankContactDetails(text) {
  return text.replace(EMAIL_ADDRESS, '[email]').replace(UK_MOBILE, '[phone number]');
}
