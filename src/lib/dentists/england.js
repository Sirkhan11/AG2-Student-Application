// The NHS dental practices that the finder's Dentist tab searches (src/routes/gp-finder): every active
// NHS dental practice in England, from NHS England's Organisation Data Service (the "egdpprac" report),
// placed with postcodes.io. The North East's are part of the page (north-east.json); the rest of
// England is static/dentists/england.tsv, loaded only when a search lands outside the North East, and
// that request is the same for everyone. scripts/refresh-dental-practices.mjs writes both.
// No Firebase or network here, so the checks can use it in Node.

/** The England file's columns, in order. Lines starting with # are notes (source and licence). */
export const DENTIST_COLUMNS = ['code', 'name', 'address', 'postcode', 'lat', 'lng'];

/**
 * A practice, in the shape the GP finder's search works with. The report has no phone number, email or
 * website for dental practices: the practice's NHS page has its phone number (dentistPageUrl).
 * @typedef {{ code: string, name: string, address: string, postcode: string, phone: null, email: null,
 *   website: null, lat: number, lng: number }} DentalPractice
 */

/**
 * A practice as north-east.json keeps it.
 * @param {{ code: string, name: string, address: string, postcode: string, lat: number, lng: number }} saved
 * @returns {DentalPractice}
 */
export const asPractice = (saved) => ({ ...saved, phone: null, email: null, website: null });

/**
 * The practices in the England file's text.
 * @param {string} text
 * @returns {DentalPractice[]}
 */
export function parseDentistFile(text) {
  const lines = text.split('\n').filter((line) => line && !line.startsWith('#'));
  if (lines[0] !== DENTIST_COLUMNS.join('\t')) throw new Error('The England dentist file has unexpected columns');
  return lines.slice(1).map((line) => {
    const [code, name, address, postcode, lat, lng] = line.split('\t');
    return asPractice({ code, name, address, postcode, lat: Number(lat), lng: Number(lng) });
  });
}

/**
 * The practice's page on the NHS website, which says whether it's taking new NHS patients and has its
 * phone number. The NHS website knows a practice by its ODS code's digits, six of them, after XV
 * (V12345 is XV012345); the part before that can be anything, as the NHS website goes on to the page
 * under the practice's own name.
 * @param {{ code: string }} practice
 */
export const dentistPageUrl = (practice) => `https://www.nhs.uk/services/dentist/dentist/XV${practice.code.slice(1).padStart(6, '0')}`;
