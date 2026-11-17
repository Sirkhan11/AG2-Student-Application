// The live build's stand-in for api.js (vite.config.ts swaps it in). The live site is static, with no
// server routes, and Blackboard waits for IT to register AG2, so there's nothing to load, connect or
// disconnect there, and none of the Blackboard requests are in the live site's files.

/** @returns {Promise<null>} */
export async function loadBlackboard() {
  return null;
}

export async function connectBlackboard() {
  throw new Error('Blackboard isn’t available on this site yet.');
}

export async function disconnectBlackboard() {}
