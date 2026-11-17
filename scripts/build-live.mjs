// Builds the live site for Firebase Hosting: npm run build:live. A static site (adapter-static, every
// page served from index.html), built in Vite's "live" mode (see vite.config.ts) from a copy of
// src/routes without the folders in LEFT_OUT (scripts/lib/live-build.mjs). The copy is deleted
// afterwards, then scripts/check-live-build.mjs checks what was built. Dev (npm run dev) is unchanged.
import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { LEFT_OUT, LIVE_ROUTES } from './lib/live-build.mjs';

/** Every file under a folder. @param {string} folder @returns {string[]} */
const filesIn = (folder) =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });

/** @param {string} script @param {string[]} args */
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' }).status ?? 1;

rmSync(LIVE_ROUTES, { recursive: true, force: true });
let status = 1;
try {
  cpSync('src/routes', LIVE_ROUTES, {
    recursive: true,
    filter: (source) => !LEFT_OUT.includes(relative('src/routes', source).split(sep)[0])
  });
  // Static hosting can't run server code, so none may be left in what goes live.
  const server = filesIn(LIVE_ROUTES).filter((file) => /\+(page|layout)?\.?server\.js$|\+server\.js$/.test(file));
  if (server.length) throw new Error(`Server routes can't go on static hosting: ${server.join(', ')}`);
  console.log(`Building the live site from src/routes without: ${LEFT_OUT.join(', ')}`);
  status = run('node_modules/vite/bin/vite.js', ['build', '--mode', 'live']);
} finally {
  rmSync(LIVE_ROUTES, { recursive: true, force: true });
  // Put SvelteKit's generated types back for src/routes, for the dev server and svelte-check.
  run('node_modules/@sveltejs/kit/svelte-kit.js', ['sync']);
}
if (status !== 0) process.exit(status);
process.exit(run('scripts/check-live-build.mjs', []));
