const axios = require('axios');

const RD_BASE_URL = process.env.REALDEBRID_URL || 'https://api.real-debrid.com/rest/1.0';
const HTTP_TIMEOUT_MS = parseInt(process.env.REALDEBRID_TIMEOUT_MS || '30000', 10);

function createClient(apiToken) {
  return axios.create({
    baseURL: RD_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiToken}`
    },
    timeout: HTTP_TIMEOUT_MS
  });
}

function normalizeError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const message = data?.error || err?.message || 'Unknown error';
  return new Error(`Real-Debrid API error${status ? ` (${status})` : ''}: ${message}`);
}

async function getUser(apiToken) {
  try {
    const client = createClient(apiToken);
    const res = await client.get('/user');
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Check instant availability for one or more torrent hashes (SHA1 infohash).
 * API format: GET /torrents/instantAvailability/{hash}/{hash2}/...
 */
async function instantAvailability(apiToken, hashes) {
  const hashList = Array.isArray(hashes) ? hashes : [hashes];
  const cleaned = hashList
    .filter(Boolean)
    .map(h => String(h).trim().toLowerCase())
    .filter(h => /^[a-f0-9]{40}$/.test(h));

  if (cleaned.length === 0) return {};

  try {
    const client = createClient(apiToken);
    const res = await client.get(`/torrents/instantAvailability/${cleaned.join('/')}`);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Add magnet to Real-Debrid torrent list.
 * Returns an object including `id` (torrent id) and possibly `uri`.
 */
async function addMagnet(apiToken, magnet) {
  try {
    const client = createClient(apiToken);
    const body = new URLSearchParams({ magnet });
    const res = await client.post('/torrents/addMagnet', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (s) => s >= 200 && s < 300
    });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Add a torrent file to Real-Debrid torrent list.
 * Real-Debrid REST uses `PUT /torrents/addTorrent` with torrent file bytes.
 *
 * NOTE: This implementation sends raw torrent bytes with:
 * - Content-Type: application/x-bittorrent
 * - optional query param `host`
 */
async function addTorrent(apiToken, torrentBuf, opts = {}) {
  try {
    const client = createClient(apiToken);
    if (!Buffer.isBuffer(torrentBuf)) {
      throw new Error('torrentBuf must be a Buffer');
    }

    const params = {};
    if (opts.host) params.host = opts.host;

    const res = await client.put('/torrents/addTorrent', torrentBuf, {
      params,
      headers: {
        'Content-Type': 'application/x-bittorrent'
      },
      validateStatus: (s) => s === 201 || (s >= 200 && s < 300)
    });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function getTorrentInfo(apiToken, id) {
  try {
    const client = createClient(apiToken);
    const res = await client.get(`/torrents/info/${encodeURIComponent(id)}`);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Select files for a torrent to start it.
 * `files` can be "all" or array of ids (numbers/strings)
 */
async function selectFiles(apiToken, id, files) {
  try {
    const client = createClient(apiToken);
    const filesValue = files === 'all'
      ? 'all'
      : Array.isArray(files)
        ? files.map(String).join(',')
        : String(files);

    const body = new URLSearchParams({ files: filesValue });
    await client.post(`/torrents/selectFiles/${encodeURIComponent(id)}`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (s) => s === 204 || (s >= 200 && s < 300)
    });
    return true;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Unrestrict a link (typically a Real-Debrid generated hoster link, including torrent links).
 * Returns a JSON object which includes `download` among other fields.
 */
async function unrestrictLink(apiToken, link, opts = {}) {
  try {
    const client = createClient(apiToken);
    const body = new URLSearchParams({
      link,
      ...(opts.password ? { password: opts.password } : {}),
      ...(opts.remote != null ? { remote: String(opts.remote) } : {})
    });
    const res = await client.post('/unrestrict/link', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

module.exports = {
  getUser,
  instantAvailability,
  addMagnet,
  addTorrent,
  getTorrentInfo,
  selectFiles,
  unrestrictLink
};

