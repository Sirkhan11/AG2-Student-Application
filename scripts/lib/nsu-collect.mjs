// The parts of scripts/collect-nsu-societies.mjs that don't touch the network: reading NSU's API and
// pages, turning them into the two data files, comparing with the last list, and the checks before
// anything is written. Ported from the reference crawl (Chrome) and process_nsu.py used on 17 November
// 2026, except that the A to Z list now comes from the API NSU's own A to Z page uses (one request
// gives every society's id, name, picture and category). Tested with made-up data by
// scripts/check-collect-nsu.mjs.
//
// Personal data: a society page's "Email Society" address is usually a committee member's own, and
// some descriptions name committee members. Those only ever go into the pages file (kept outside
// the repo, imported into Firestore by hand). Nothing here prints a description or an email, and
// emails written inside descriptions are replaced with a note rather than collected.

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { DOMParser } from 'linkedom';

export const ORIGIN = 'https://mynsu.co.uk';
/** NSU's A to Z page: it holds the API's site id and NSU's category map. Also the list file's "source". */
export const LIST_URL = `${ORIGIN}/Activities/home`;
export const SOURCE_URL = `${ORIGIN}/Activities/home#find`;
/** The API NSU's pages use (SUMS, NSU's website provider). */
export const API_URL = 'https://pluto.sums.digital/api';
/** NSU's own A to Z leaves this category out, so the list does too. */
const LEFT_OUT_CATEGORY = 'Adopt a Society';
/** Names the project, so NSU can see who's asking. No personal contact details. */
export const USER_AGENT = 'AG2StudentApp-NSU-refresh/1.0 (Northumbria University student project)';

/** The fewest societies a real A to Z page has had (154 in November 2026), and the share of society pages that must parse. */
export const MIN_SOCIETIES = 140;
export const MIN_PARSED_SHARE = 0.95;

/** NSU's own placeholder picture, shown when a society has none. */
const PLACEHOLDER = /\/WebsiteImages\/url_preview\/nsu_preview\.png$/;
/** Cloudflare shows a protected email as "[email protected]" (sometimes with a non-breaking space). */
const CF_PLACEHOLDER = /@?\[email(?:\s|&#160;)*protected\]/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const EMAIL_NOTE = '[email on their NSU page]';
/** NSU's own enquiries address appears on some society pages; it isn't the society's. */
const NSU_ENQUIRIES = /^su\.enquiries@/;
/** NSU's own capitalisation where it's better than a tidied card name (from process_nsu.py). */
const NAME_FIXES = {
  51: 'JAC-Dan',
  58: 'MARS (Mooting, Advocacy & Research Skills)',
  212: 'TechSphere Society',
  240: 'NetGen Engineering',
  290: 'PENSA'
};

const clean = (/** @type {string | null | undefined} */ text) => (text ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Reading NSU's pages

/**
 * Why a response means NSU's site (or Cloudflare in front of it) is refusing or challenging us, or
 * null if it looks like a normal answer. The run stops on any of these and never tries to get round
 * them. Cloudflare adds a "challenge-platform" script to ordinary pages too, so that alone isn't a sign.
 * @param {number} status
 * @param {{ get(name: string): string | null }} headers
 * @param {string} body
 */
export function blockedReason(status, headers, body) {
  if (status === 403 || status === 429 || status === 503) return `answered ${status}`;
  if (headers.get('cf-mitigated') === 'challenge') return 'sent a Cloudflare challenge';
  if (/<title>\s*(Just a moment|Attention Required)/i.test(body) || body.includes('_cf_chl_opt')) {
    return 'sent a Cloudflare challenge page';
  }
  return null;
}

/** @param {string} html */
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

/**
 * "CHILDHOOD & EARLY YEARS SOCIETY" becomes "Childhood & Early Years Society" (from the reference A to Z
 * script). Only used for names in capitals; names NSU already writes in mixed case are kept as they are.
 * @param {string} raw
 */
export function tidyName(raw) {
  if (/[a-z]/.test(raw)) return raw;
  const small = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'at', 'to', 'a', 'an']);
  const acronyms = new Set(['tv', 'dj', 'f1', 'uk', 'lgbtq+', 'medlife']);
  return raw
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((part, i) => {
      if (!/[a-z]/.test(part)) return part;
      if (acronyms.has(part)) return part.toUpperCase();
      if (i > 0 && small.has(part)) return part;
      return part.replace(/[a-z]/, (c) => c.toUpperCase());
    })
    .join('');
}

/**
 * What NSU's A to Z page gives the API, both set by an inline script: the site id the API needs (sent
 * as X-Site-Id), and NSU's category map, which names each category id and its campus. The list asks
 * for every category except "Adopt a Society", as NSU's own page does. Null if either is missing.
 * @param {string} html
 * @returns {{ siteId: string, categories: Map<string, { category: string, campus: string }>, requestIds: string[] } | null}
 */
export function parseSiteSettings(html) {
  const siteId = html.match(/\bsiteId\s*=\s*['"]([A-Za-z0-9-]+)['"]/)?.[1];
  const mapText = html.match(/categoryMap\s*=\s*(\{[\s\S]*?\})\s*;/)?.[1];
  if (!siteId || !mapText) return null;
  /** @type {Map<string, { category: string, campus: string }>} */
  const categories = new Map();
  /** @type {string[]} */
  const requestIds = [];
  for (const [, category, inner] of mapText.matchAll(/['"]([^'"]+)['"]\s*:\s*\{([^}]*)\}/g)) {
    const newcastle = inner.match(/newcastle\s*:\s*['"]?(\d+)/)?.[1];
    const london = inner.match(/london\s*:\s*['"]?(\d+)/)?.[1];
    for (const [id, campus] of /** @type {[string | undefined, string][]} */ ([[newcastle, 'Newcastle'], [london, 'London']])) {
      if (!id) continue;
      categories.set(id, { category, campus });
      if (category !== LEFT_OUT_CATEGORY) requestIds.push(id);
    }
  }
  return categories.size ? { siteId, categories, requestIds } : null;
}

/**
 * The address of one page of NSU's society list, asked for exactly as NSU's A to Z page asks.
 * @param {string[]} requestIds
 * @param {number} page
 */
export function groupsUrl(requestIds, page) {
  return `${API_URL}/groups?perPage=300&page=${page}&sortBy=name&categoryIds=${encodeURIComponent(requestIds.join(','))}`;
}

/**
 * @typedef {{ nsuId: number, name: string, thumbnail: string | null, category: string | null,
 *   campus: string | null }} Group
 */

/**
 * The societies in one page of the groups API's answer: id, NSU's name, picture, and category and
 * campus from NSU's map. Category ids the map doesn't know are reported, so the run can stop.
 * @param {any} json
 * @param {Map<string, { category: string, campus: string }>} categories
 * @returns {{ groups: Group[], unknownCategoryIds: string[] }}
 */
export function groupsFrom(json, categories) {
  /** @type {Group[]} */
  const groups = [];
  const unknown = new Set();
  for (const item of Array.isArray(json?.data) ? json.data : []) {
    if (!Number.isInteger(item?.id) || !clean(item?.name)) continue;
    const place = categories.get(String(item.activity_category_id));
    if (!place) unknown.add(String(item.activity_category_id));
    groups.push({
      nsuId: item.id,
      name: clean(item.name),
      thumbnail: typeof item.thumbnail_url === 'string' && item.thumbnail_url.startsWith('https://') ? item.thumbnail_url : null,
      category: place?.category ?? null,
      campus: place?.campus ?? null
    });
  }
  return { groups, unknownCategoryIds: [...unknown] };
}

/**
 * The address of one page of NSU's products (memberships, tickets and so on), 100 at a time.
 * @param {number} page
 */
export function productsUrl(page) {
  return `${API_URL}/products?perPage=100&page=${page}`;
}

/**
 * Each society's memberships, from the products API's full list. Products name their society by
 * group_name, which is matched to the society's name as the API writes it. Products whose name says
 * "member" count; tickets never do. Names shared by two societies can't be matched, so they're reported.
 * @param {any[]} products
 * @param {Group[]} groups
 * @returns {{ memberships: Map<number, { name: string, price: number }[]>, sharedNames: string[] }}
 */
export function membershipsByGroup(products, groups) {
  /** @type {Map<string, number | null>} */
  const idByName = new Map();
  for (const group of groups) {
    const key = group.name.toLowerCase();
    idByName.set(key, idByName.has(key) ? null : group.nsuId);
  }
  /** @type {Map<number, { name: string, price: number }[]>} */
  const memberships = new Map(groups.map((group) => [group.nsuId, []]));
  for (const product of products) {
    const id = idByName.get(clean(product?.group_name).toLowerCase());
    const name = clean(product?.name);
    const price = Number(product?.price);
    if (id === undefined || id === null || product?.is_event_ticket === true) continue;
    if (!/member/i.test(name) || /ticket/i.test(name) || !Number.isFinite(price) || price < 0) continue;
    memberships.get(id)?.push({ name, price });
  }
  const sharedNames = [...idByName].filter(([, id]) => id === null).map(([name]) => name);
  return { memberships, sharedNames };
}

/**
 * Decodes a Cloudflare-protected email: the first byte is a key that every other byte is XORed with.
 * @param {string} hex
 */
export function cfDecode(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  const bytes = [];
  for (let i = 2; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Everything the app uses from one society page, plus what's needed for the review notes. Read
 * exactly as the reference crawl read it in Chrome (same selectors).
 * @param {string} html
 * @param {number} nsuId
 */
export function parseSocietyPage(html, nsuId) {
  const doc = parse(html);
  const crumb = clean(doc.querySelector('p.breadcrumb-path')?.textContent);
  // The last part is "<Category> - <Campus> Campus", e.g. "Performance - Newcastle Campus".
  const last = crumb.split('/').pop()?.trim() ?? '';
  const parts = last.match(/^(.*?)\s+-\s+(.+?)(?:\s+Campus)?$/i);
  const paragraphs = [...doc.querySelectorAll('#section1 .card-body p, #section1 .card-body li, #section1 .card-body h2, #section1 .card-body h3, #section1 .card-body h4')]
    // Leaf elements only: a paragraph inside a list item is part of that item.
    .filter((element) => !element.closest('li') || element.tagName === 'LI')
    .map((element) => clean(element.textContent))
    .filter(Boolean);
  const links = [...doc.querySelectorAll('.society-social-links a[href]')].map((a) => (a.getAttribute('href') || '').trim());
  const emails = [...doc.querySelectorAll('.society-social-links a[href*="email-protection"]')]
    .map((a) => (a.getAttribute('href') || '').split('#')[1] || '')
    .filter((hex) => /^[0-9a-f]+$/i.test(hex))
    .map((hex) => cfDecode(hex).trim().toLowerCase())
    .filter((email) => email && !NSU_ENQUIRIES.test(email));
  const thumb = doc.querySelector('img[src*="group-thumbnails"]')?.getAttribute('src');
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || null;
  const name = clean(doc.querySelector('h1.society-name')?.textContent);
  return {
    nsuId,
    name,
    category: parts ? clean(parts[1]) : last || null,
    campus: parts ? clean(parts[2]) : null,
    // A page "parses" when the name and breadcrumb are where they should be. Far fewer than usual
    // means NSU changed their page layout, so the run stops (see checkBeforeWriting).
    parsed: Boolean(name && parts),
    url: `${ORIGIN}/activities/view/${nsuId}`,
    ogImage,
    thumbnail: thumb ? new URL(thumb, ORIGIN).href : null,
    headerImage: /header-images/.test(ogImage || '') ? ogImage : null,
    paragraphs,
    // Social links are the https links in the society's own box (NSU's footer accounts are elsewhere).
    socialLinks: links.filter((href) => /^https?:/i.test(href)),
    emails: [...new Set(emails)],
    hasCommittee: doc.querySelectorAll('.committee-list > *').length > 0
  };
}

/** @typedef {ReturnType<typeof parseSocietyPage>} SocietyPage */

// ---------------------------------------------------------------------------------------------
// Social links (ported from process_nsu.py)

/** @type {[string, RegExp][]} */
const PLATFORMS = [
  ['instagram', /(^|\.)instagram\./],
  ['tiktok', /(^|\.)tiktok\./],
  ['facebook', /(^|\.)(facebook|fb)\./],
  ['x', /(^|\.)twitter\.|^x\.com$/],
  ['discord', /(^|\.)discord(app)?\./],
  ['linktree', /(^|\.)linktr\.ee$/],
  ['youtube', /(^|\.)youtube\.|^youtu\.be$/],
  ['whatsapp', /(^|\.)whatsapp\.|^wa\.me$/],
  ['linkedin', /(^|\.)linkedin\./]
];

/**
 * Which platform a link is on, from its host ("website" for anything else). Unlike the reference,
 * hosts are matched from the start or after a dot, so "dropbox.com" isn't X.
 * @param {string} url
 */
export function platformOf(url) {
  const host = url.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').split('/')[0];
  return PLATFORMS.find(([, pattern]) => pattern.test(host))?.[0] ?? 'website';
}

/**
 * Repairs a link where a full address was typed into NSU's handle box, such as
 * https://instagram.com/instagram.com/name or https://instagram.com/https://www.instagram.com/name/,
 * and drops share-tracking parameters such as ?igsh=… or &utm_source=qr.
 * @param {string} url
 */
export function fixSocialUrl(url) {
  const doubled = url.match(/^(https?:\/\/[^/]+)\/+(?:https?:\/+)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})\/+(.*)$/i);
  if (doubled && platformOf(doubled[2]) === platformOf(doubled[1])) url = `${doubled[1]}/${doubled[3]}`.replace(/\/+$/, '');
  const at = url.indexOf('?');
  if (at === -1) return url;
  const kept = url
    .slice(at + 1)
    .split('&')
    .filter((part) => part && !/^(igsh|igsi|utm_[a-z]+|mibextid|si|fbclid)=/i.test(part));
  return url.slice(0, at).replace(/\/+$/, '') + (kept.length ? `?${kept.join('&')}` : '');
}

/** The account name in a social link, for spotting the same account twice. @param {string} url */
function handleOf(url) {
  const path = url.toLowerCase().replace(/^(?:https?:\/\/)?[^/]+\//, '').replace(/^\/+|\/+$/g, '');
  return path.split('?')[0].split('/')[0].replace(/^@+/, '');
}

const PLATFORM_WORDS = /\b(instagram|insta|ig|tik ?tok|facebook|fb)\b/gi;
const HANDLE = /(?<![\w.])@([A-Za-z0-9_](?:[A-Za-z0-9._]{1,28}[A-Za-z0-9_])?)(?![\w@])/g;
const LINK = /(?:https?:\/\/|www\.)[^\s)\]]+|(?:chat\.whatsapp\.com|discord\.gg|linktr\.ee)\/[^\s)\]]+/gi;
/** @type {Record<string, (handle: string) => string>} */
const PROFILE_URL = {
  instagram: (handle) => `https://instagram.com/${handle}`,
  tiktok: (handle) => `https://tiktok.com/@${handle}`,
  facebook: (handle) => `https://facebook.com/${handle}`
};
/** One-off trip booking pages, not a society's own site. */
const SKIP_DOMAINS = ['nucotravel.com'];

/**
 * Social accounts and group links a society wrote in its description but didn't add as a link:
 * written-out links, and @handles that follow a platform's name ("insta: @oursoc").
 * @param {string[]} paragraphs
 * @returns {{ platform: string, url: string }[]}
 */
export function socialsInDescription(paragraphs) {
  const found = [];
  for (const text of paragraphs) {
    for (const match of text.matchAll(LINK)) {
      const link = match[0].replace(/[.,!;:]+$/, '');
      if (SKIP_DOMAINS.some((domain) => link.toLowerCase().includes(domain))) continue;
      const url = /^http/i.test(link) ? link : `https://${link}`;
      found.push({ platform: platformOf(url), url });
    }
    for (const match of text.matchAll(HANDLE)) {
      const before = text.slice(Math.max(0, /** @type {number} */ (match.index) - 80), match.index);
      const words = [...before.matchAll(PLATFORM_WORDS)].map((word) => word[1]);
      if (!words.length) continue;
      const word = words[words.length - 1].toLowerCase().replace(' ', '');
      const platform = /** @type {Record<string, string>} */ ({ insta: 'instagram', ig: 'instagram', fb: 'facebook' })[word] ?? word;
      if (PROFILE_URL[platform]) found.push({ platform, url: PROFILE_URL[platform](match[1].replace(/\.+$/, '')) });
    }
  }
  return found;
}

/**
 * The society's listed links (repaired) followed by any found in its description, each account once.
 * Only https links are kept: the pages file and the app only use https.
 * @param {string[]} listed
 * @param {{ platform: string, url: string }[]} fromDescription
 */
export function mergeSocials(listed, fromDescription) {
  const merged = [];
  const seen = new Set();
  const all = [...listed.map((url) => ({ platform: platformOf(url), url: fixSocialUrl(url) })), ...fromDescription];
  for (const social of all) {
    if (!/^https:\/\//i.test(social.url)) continue;
    const key = `${social.platform} ${social.platform === 'website' ? social.url.toLowerCase().replace(/\/+$/, '') : handleOf(social.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(social);
  }
  return merged;
}

/**
 * A description paragraph with emails replaced by a note: Cloudflare's "[email protected]"
 * placeholders and any address written out in full.
 * @param {string} text
 */
export function cleanParagraph(text) {
  return text.replace(CF_PLACEHOLDER, EMAIL_NOTE).replace(EMAIL, EMAIL_NOTE);
}

// ---------------------------------------------------------------------------------------------
// Building the two files

/**
 * @typedef {{ nsuId: number, name: string, category: string | null, campus: string, url: string,
 *   image: string | null }} ListEntry
 * @typedef {{ source: string, collectedAt: string, count: number, categories: string[], societies: ListEntry[] }} ListFile
 */

/** Lower case with letters and digits only, and no "society" or campus words, for spotting renames. @param {string} name */
export function nameKey(name) {
  return name
    .toLowerCase()
    .replace(/\b(society|soc|london|campus)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Turns NSU's society list (from the API) and, on a laptop run, each society's page and memberships
 * into the public list, the private pages file and review notes for a person.
 * - Names already on the last list are kept (they include hand tidying); new societies get NSU's
 *   name. A name NSU now writes differently is only reported, so a person can decide whether it's a
 *   real rename.
 * - Pictures: the API's thumbnail, else the society page's picture. Without pages (the workflow),
 *   a society the API has no thumbnail for keeps its last picture, as the pages weren't checked.
 * Without pages there's no pages file, and only the list's own notes.
 * @param {Group[]} groups
 * @param {Map<number, SocietyPage> | null} pages null when the pages weren't read
 * @param {Map<number, { name: string, price: number }[]> | null} memberships null when not read
 * @param {ListFile | null} lastList
 * @param {string} collectedAt
 */
export function buildFiles(groups, pages, memberships, lastList, collectedAt) {
  const last = new Map((lastList?.societies ?? []).map((society) => [society.nsuId, society]));
  /** @type {string[]} */
  const review = [];
  /** @type {{ nsuId: number, ours: string, nsu: string }[]} */
  const possibleRenames = [];
  /** @type {ListEntry[]} */
  const societies = [];
  /** @type {Record<string, object>} */
  const pagesOut = {};

  for (const group of groups) {
    const before = last.get(group.nsuId);
    const name = before?.name ?? /** @type {Record<number, string>} */ (NAME_FIXES)[group.nsuId] ?? tidyName(group.name);
    if (before && nameKey(group.name) !== nameKey(before.name)) possibleRenames.push({ nsuId: group.nsuId, ours: before.name, nsu: group.name });
    const url = `${ORIGIN}/activities/view/${group.nsuId}`;
    const page = pages?.get(group.nsuId) ?? null;

    const pagePicture = page && (page.thumbnail || page.headerImage || (page.ogImage && !PLACEHOLDER.test(page.ogImage) ? page.ogImage : null));
    const picture = group.thumbnail ?? (pages ? pagePicture || null : before?.image ?? null);
    if (pages && !picture) review.push(`${group.nsuId} ${name}: no picture on the NSU page`);

    societies.push({
      nsuId: group.nsuId,
      name,
      category: group.category ?? before?.category ?? null,
      campus: group.campus ?? before?.campus ?? 'Newcastle',
      url,
      image: picture
    });
    if (!pages || !page) continue;

    if (!page.parsed) review.push(`${group.nsuId} ${name}: NSU's page didn't have the name and breadcrumb where expected`);
    let description = page.paragraphs.map(cleanParagraph);
    if (description.join('').length < 20) {
      review.push(`${group.nsuId} ${name}: no description on the NSU page`);
      description = [];
    }

    const offered = memberships?.get(group.nsuId) ?? [];
    if (offered.length === 0) review.push(`${group.nsuId} ${name}: no membership on sale on the NSU page`);

    const email = page.emails[0] ?? null;
    const domain = email?.split('@')[1] ?? '';
    if (domain && domain !== 'northumbria.ac.uk' && /^north\w*\.ac\.uk$/.test(domain)) {
      review.push(`${group.nsuId} ${name}: the society's email on the NSU page has a typo in the domain (${domain}), so it will bounce`);
    }

    const socials = mergeSocials(page.socialLinks, socialsInDescription(page.paragraphs));
    for (const link of page.socialLinks) {
      if (!/^https:\/\//i.test(link)) review.push(`${group.nsuId} ${name}: a social link isn't https, so it was left out (${platformOf(link)})`);
      else if (fixSocialUrl(link) !== link) review.push(`${group.nsuId} ${name}: broken social link on the NSU page, repaired (${platformOf(link)})`);
    }
    const listedUrls = new Set(page.socialLinks.map(fixSocialUrl));
    for (const social of socials) {
      if (!listedUrls.has(social.url)) review.push(`${group.nsuId} ${name}: added a ${social.platform} link written in the description`);
    }
    if (page.hasCommittee) review.push(`${group.nsuId} ${name}: NSU now shows committee members (not collected)`);

    pagesOut[String(group.nsuId)] = {
      name,
      description,
      headerImage: page.headerImage,
      socials,
      memberships: offered,
      eventsUrl: `${url}#events`,
      email,
      committee: []
    };
  }

  // The same order as before: by name, ignoring capitals.
  societies.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  const list = {
    source: SOURCE_URL,
    collectedAt,
    count: societies.length,
    categories: [...new Set(societies.map((society) => society.category).filter((category) => category !== null))].sort(),
    societies
  };
  const pagesFile = pages
    ? {
        source: SOURCE_URL,
        collectedAt,
        note:
          'Copied from each society\'s page on mynsu.co.uk, for Firestore (societies/{nsuId}). Personal data: email is the ' +
          'page\'s Email Society address, usually a committee member\'s own, and some descriptions name committee members. ' +
          'Keep this file out of the repo. committee is empty because NSU\'s Committee tab is empty. Emails written inside ' +
          'descriptions are replaced with a note and not collected.',
        count: Object.keys(pagesOut).length,
        societies: pagesOut
      }
    : null;
  return { list, pagesFile, review, possibleRenames };
}

// ---------------------------------------------------------------------------------------------
// Comparing with the last list, and checking before writing

/**
 * True when two lists hold the same societies, categories and so on (the date doesn't count).
 * @param {ListFile | null} a
 * @param {ListFile} b
 */
export function sameList(a, b) {
  if (!a) return false;
  const strip = (/** @type {ListFile} */ list) => JSON.stringify({ ...list, collectedAt: null });
  return strip(a) === strip(b);
}

/**
 * What changed since the last list, for a person to check: new, removed and possibly renamed
 * societies, and campus, category and picture changes. Names, categories and campuses only.
 * @param {ListFile | null} lastList
 * @param {ListFile} list
 * @param {{ nsuId: number, ours: string, nsu: string }[]} possibleRenames
 */
export function listChanges(lastList, list, possibleRenames) {
  const before = new Map((lastList?.societies ?? []).map((society) => [society.nsuId, society]));
  const after = new Map(list.societies.map((society) => [society.nsuId, society]));
  const describe = (/** @type {ListEntry} */ society) => `${society.name} (${society.category ?? 'no category'}, ${society.campus})`;
  return {
    added: list.societies.filter((society) => !before.has(society.nsuId)).map((society) => `${describe(society)}, id ${society.nsuId}`),
    removed: [...before.values()].filter((society) => !after.has(society.nsuId))
      .map((society) => `${society.name}, id ${society.nsuId}: delete societies/${society.nsuId} in the Firestore console`),
    renamed: possibleRenames.map(({ nsuId, ours, nsu }) => `id ${nsuId}: NSU now says "${nsu}"; the list still says "${ours}"`),
    campus: list.societies.filter((society) => before.has(society.nsuId) && before.get(society.nsuId)?.campus !== society.campus)
      .map((society) => `${society.name}: ${before.get(society.nsuId)?.campus} to ${society.campus}`),
    category: list.societies.filter((society) => before.has(society.nsuId) && before.get(society.nsuId)?.category !== society.category)
      .map((society) => `${society.name}: ${before.get(society.nsuId)?.category ?? 'none'} to ${society.category ?? 'none'}`),
    pictures: list.societies.filter((society) => before.has(society.nsuId) && before.get(society.nsuId)?.image !== society.image).length
  };
}

/**
 * The change summary as Markdown, for the console and the pull request. Only names, categories,
 * campuses and counts, and anything shaped like an email is masked anyway.
 * @param {ReturnType<typeof listChanges>} changes
 * @param {{ societies: number, requests: number, pages: { parsed: number, withDescription: number, withEmail: number,
 *   socials: number, memberships: number } | null }} counts pages is null when the pages weren't read
 */
export function summaryText(changes, counts) {
  const lines = [`NSU's A to Z has ${counts.societies} societies (${counts.requests} requests to NSU's site and API).`];
  if (counts.pages) {
    const { parsed, withDescription, withEmail, socials, memberships } = counts.pages;
    lines.push(`Pages: ${parsed} read as expected; ${withDescription} with a description, ${withEmail} with a contact email, ${socials} social links, ${memberships} memberships.`);
  }
  lines.push('');
  /** @param {string} heading @param {string[]} items */
  const section = (heading, items) => {
    if (!items.length) return;
    lines.push(`${heading} (${items.length}):`, ...items.map((item) => `- ${item}`), '');
  };
  section('New societies', changes.added);
  section('No longer on NSU\'s list (not deleted from Firestore)', changes.removed);
  section('Names NSU now writes differently (the list keeps ours; change it by hand if it\'s a real rename)', changes.renamed);
  section('Campus changes', changes.campus);
  section('Category changes', changes.category);
  if (changes.pictures) lines.push(`Pictures changed: ${changes.pictures}`, '');
  const nothing = !changes.added.length && !changes.removed.length && !changes.campus.length && !changes.category.length && !changes.pictures;
  if (nothing) lines.push('The list hasn\'t changed.');
  return maskEmails(lines.join('\n').trim());
}

/** Masks anything shaped like an email address, as a last guard on everything printed. @param {string} text */
export function maskEmails(text) {
  return text.replace(EMAIL, '[email]');
}

/**
 * The checks that must all pass before anything is written. Returns the problems (empty if none).
 * parsed is null when the society pages weren't read (the workflow), so there's nothing to check there.
 * @param {{ societies: number, parsed: number | null, pageErrors: string[] }} result
 */
export function checkBeforeWriting({ societies, parsed, pageErrors }) {
  const problems = [];
  if (societies < MIN_SOCIETIES) {
    problems.push(`only ${societies} societies in NSU's list (at least ${MIN_SOCIETIES} expected), so something may have changed`);
  }
  if (parsed !== null && societies > 0 && parsed / societies < MIN_PARSED_SHARE) {
    problems.push(`only ${parsed} of ${societies} society pages read as expected, so NSU may have changed their page layout`);
  }
  if (pageErrors.length) problems.push(`the pages file doesn't pass the import's checks: ${pageErrors.slice(0, 5).join('; ')}`);
  return problems;
}

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
