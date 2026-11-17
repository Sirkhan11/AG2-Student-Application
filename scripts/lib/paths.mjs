// Path helpers for scripts that write private files (such as a society or sport club pages file),
// which must never land inside the repo. Used by collect-nsu-societies.mjs (through nsu-collect.mjs)
// and import-sport-club-pages.mjs.

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * The full path for a file the user names, with a leading ~ meaning their home folder.
 * @param {string} path
 */
export function expandHome(path) {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : resolve(path);
}

/**
 * True if the path is inside the folder (following symbolic links), so the private pages file
 * can never be written into the repo. Works for files and folders that don't exist yet.
 * @param {string} path
 * @param {string} folder
 */
export function isInside(path, folder) {
  /** @param {string} target the real path of the nearest part that exists, plus the rest */
  const real = (target) => {
    let existing = target;
    const rest = [];
    for (;;) {
      try {
        return join(realpathSync(existing), ...rest.reverse());
      } catch {
        const parent = dirname(existing);
        if (parent === existing) return target;
        rest.push(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
        existing = parent;
      }
    }
  };
  const target = real(isAbsolute(path) ? path : resolve(path));
  const root = real(resolve(folder));
  return target === root || target.startsWith(root + sep);
}
