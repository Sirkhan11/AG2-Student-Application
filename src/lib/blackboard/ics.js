// Blackboard deadlines and calendar events as calendar items, for "Add to calendar" in the checklist's
// Blackboard section (made into a file or an Outlook link by src/lib/calendar/). No network here.

const HALF_HOUR = 30 * 60_000;
const HOUR = 60 * 60_000;

/** @typedef {import('#lib/calendar/ics.js').CalendarEntry} CalendarEntry */

/**
 * A deadline as a calendar entry: the half hour before it's due.
 * @param {import('./shapes.js').Task} task
 * @param {string} moduleName
 * @returns {CalendarEntry}
 */
export const deadlineEntry = (task, moduleName) => ({
  id: `deadline-${task.id}`,
  title: `Due: ${task.title} (${moduleName})`,
  start: Date.parse(task.due) - HALF_HOUR,
  end: task.due,
  description: `${task.title} is due for ${moduleName}. From Blackboard: check the module page for the details.`,
  url: task.url
});

/**
 * A calendar event as a calendar entry (an hour long if Blackboard gives no end).
 * @param {import('./shapes.js').CalendarEvent} event
 * @param {string} moduleName
 * @returns {CalendarEntry}
 */
export const eventEntry = (event, moduleName) => ({
  id: `event-${event.id}`,
  title: `${event.title} (${moduleName})`,
  start: event.start,
  end: event.end ?? Date.parse(event.start) + HOUR,
  description: `${event.title} for ${moduleName}. From Blackboard: check the module page for the details.`
});
