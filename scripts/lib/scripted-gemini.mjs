// A made-up Gemini for the checks, in Node: each request gets the next scripted answer, as the
// Firebase SDK gives it (response.candidates, response.text()). An answer is text, or tool calls
// (function calling); a function decides from the request. Every request is kept, so a check can see
// exactly what the chat sent (and that Gemini would accept it: unknownFields).

/**
 * One scripted answer: a reply ({ text }), tool calls ({ calls: [{ name, args }] }), a block
 * ({ blocked: true }), a thrown error ({ error }), or a function of the request returning one of those.
 * @typedef {{ text: string } | { calls: { name: string, args?: Record<string, unknown> }[] } | { blocked: true } | { error: Error }
 *   | ((request: any) => any)} Scripted
 */

/**
 * @param {Scripted[]} script the answers, in order (with none left, it says "Thanks for telling me.")
 */
export function scriptedGemini(script = []) {
  /** @type {any[]} */
  const requests = [];
  const queue = [...script];
  return {
    requests,
    /** Adds answers to the end. @param {...Scripted} more */
    then: (...more) => void queue.push(...more),
    model: {
      /** @param {any} request */
      async generateContent(request) {
        // Kept as it goes over the wire: the real SDK strips its own "type" from every part first.
        const wire = JSON.parse(JSON.stringify(request));
        for (const content of [...(wire.contents ?? []), ...(typeof wire.systemInstruction === 'object' ? [wire.systemInstruction] : [])]) {
          for (const part of content.parts ?? []) delete part.type;
        }
        requests.push(wire);
        let next = queue.shift() ?? { text: 'Thanks for telling me.' };
        if (typeof next === 'function') next = next(request);
        if ('error' in next) throw next.error;
        if ('blocked' in next) return { response: { promptFeedback: { blockReason: 'SAFETY' }, candidates: [], text: () => '' } };
        const parts = 'calls' in next
          ? next.calls.map((call, i) => ({ functionCall: { name: call.name, args: call.args ?? {} }, ...(i === 0 ? { thoughtSignature: 'made-up-signature' } : {}) }))
          : [{ text: next.text }];
        return {
          response: {
            candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
            text: () => parts.map((part) => ('text' in part ? part.text : '')).join('')
          }
        };
      }
    }
  };
}
