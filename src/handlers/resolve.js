const realdebrid = require('../services/realdebrid');
const prowlarr = require('../services/prowlarr');
const { decryptJson } = require('../services/crypto');
const crypto = require('crypto');
const { extractInfoHashFromMagnet } = require('../utils/magnet');

function tokenKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

const inFlight = new Map(); // key -> Promise<string>
const resolved = new Map(); // key -> { url, exp }

function fingerprint(str, len = 12) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, len);
}

function pickLargestVideoFileIndex(files = []) {
  const videoExts = new Set(['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.mpg', '.mpeg']);
  let best = null;
  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    const path = String(f.path || '').toLowerCase();
    const bytes = typeof f.bytes === 'number' ? f.bytes : (f.bytes ? parseInt(f.bytes, 10) : 0);
    const extMatch = path.match(/(\.[a-z0-9]{2,5})$/);
    const ext = extMatch ? extMatch[1] : '';
    const isVideo = videoExts.has(ext);
    const isSample = path.includes('sample');
    if (!isVideo || isSample) continue;
    if (!best || bytes > best.bytes) best = { id: f.id, bytes };
  }
  return best?.id ?? null;
}

async function resolveToDirectUrlFromMagnet(apiToken, magnet) {
  const added = await realdebrid.addMagnet(apiToken, magnet);
  const torrentId = added?.id;
  if (!torrentId) throw new Error('Failed to add magnet to Real-Debrid');
  console.log('[resolve] added magnet torrentId=', torrentId);

  const info = await realdebrid.getTorrentInfo(apiToken, torrentId);
  const fileId = pickLargestVideoFileIndex(info?.files || []);
  if (fileId != null) {
    await realdebrid.selectFiles(apiToken, torrentId, [fileId]);
  } else {
    await realdebrid.selectFiles(apiToken, torrentId, 'all');
  }

  // Poll until RD provides links
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    const updated = await realdebrid.getTorrentInfo(apiToken, torrentId);
    const link = updated?.links?.[0];
    if (link) {
      const unres = await realdebrid.unrestrictLink(apiToken, link);
      const directUrl = unres?.download || unres?.link;
      if (!directUrl) throw new Error('Unrestrict failed');
      console.log('[resolve] unrestrict ok, redirecting');
      return directUrl;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error('Timed out waiting for Real-Debrid torrent links');
}

async function resolveToDirectUrlFromTorrentFile(apiToken, torrentBuf) {
  const added = await realdebrid.addTorrent(apiToken, torrentBuf);
  const torrentId = added?.id;
  if (!torrentId) throw new Error('Failed to add torrent file to Real-Debrid');
  console.log('[resolve] added torrent file torrentId=', torrentId);

  const info = await realdebrid.getTorrentInfo(apiToken, torrentId);
  const fileId = pickLargestVideoFileIndex(info?.files || []);
  if (fileId != null) {
    await realdebrid.selectFiles(apiToken, torrentId, [fileId]);
  } else {
    await realdebrid.selectFiles(apiToken, torrentId, 'all');
  }

  // Poll until RD provides links
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    const updated = await realdebrid.getTorrentInfo(apiToken, torrentId);
    const link = updated?.links?.[0];
    if (link) {
      const unres = await realdebrid.unrestrictLink(apiToken, link);
      const directUrl = unres?.download || unres?.link;
      if (!directUrl) throw new Error('Unrestrict failed');
      console.log('[resolve] unrestrict ok, redirecting');
      return directUrl;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error('Timed out waiting for Real-Debrid torrent links');
}

async function resolveToDirectUrl(apiToken, payload) {
  const magnet = payload?.magnet || null;
  const downloadUrl = payload?.downloadUrl || null;

  if (magnet) {
    return resolveToDirectUrlFromMagnet(apiToken, magnet);
  }

  if (downloadUrl) {
    const resolved = await prowlarr.resolveDownloadUrlToMagnetOrTorrent(downloadUrl, { wantTorrentBuf: true });
    if (resolved?.magnet) {
      console.log('[resolve] Derived magnet from downloadUrl');
      return resolveToDirectUrlFromMagnet(apiToken, resolved.magnet);
    }
    if (resolved?.torrentBuf) {
      console.log('[resolve] Using torrent file upload for downloadUrl');
      return resolveToDirectUrlFromTorrentFile(apiToken, resolved.torrentBuf);
    }
    throw new Error('Could not resolve downloadUrl into magnet or torrent file');
  }

  throw new Error('Missing magnet/downloadUrl');
}

/**
 * HTTP handler for GET /resolve/<payload>
 * payload is AES-GCM encrypted JSON: { token, magnet?, downloadUrl? }
 */
async function resolveHandler(req, res, payload) {
  try {
    const decoded = decryptJson(payload);
    const token = decoded?.token;
    const magnet = decoded?.magnet || null;
    const downloadUrl = decoded?.downloadUrl || null;
    if (!token || (!magnet && !downloadUrl)) {
      res.statusCode = 400;
      res.end('Bad payload');
      return;
    }

    const infoHash = magnet ? extractInfoHashFromMagnet(magnet) : null;
    const key = `${tokenKey(token)}:${infoHash || (downloadUrl ? `dl:${fingerprint(downloadUrl)}` : 'unknown')}`;

    const now = Date.now();
    const ttlMs = parseInt(process.env.RESOLVE_CACHE_TTL_MS || String(2 * 60 * 60 * 1000), 10);
    const cached = resolved.get(key);
    if (cached && cached.exp > now) {
      res.statusCode = 302;
      res.setHeader('Location', cached.url);
      res.end();
      return;
    }

    if (inFlight.has(key)) {
      const direct = await inFlight.get(key);
      res.statusCode = 302;
      res.setHeader('Location', direct);
      res.end();
      return;
    }

    console.log('[resolve] resolving torrent via Real-Debrid key=', key);
    const p = (async () => {
      const directUrl = await resolveToDirectUrl(token, { magnet, downloadUrl });
      resolved.set(key, { url: directUrl, exp: Date.now() + ttlMs });
      return directUrl;
    })();
    inFlight.set(key, p);

    let direct;
    try {
      direct = await p;
    } finally {
      inFlight.delete(key);
    }

    res.statusCode = 302;
    res.setHeader('Location', direct);
    res.end();
  } catch (err) {
    console.error('[resolve] error:', err?.message || err);
    res.statusCode = 500;
    res.end(`Resolve error: ${err?.message || err}`);
  }
}

module.exports = { resolveHandler };

