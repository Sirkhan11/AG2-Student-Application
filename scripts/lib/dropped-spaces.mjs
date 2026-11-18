// Finds the spaces Svelte 5 drops between running text and a block. Svelte removes the whitespace at
// the start and end of every {#if}, {#each}, {#key} and {#await} branch, so a space written there
// never reaches the page: `introduce you.{#if often} You asked…{/if}` shows "introduce you.You
// asked…". That was on Home's mentor card on 18 November (agent1.md A9), and two Societies pages had
// it too. The same goes for a space at either edge of an each's body: the items run together. Put the
// space outside the block, or write it as {' '}, which Svelte keeps.

import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';

/** Elements that sit inside a line of text, so a space next to them is part of the sentence. */
const INLINE = new Set(['a', 'abbr', 'b', 'cite', 'code', 'em', 'i', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u']);

/** @typedef {{ type: string, data?: string, name?: string, start: number, end: number, elseif?: boolean, [key: string]: any }} Node */

/** Whether a node is part of a line of text. @param {Node | undefined} node */
const inline = (node) => node?.type === 'ExpressionTag' || node?.type === 'HtmlTag' || (node?.type === 'RegularElement' && INLINE.has(/** @type {string} */ (node.name)));

/**
 * Whether the node next to a block carries on the same line of text with no space of its own, so a
 * space at that edge of the block is the only one there. Punctuation straight after a block needs none.
 * @param {Node | undefined} node @param {'before' | 'after'} side
 */
function touches(node, side) {
  if (node?.type === 'Text') return side === 'before' ? /\S$/.test(node.data ?? '') : /^[^\s.,;:!?)’”]/.test(node.data ?? '');
  return inline(node);
}

/** A block's branches: each of an if's, else-if's and else's, an each's and its else, and so on. @param {Node} block @returns {{ nodes: Node[] }[]} */
function branches(block) {
  if (block.type === 'IfBlock') {
    const alternate = block.alternate?.nodes.filter((/** @type {Node} */ node) => node.type !== 'Text' || node.data?.trim());
    if (alternate?.length === 1 && alternate[0].type === 'IfBlock' && alternate[0].elseif) return [block.consequent, ...branches(alternate[0])];
    return [block.consequent, block.alternate].filter(Boolean);
  }
  if (block.type === 'EachBlock') return [block.body, block.fallback].filter(Boolean);
  if (block.type === 'AwaitBlock') return [block.pending, block.then, block.catch].filter(Boolean);
  return block.type === 'KeyBlock' ? [block.fragment] : [];
}

/**
 * Whether a branch starts (or ends) with a space that Svelte will drop: one before (or after) words,
 * or a space on its own beside something inline on the same line. A line break between elements is
 * only how the file is laid out, so it isn't counted.
 * @param {Node[]} nodes @param {'start' | 'end'} edge
 */
function spaceAt(nodes, edge) {
  const [text, next] = edge === 'start' ? [nodes[0], nodes[1]] : [nodes.at(-1), nodes.at(-2)];
  if (text?.type !== 'Text' || !(edge === 'start' ? /^\s/ : /\s$/).test(text.data ?? '')) return false;
  return Boolean(text.data?.trim()) || (!text.data?.includes('\n') && inline(next));
}

/** @typedef {{ file: string, line: number, edge: 'start' | 'end' | 'between', near: string }} Dropped */

/**
 * Every place in one Svelte component's source where a space between running text and a block would
 * be dropped.
 * @param {string} source the component's source
 * @param {string} [file] its name, for the report
 * @returns {Dropped[]}
 */
export function droppedSpacesIn(source, file = 'component') {
  /** @type {Dropped[]} */
  const found = [];
  const lineAt = (/** @type {number} */ at) => source.slice(0, at).split('\n').length;
  /** @param {{ nodes?: Node[] } | null | undefined} fragment */
  const walk = (fragment) => {
    const nodes = fragment?.nodes ?? [];
    nodes.forEach((node, i) => {
      if (['IfBlock', 'EachBlock', 'AwaitBlock', 'KeyBlock'].includes(node.type) && !node.elseif) {
        for (const branch of branches(node)) {
          const first = branch.nodes[0];
          const last = /** @type {Node} */ (branch.nodes.at(-1));
          // The items of an each sit side by side, so a space at either edge of its body is the only one between them.
          if (branch === node.body && node.type === 'EachBlock' && (spaceAt(branch.nodes, 'start') || spaceAt(branch.nodes, 'end'))) {
            found.push({ file, line: lineAt(first.start), edge: 'between', near: source.slice(node.start, node.end).slice(0, 80) });
            continue;
          }
          if (touches(nodes[i - 1], 'before') && spaceAt(branch.nodes, 'start')) found.push({ file, line: lineAt(first.start), edge: 'start', near: source.slice(node.start, first.end).slice(0, 80) });
          if (touches(nodes[i + 1], 'after') && spaceAt(branch.nodes, 'end')) found.push({ file, line: lineAt(last.end), edge: 'end', near: source.slice(last.start, node.end).slice(-80) });
        }
      }
      for (const key of ['fragment', 'consequent', 'alternate', 'body', 'fallback', 'pending', 'then', 'catch']) if (node[key]?.nodes) walk(node[key]);
    });
  };
  walk(/** @type {{ nodes: Node[] }} */ (parse(source, { modern: true }).fragment));
  return found;
}

/**
 * Every place in these Svelte files where a space between running text and a block would be dropped.
 * @param {string[]} files
 * @returns {Dropped[]}
 */
export function droppedSpaces(files) {
  return files.flatMap((file) => droppedSpacesIn(readFileSync(file, 'utf8'), file));
}
