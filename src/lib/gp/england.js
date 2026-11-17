// The all-England GP list (static/gp/england.tsv): every active GP practice in England, one per line,
// tab-separated. The GP finder loads it only when a search lands outside the North East list, and the
// request is the same for everyone (it never says where they are). refresh-gp-practices.mjs writes it.
// No Firebase or network here, so the checks can use it in Node.

/** The columns, in order. Lines starting with # are notes (source and licence). */
export const ENGLAND_COLUMNS = ['code', 'name', 'address', 'postcode', 'phone', 'lat', 'lng'];

/**
 * @typedef {{ code: string, name: string, address: string, postcode: string, phone: string | null,
 *   email: null, website: null, lat: number, lng: number }} EnglandPractice
 */

/**
 * The practices in the file's text.
 * @param {string} text
 * @returns {EnglandPractice[]}
 */
export function parseEnglandFile(text) {
  const lines = text.split('\n').filter((line) => line && !line.startsWith('#'));
  if (lines[0] !== ENGLAND_COLUMNS.join('\t')) throw new Error('The England GP file has unexpected columns');
  return lines.slice(1).map((line) => {
    const [code, name, address, postcode, phone, lat, lng] = line.split('\t');
    return { code, name, address, postcode, phone: phone || null, email: null, website: null, lat: Number(lat), lng: Number(lng) };
  });
}
