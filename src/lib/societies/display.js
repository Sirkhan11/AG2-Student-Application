// How a society's details are shown, shared by the society page (/societies/[nsuId]) and the
// society cards in the check-in chat. No Firebase here.

/** How each social platform is named on its button. */
const PLATFORMS = /** @type {Record<string, string>} */ ({
  instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok', youtube: 'YouTube',
  discord: 'Discord', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', spotify: 'Spotify', twitch: 'Twitch'
});

/**
 * A social platform's name as shown on its button, such as "TikTok"; others get a capital letter.
 * @param {string} platform
 */
export function platformName(platform) {
  return PLATFORMS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/**
 * A price in pounds, such as "£5.00", or "Free".
 * @param {number} price
 */
export function priceText(price) {
  return price === 0 ? 'Free' : pounds.format(price);
}
