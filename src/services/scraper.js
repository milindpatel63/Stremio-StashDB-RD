const stashdb = require('./stashdb');
const cache = require('../cache');
const { normalizeTitleForSearch } = require('../utils/titleNormalize');

/**
 * Build discovery queries for torrent/magnet sources.
 * Uses StashDB scene metadata (studio, date, title) to construct search permutations.
 */
function buildDiscoveryQuery(scene) {
  const dateInfo = stashdb.formatDateForQuery(scene.date || scene.release_date);
  const studioName = stashdb.formatStudioName(scene.studio?.name);
  const title = scene.title ? String(scene.title).trim() : '';

  const parts = [];
  if (studioName && dateInfo) {
    parts.push(`${studioName}.${dateInfo.yy}.${dateInfo.mm}.${dateInfo.dd}`);
  }
  if (studioName) parts.push(studioName);
  if (title) parts.push(title);

  return parts.filter(Boolean).join(' ');
}

function buildDiscoveryQueries(scene) {
  const dateInfo = stashdb.formatDateForQuery(scene.date || scene.release_date);
  const studioName = stashdb.formatStudioName(scene.studio?.name);
  const title = scene.title ? String(scene.title).trim() : '';
  const normalizedTitle = normalizeTitleForSearch(title);

  const variants = [];

  // Only run two queries for speed:
  // 1) Scene title
  if (normalizedTitle) variants.push(normalizedTitle);
  // 2) Studio name + scene title
  if (studioName && normalizedTitle) variants.push(`${studioName} ${normalizedTitle}`);

  // Deduplicate while preserving order
  const seen = new Set();
  const result = variants
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(v => v.length > 0)
    .filter(v => (seen.has(v) ? false : (seen.add(v), true)));
  
  if (result.length > 0) {
    console.log(`[scraper] Built ${result.length} discovery queries for scene "${title}"`);
    result.forEach((q, i) => console.log(`[scraper]   Query ${i + 1}: "${q}"`));
  }
  
  return result;
}

/**
 * Process a single scene: always cache metadata (browse),
 * and do NOT attempt to discover streams here.
 */
async function processScene(scene, config) {
  // Always cache scene metadata so catalogs/metas work.
  cache.set(`scene:${scene.id}`, {
    ...scene,
    debridCandidates: [],
    debridCandidatesUpdatedAt: 0
  });

  return { cached: true };
}

/**
 * Scrape trending scenes and cache them
 * Uses environment variables for credentials
 */
async function scrape() {
  console.log('\n=== Starting scrape ===');
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    const stashdbApiKey = process.env.STASHDB_API_KEY;

    if (!stashdbApiKey) {
      console.error('Missing required environment variables for scraping');
      return;
    }

    const config = { stashdbApiKey };

    // Clear cache before starting new scrape to replace old data
    cache.clear();
    console.log('Cache cleared');

    // Fetch trending scenes from StashDB
    const targetCount = parseInt(process.env.SCRAPE_COUNT || '100', 10);
    const scenes = await stashdb.getTrendingScenes(config.stashdbApiKey, targetCount);
    console.log(`Found ${scenes.length} trending scenes from StashDB`);

    if (scenes.length === 0) {
      console.log('No scenes to process');
      return;
    }

    // Cache each scene (metadata only)
    let cachedCount = 0;
    for (const scene of scenes) {
      const res = await processScene(scene, config);
      if (res?.cached) cachedCount++;
    }

    console.log(`\nScrape complete: ${cachedCount}/${scenes.length} scenes cached`);
    console.log(`Cache size: ${cache.size()} scenes`);
  } catch (error) {
    console.error('Scrape error:', error);
  }

  console.log('=== Scrape finished ===\n');
}

/**
 * Start the scraper with initial scrape and 24h interval
 * Uses environment variables for credentials
 */
function startScraper() {
  console.log('Starting scraper...');
  
  // Run initial scrape
  scrape();

  // Schedule scraping at configurable interval (default: 24 hours)
  const scraperIntervalMs = parseInt(process.env.SCRAPER_INTERVAL_MS || '86400000', 10);
  const interval = setInterval(() => {
    scrape();
  }, scraperIntervalMs);

  return interval;
}

module.exports = {
  scrape,
  startScraper,
  buildDiscoveryQuery,
  buildDiscoveryQueries,
  processScene,
};

