const axios = require('axios');

const { normalizeTitleForSearch } = require('../utils/titleNormalize');
const { extractInfoHashFromMagnet } = require('../utils/magnet');

const PROWLARR_TIMEOUT_MS = parseInt(process.env.PROWLARR_TIMEOUT_MS || '30000', 10);
const PROWLARR_MAX_REDIRECTS = parseInt(process.env.PROWLARR_MAX_REDIRECTS || '5', 10);

function normalizeBaseUrl(url) {
  if (!url) return null;
  return String(url).replace(/\/+$/, '');
}

function isMagnet(url) {
  return typeof url === 'string' && url.startsWith('magnet:');
}

function guessQuality(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  if (t.includes('2160') || t.includes('4k')) return '2160p';
  if (t.includes('1080')) return '1080p';
  if (t.includes('720')) return '720p';
  if (t.includes('480')) return '480p';
  return null;
}

async function buildMagnetFromTorrent(torrentBuf) {
  // parse-torrent is ESM-only; load dynamically to keep this project CommonJS.
  const mod = await import('parse-torrent');
  const parseTorrent = mod.default || mod;
  const parsed = parseTorrent(torrentBuf);
  if (!parsed?.infoHash) return null;
  const magnet = parseTorrent.toMagnetURI(parsed);
  return { infoHash: parsed.infoHash, magnet };
}

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function joinUrl(baseUrl, maybeRelative) {
  try {
    return new URL(String(maybeRelative), String(baseUrl)).toString();
  } catch {
    return null;
  }
}

async function extractMagnetFromHtmlOrText(buf) {
  // Some indexers return a redirect/download page containing the magnet.
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  const m = text.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]{16,}/i);
  if (!m) return null;
  const magnet = m[0];
  return { magnet, infoHash: extractInfoHashFromMagnet(magnet) };
}

async function resolveDownloadUrlToMagnetOrTorrent(downloadUrl, opts = {}) {
  const wantTorrentBuf = !!opts.wantTorrentBuf;
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    return { magnet: null, infoHash: null, torrentBuf: null };
  }

  // Sometimes search engines directly return a magnet.
  if (isMagnet(downloadUrl)) {
    const magnet = downloadUrl;
    return { magnet, infoHash: extractInfoHashFromMagnet(magnet), torrentBuf: null };
  }

  if (!isHttpUrl(downloadUrl)) {
    return { magnet: null, infoHash: null, torrentBuf: null };
  }

  let current = downloadUrl;
  let redirects = 0;

  while (redirects <= PROWLARR_MAX_REDIRECTS) {
    const res = await axios.get(current, {
      responseType: 'arraybuffer',
      timeout: PROWLARR_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true
    });

    const status = res.status;
    const location = res.headers?.location;

    // Follow redirect chain manually to detect magnet:// redirects.
    if (status >= 300 && status < 400 && location) {
      if (isMagnet(location)) {
        const magnet = location;
        return { magnet, infoHash: extractInfoHashFromMagnet(magnet), torrentBuf: null };
      }

      const next = joinUrl(current, location);
      if (!next) break;
      current = next;
      redirects++;
      continue;
    }

    if (status >= 200 && status < 300) {
      const buf = Buffer.from(res.data);

      // 1) Try HTML/text magnet extraction first.
      //    This is fast and handles common Torznab behaviors.
      const htmlMaybe = await extractMagnetFromHtmlOrText(buf).catch(() => null);
      if (htmlMaybe?.magnet) {
        return { magnet: htmlMaybe.magnet, infoHash: htmlMaybe.infoHash, torrentBuf: wantTorrentBuf ? buf : null };
      }

      // 2) Try parsing the torrent file.
      try {
        const built = await buildMagnetFromTorrent(buf);
        if (built?.magnet) {
          return {
            magnet: built.magnet,
            infoHash: built.infoHash ? String(built.infoHash).toLowerCase() : null,
            torrentBuf: wantTorrentBuf ? buf : null
          };
        }
      } catch {
        // ignore and fall through
      }

      // 3) If we couldn't derive magnet but the caller needs the raw torrent bytes
      //    (Real-Debrid can accept torrent file uploads).
      return { magnet: null, infoHash: null, torrentBuf: wantTorrentBuf ? buf : null };
    }

    break;
  }

  return { magnet: null, infoHash: null, torrentBuf: null };
}

/**
 * Search Prowlarr across all enabled indexers.
 *
 * Env:
 * - PROWLARR_URL: e.g. https://prowlarr.dianaonline.uk
 * - PROWLARR_API_KEY: the main Prowlarr API key
 *
 * Params:
 * - categories: default 6000 (XXX). Use -2 for "all torrents".
 */
async function search(query, opts = {}) {
  const base = normalizeBaseUrl(process.env.PROWLARR_URL);
  const apiKey = process.env.PROWLARR_API_KEY;
  if (!base || !apiKey) return [];

  // Normalize the query to remove special characters
  const normalizedQuery = normalizeTitleForSearch(query);
  console.log(`[prowlarr] Original query: "${query}" -> Normalized: "${normalizedQuery}"`);
  const debug = process.env.PROWLARR_DEBUG === '1';
  const logParsed = process.env.PROWLARR_PARSED_LOG === '1';

  const categories = opts.categories ?? (process.env.PROWLARR_CATEGORIES || '6000');
  const limit = opts.limit ?? parseInt(process.env.PROWLARR_LIMIT || '50', 10);

  const url = `${base}/api/v1/search`;

  try {
    const res = await axios.get(url, {
      timeout: PROWLARR_TIMEOUT_MS,
      headers: { 'X-Api-Key': apiKey },
      params: {
        query: normalizedQuery,
        categories,
        limit
      }
    });

    const items = Array.isArray(res.data) ? res.data : [];
    console.log(`[prowlarr] API returned ${items.length} raw results for "${normalizedQuery}"`);
    
    const out = [];

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const title = it?.title || it?.Title || null;
      const size = it?.size || it?.Size || null;
      const seeders = it?.seeders ?? it?.Seeders ?? null;
      const peers = it?.peers ?? it?.Peers ?? null;

      const downloadUrl =
        it?.downloadUrl ?? it?.downloadURL ?? it?.download_url ?? it?.DownloadUrl ?? it?.DownloadURL ??
        it?.torrentUrl ?? it?.torrent_url ??
        it?.guid ?? it?.Guid ??
        it?.link ?? it?.Link ??
        it?.url ?? it?.Url ??
        null;
      const magnetUrl =
        it?.magnetUrl ?? it?.magnetURL ?? it?.magnetLink ?? it?.magnet ?? it?.MagnetUrl ?? null;

      let magnet = null;
      let infoHash = it?.infoHash ?? it?.info_hash ?? it?.infoHashV1 ?? it?.infohash ?? it?.InfoHash ?? null;
      const normalizedDownloadUrl = isHttpUrl(downloadUrl) ? downloadUrl : null;

      // Debug: log item structure for first few items
      if (debug && idx < 2) {
        console.log(`[prowlarr]   DEBUG item${idx}:`, JSON.stringify(it, null, 2).substring(0, 500));
      }

      if (isMagnet(magnetUrl)) {
        magnet = magnetUrl;
      } else if (isMagnet(downloadUrl)) {
        magnet = downloadUrl;
      } else {
        // Important: we intentionally do NOT resolve downloadUrl -> magnet here.
        // Many indexers require redirects/HTML/torrent parsing which is expensive.
        // We defer resolution to click-time (`/resolve`) via `resolveDownloadUrlToMagnetOrTorrent`.
      }

      // We only hard-skip if we don't have anything to resolve with later.
      if (!magnet && !infoHash && !normalizedDownloadUrl) {
        console.log(`[prowlarr]   - Skipped (no magnet/hash/downloadUrl): "${title || 'unknown'}"`);
        continue;
      }

      out.push({
        source: 'prowlarr',
        name: title,
        downloadUrl: normalizedDownloadUrl,
        magnet: magnet || null,
        infoHash: infoHash ? String(infoHash).toLowerCase() : null,
        quality: guessQuality(title),
        sizeBytes: typeof size === 'number' ? size : (size ? parseInt(size, 10) : null),
        seeders: typeof seeders === 'number' ? seeders : (seeders ? parseInt(seeders, 10) : null),
        peers: typeof peers === 'number' ? peers : (peers ? parseInt(peers, 10) : null)
      });
      
      if (logParsed) {
        if (!magnet && !infoHash && normalizedDownloadUrl) {
          console.log(`[prowlarr]   - Parsed ${idx + 1}: "${title}" (no magnet/hash; will use downloadUrl)`);
        } else {
          console.log(`[prowlarr]   - Parsed ${idx + 1}: "${title}" (quality: ${guessQuality(title) || 'unknown'}, size: ${size ? Math.round(size / 1024 / 1024) + 'MB' : 'unknown'})`);
        }
      }
    }

    console.log(`[prowlarr] Successfully parsed ${out.length}/${items.length} results`);
    return out;
  } catch (err) {
    console.error('Prowlarr search error:', err?.response?.status || '', err?.message || err);
    return [];
  }
}

module.exports = {
  search,
  resolveDownloadUrlToMagnetOrTorrent
};


// Helper to try to extract magnet from search engines or well-known sources
async function tryFindMagnetFromTitle(title) {
  if (!title) return null;
  // This would require external API calls which could be slow/risky
  // For now, we'll skip this fallback
  return null;
}
