/**
 * RSS feed monitor for Amex MR transfer bonus announcements.
 * Checks popular points/miles blogs for bonus transfer mentions.
 *
 * For v1: stub implementation. Returns empty array.
 */

const DEFAULT_FEEDS = [
  { name: "The Points Guy", url: "https://thepointsguy.com/feed/" },
  { name: "Doctor of Credit", url: "https://www.doctorofcredit.com/feed/" },
  { name: "One Mile at a Time", url: "https://onemileatatime.com/feed/" },
];

/**
 * Check RSS feeds for transfer bonus announcements.
 *
 * @param {Array<{ name: string, url: string }>} [feeds] - RSS feed URLs to check. Defaults to major points blogs.
 * @returns {Promise<Array<{ program: string, bonus_ratio: number, source_url: string, expires: string|null }>>}
 */
export async function checkBonusFeeds(feeds = DEFAULT_FEEDS) {
  // TODO: Implement RSS parsing and bonus detection.
  console.log("RSS monitoring: not yet implemented.");

  const bonuses = [];

  for (const feed of feeds) {
    const items = await fetchFeed(feed.url);
    const parsed = parseFeed(items);
    const detected = extractBonusMentions(parsed, feed);
    bonuses.push(...detected);
  }

  return bonuses;
}

/**
 * Fetch raw RSS feed content.
 * TODO: Implement with fetch() + XML parsing.
 *
 * @param {string} url - RSS feed URL
 * @returns {Promise<string>} raw XML string
 */
async function fetchFeed(url) {
  // TODO: fetch(url) and return response text
  return "";
}

/**
 * Parse RSS XML into structured items.
 * TODO: Implement XML parsing (consider a lightweight XML parser or regex for RSS).
 *
 * @param {string} xml - raw RSS XML
 * @returns {Array<{ title: string, link: string, pubDate: string, description: string }>}
 */
function parseFeed(xml) {
  // TODO: Parse <item> elements from RSS XML
  return [];
}

/**
 * Extract Amex MR transfer bonus mentions from parsed RSS items.
 * TODO: Implement keyword matching for "Amex", "transfer bonus", program names.
 *
 * @param {Array<{ title: string, link: string, pubDate: string, description: string }>} items
 * @param {{ name: string, url: string }} feed - feed metadata
 * @returns {Array<{ program: string, bonus_ratio: number, source_url: string, expires: string|null }>}
 */
function extractBonusMentions(items, feed) {
  // TODO: Match items containing "Amex" + "transfer bonus" + program names.
  // Parse bonus percentage from title/description (e.g., "30% bonus" -> 1.3 ratio).
  // Return structured bonus objects.
  return [];
}
