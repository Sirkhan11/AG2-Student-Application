// Checks the live site's files (build/, from npm run build:live) before they go to Firebase Hosting,
// the way check-blackboard.mjs --build checks for secrets. It never prints a secret: only the name of
// the setting and the file it was found in.
// - No App Check debug token, Blackboard key, secret or cookie key, test login, or private key in
//   any file: every value in the env files except the public Firebase config and reCAPTCHA site key.
// - None of what's left out (scripts/lib/live-build.mjs): no Blackboard requests or pretend
//   Blackboard, no team pages; the checklist's Blackboard section says it's coming soon.
// - index.html (the page every address is served from), and robots.txt asking search engines not to
//   list the site.
// - firebase.json and .firebaserc: ag2-dev-thomas, from build/, every address to index.html,
//   index.html and the pages not cached (so updates show straight away), the hashed files cached for
//   a year, and the Firestore rules from firestore.rules, deployed with the site.
// Run from the project folder after a live build (npm run build:live runs it for you):
//   node scripts/check-live-build.mjs

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LEFT_OUT, LIVE_OUTPUT } from './lib/live-build.mjs';

/** Settings that are meant to be in the browser: Firebase's web config and the reCAPTCHA site key. */
const PUBLIC = /^VITE_FIREBASE_|^VITE_RECAPTCHA_SITE_KEY$/;
const ENV_FILES = ['.env', '.env.local', '.env.development.local', '.env.test.local'];

/** Every file under a folder. @param {string} folder @returns {string[]} */
const filesIn = (folder) =>
  existsSync(folder)
    ? readdirSync(folder).flatMap((name) => {
        const path = join(folder, name);
        return statSync(path).isDirectory() ? filesIn(path) : [path];
      })
    : [];

/** The settings in the env files that aren't public, as [name, value]. Values are never printed. */
function secretSettings() {
  /** @type {[string, string][]} */
  const found = [];
  for (const file of ENV_FILES.filter((name) => existsSync(name))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || PUBLIC.test(match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      if (value.length >= 8) found.push([`${match[1]} (${file})`, value]);
    }
  }
  return found;
}

/** The addresses of the left-out pages and routes, from their folders in src/routes. */
function leftOutAddresses() {
  const addresses = new Set();
  for (const folder of LEFT_OUT) {
    for (const file of filesIn(join('src/routes', folder))) {
      if (!/\+(page|server|page\.server)\.(js|svelte)$/.test(file)) continue;
      const path = `/${relative('src/routes', file).split('/').slice(0, -1).join('/')}`;
      // Up to the first [param], which a built file wouldn't have as text.
      addresses.add(path.replace(/\/\[.*$/, ''));
    }
  }
  return [...addresses];
}

const files = filesIn(LIVE_OUTPUT);
const text = new Map(files.map((file) => [file, readFileSync(file, 'latin1')]));
/** Files containing this text. @param {string} needle */
const filesWith = (needle) => files.filter((file) => /** @type {string} */ (text.get(file)).includes(needle));

/** @type {[string, () => void][]} */
const checks = [
  [`There's a live build in ${LIVE_OUTPUT}/ (npm run build:live)`, () => {
    assert.ok(files.length > 10, `${files.length} files`);
    assert.ok(existsSync(join(LIVE_OUTPUT, 'index.html')), 'index.html');
  }],
  ['No setting from the env files is in any file, apart from the public Firebase config and reCAPTCHA key (names only, never values)', () => {
    const settings = secretSettings();
    assert.ok(settings.some(([name]) => name.startsWith('VITE_APPCHECK_DEBUG_TOKEN')), 'the debug token was looked for (it’s in .env.development.local)');
    const found = settings.flatMap(([name, value]) => filesWith(value).map((file) => `${name} in ${file}`));
    assert.deepEqual(found, []);
  }],
  ['No private key or service account in any file, and nothing that sets an App Check debug token', () => {
    assert.deepEqual(files.filter((file) => /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|"client_email":/.test(/** @type {string} */ (text.get(file)))), []);
    // The App Check SDK itself reads FIREBASE_APPCHECK_DEBUG_TOKEN, to see whether a page set one;
    // the live site must never set it (ai.js only does in dev, and a build drops that).
    const sets = files.filter((file) => /FIREBASE_APPCHECK_DEBUG_TOKEN\s*=(?!=)/.test(/** @type {string} */ (text.get(file))));
    assert.deepEqual(sets, [], 'code that sets a debug token');
    assert.ok(filesWith('FIREBASE_APPCHECK_DEBUG_TOKEN').length <= 1, 'only the SDK’s own check');
  }],
  [`None of what's left out is there: ${LEFT_OUT.join(', ')} (no Blackboard requests, no pretend Blackboard, no team pages)`, () => {
    const addresses = leftOutAddresses();
    assert.ok(addresses.includes('/api/blackboard/connect') && addresses.includes('/matching-demo'), addresses.join(', '));
    const markers = [...addresses, '/api/blackboard', '/blackboard/callback', '/blackboard/mock', 'Pretend Blackboard'];
    assert.deepEqual(markers.flatMap((marker) => filesWith(marker).map((file) => `${marker} in ${file}`)), []);
  }],
  ['The local emulators (vite dev --mode emulators, for the browser checks) are nowhere in it', () => {
    assert.deepEqual([...filesWith('127.0.0.1:9099'), ...filesWith('127.0.0.1:8080'), ...filesWith('demo-ag2')], []);
  }],
  ['The checklist’s Blackboard section says it’s coming soon', () => {
    assert.ok(filesWith('Coming soon: your modules, deadlines and announcements from Blackboard').length > 0);
  }],
  ['robots.txt asks search engines not to list the site', () => {
    assert.match(readFileSync(join(LIVE_OUTPUT, 'robots.txt'), 'utf8'), /^User-agent: \*\nDisallow: \/$/m);
  }],
  ['firebase.json and .firebaserc: ag2-dev-thomas, build/ with every address to index.html, pages not cached, hashed files cached, and the rules', () => {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
    assert.equal(JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default, 'ag2-dev-thomas');
    assert.equal(config.hosting.public, LIVE_OUTPUT);
    assert.deepEqual(config.hosting.rewrites, [{ source: '**', destination: '/index.html' }]);
    const header = (/** @type {string} */ source) =>
      config.hosting.headers.find((/** @type {{ source: string }} */ rule) => rule.source === source)?.headers.find((/** @type {{ key: string }} */ h) => h.key === 'Cache-Control')?.value;
    assert.equal(header('**'), 'no-cache', 'index.html and the pages: checked every time');
    assert.equal(header('/_app/immutable/**'), 'public, max-age=31536000, immutable', 'files whose names change when they do');
    assert.equal(config.firestore.rules, 'firestore.rules');
    assert.match(readFileSync('firestore.rules', 'utf8'), /function isNorthumbria\(\)/, 'the Northumbria-only rules go with it');
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (err).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
console.log(`\n${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${LIVE_OUTPUT}/`);
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
