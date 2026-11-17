// Checks on the matching answers that the sign-up and Find a mentor pages and the chat all use. No
// Firebase here, so the checks can test it in Node.

/**
 * Finds the first answer that's empty or only spaces, and returns its position (or -1 if every answer has text).
 * The browser's `required` check accepts "   ", so this is what actually stops blank answers.
 * @param {string[]} answers
 */
export function findBlankAnswer(answers) {
  return answers.findIndex((answer) => answer.trim() === '');
}
