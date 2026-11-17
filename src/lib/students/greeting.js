// Home's greeting: the student's first name, from the name they gave at sign-up (students/{uid}.name),
// or "there" when there isn't one. No Firebase here, so the checks can test it in Node.

/** Longest first name shown, so an odd entry can't push the page sideways. */
const MAX_FIRST_NAME = 40;

/**
 * The first word of the name they gave, as they typed it, or null.
 * @param {unknown} name
 */
export function firstName(name) {
  if (typeof name !== 'string') return null;
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first ? first.slice(0, MAX_FIRST_NAME) : null;
}

/**
 * "Hi Sam", or "Hi there" when there's no name.
 * @param {unknown} name
 */
export const greetingFor = (name) => `Hi ${firstName(name) ?? 'there'}`;
