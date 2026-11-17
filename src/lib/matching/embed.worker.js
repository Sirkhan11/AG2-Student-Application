// The matching model's worker (started by embed.js): the model downloads, loads and turns text into
// numbers here, off the page, so the page never freezes while it loads. Each message is one call,
// { id, type: 'download' | 'load' | 'embed', text }, answered with { id, ok, vector } or
// { id, ok: false, message }. A download is a load here: the page stops this worker afterwards,
// which lets go of the model's memory.

import { embed, loadModel } from '#lib/matching/embed.js';

self.onmessage = async (/** @type {MessageEvent<{ id: number, type: string, text: string }>} */ event) => {
  const { id, type, text } = event.data;
  try {
    const vector = type === 'embed' ? await embed(text) : (await loadModel(), null);
    self.postMessage({ id, ok: true, vector });
  } catch (err) {
    self.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
