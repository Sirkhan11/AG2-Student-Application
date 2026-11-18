// The bottom bar's tabs, in order, in one place: BottomNav.svelte draws them, and page-transitions.js
// crossfades between their pages rather than sliding, so swapping a tab is a one-line change here.
// Thomas chose, from the group's wireframe: Societies where Mentor was (it's the one students browse),
// and Chat kept in the middle (everything is doable from the chat). Mentor stays one tap away, on Home
// and on More; the GP and dentist finder is behind the checklist's buttons, Home's next task and More.
// No Firebase here, so the checks can read it in Node.

/** Each tab: its name, its icon (Icon.svelte) and its page. */
export const TABS = Object.freeze(
  /** @type {const} */ ([
    { name: 'Home', icon: 'home', href: '/home' },
    { name: 'Checklist', icon: 'checklist', href: '/checklist' },
    { name: 'Chat', icon: 'chat', href: '/check-in' },
    { name: 'Societies', icon: 'people', href: '/societies' },
    { name: 'More', icon: 'more', href: '/more' }
  ])
);

/** The tabs' pages. @type {readonly string[]} */
export const TAB_PATHS = Object.freeze(TABS.map((tab) => tab.href));
