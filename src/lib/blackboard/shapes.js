// What the Blackboard section gets from the server (src/routes/api/blackboard/modules): only what it
// shows. Never grades or scores, who wrote something, or anything about other students; never a
// token. Types only, so both the server and the page can use them.

/**
 * A deadline: a gradebook item with a due date, or a due date from the Blackboard calendar.
 * @typedef {{ id: string, title: string, due: string, url: string | null }} Task
 */
/**
 * Something on the module's calendar, such as a test or a guest lecture.
 * @typedef {{ id: string, title: string, start: string, end: string | null }} CalendarEvent
 */
/**
 * Something released in the module: a folder (such as "Week 5") or an item in one.
 * @typedef {{ id: string, title: string, created: string, kind: 'folder' | 'item', url: string | null }} ContentItem
 */
/**
 * An announcement, as plain text.
 * @typedef {{ id: string, title: string, text: string, posted: string }} Announcement
 */
/**
 * One of this term's modules. partial names any part Blackboard wouldn't show (some modules hide
 * their gradebook from students), so the page can say so.
 * @typedef {{ id: string, code: string, name: string, url: string | null, tasks: Task[], events: CalendarEvent[],
 *   content: ContentItem[], announcements: Announcement[], partial: ('tasks' | 'content' | 'announcements')[] }} Module
 */
/**
 * What the page shows: not connected (or the connection needs renewing, or Blackboard isn't set up
 * on this server), the modules, or that Blackboard isn't answering.
 * @typedef {{ connected: false, reason: 'not-connected' | 'reconnect' | 'not-set-up' }
 *   | { connected: true, modules: Module[], readAt: string, mock: boolean }
 *   | { connected: true, error: 'unavailable' }} BlackboardView
 */

export {};
