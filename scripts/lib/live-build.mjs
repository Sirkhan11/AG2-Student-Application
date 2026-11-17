// What the live build (scripts/build-live.mjs) leaves out, shared with scripts/check-live-build.mjs.

/**
 * Top-level folders of src/routes that never go live:
 * - api/ and blackboard/: server routes (Blackboard's, and the pretend Blackboard). Firebase Hosting
 *   is static, so they couldn't run, and Blackboard waits for IT anyway (the live checklist says
 *   it's coming soon).
 * - dev/, matching-demo/ and matching-test/: pages for the team, not students.
 */
export const LEFT_OUT = ['api', 'blackboard', 'dev', 'matching-demo', 'matching-test'];

/** The copy of src/routes the live build is made from (git ignores it, and it's deleted afterwards). */
export const LIVE_ROUTES = 'src/routes-live';

/** What the live build writes, and Firebase Hosting serves (firebase.json's hosting.public). */
export const LIVE_OUTPUT = 'build';
