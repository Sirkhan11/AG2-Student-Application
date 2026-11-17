// True in the live build (npm run build:live, Vite's "live" mode), for Firebase Hosting: a static
// site with no server, so anything that needs the app's own server routes (Blackboard, for now) is
// left out there. Vite replaces import.meta.env.MODE when it builds, so the code for the other case
// is dropped from the live files. In Node (the check scripts), import.meta.env doesn't exist: false.
export const LIVE = import.meta.env?.MODE === 'live';
