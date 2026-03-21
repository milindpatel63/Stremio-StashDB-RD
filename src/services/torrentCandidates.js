function parseQuality(value) {
  if (!value) return 0;
  const str = String(value).toLowerCase();
  if (str.includes('2160') || str.includes('4k')) return 2160;
  if (str.includes('1080')) return 1080;
  if (str.includes('720')) return 720;
  if (str.includes('480')) return 480;
  const m = str.match(/(\d{3,4})p/);
  return m ? parseInt(m[1], 10) : 0;
}

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeInfoHash(value) {
  const v = normalizeText(value).toLowerCase();
  return /^[a-f0-9]{40}$/.test(v) ? v : '';
}

function extractInfoHashFromMagnet(magnet) {
  const m = normalizeText(magnet).match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (!m) return '';
  const raw = String(m[1]).toLowerCase();
  return /^[a-f0-9]{40}$/.test(raw) ? raw : '';
}

function stableIdentityKey(c) {
  const hash = normalizeInfoHash(c?.infoHash) || extractInfoHashFromMagnet(c?.magnet);
  if (hash) return `h:${hash}`;

  // Fallback for results without hash/magnet: exact release label + size.
  // This removes cross-query duplicates while still being strict.
  const name = normalizeText(c?.name).toLowerCase();
  const size = c?.sizeBytes && !isNaN(c.sizeBytes) ? Number(c.sizeBytes) : 0;
  const quality = normalizeText(c?.quality).toLowerCase();
  if (name) return `t:${name}|s:${size}|q:${quality}`;
  return '';
}

function extractDateFromTitle(title) {
  if (!title) return null;
  // Look for common date patterns: YYYY.MM.DD, YYYYMMDD, YYYY-MM-DD
  const patterns = [
    /(\d{4})\.(\d{2})\.(\d{2})/,  // YYYY.MM.DD
    /(\d{4})(\d{2})(\d{2})/,      // YYYYMMDD
    /(\d{4})-(\d{2})-(\d{2})/     // YYYY-MM-DD
  ];
  
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return new Date(`${match[1]}-${match[2]}-${match[3]}`);
    }
  }
  return null;
}

function calculateReleaseDateScore(candidateTitle, sceneDate) {
  // Returns a score where higher is better (newer/closer is better)
  if (!candidateTitle || !sceneDate) return 0;
  
  const extractedDate = extractDateFromTitle(candidateTitle);
  if (!extractedDate) return 0;
  
  const sceneD = new Date(sceneDate);
  const daysDiff = Math.abs((sceneD.getTime() - extractedDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Award points if within 7 days of scene date, decay if further
  if (daysDiff === 0) return 100;
  if (daysDiff <= 1) return 80;
  if (daysDiff <= 3) return 60;
  if (daysDiff <= 7) return 40;
  if (daysDiff <= 30) return 20;
  return 0;
}

function dedupe(candidates) {
  const map = new Map();
  for (const c of candidates) {
    if (!c) continue;
    const key = stableIdentityKey(c);
    if (!key) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, c);
      continue;
    }

    // Keep best representative for same identity.
    const score = (x) => {
      const hasHash = normalizeInfoHash(x?.infoHash) ? 1 : 0;
      const hasMagnet = normalizeText(x?.magnet) ? 1 : 0;
      const hasDownload = normalizeText(x?.downloadUrl) ? 1 : 0;
      const q = parseQuality(x?.quality);
      const s = x?.sizeBytes && !isNaN(x.sizeBytes) ? Number(x.sizeBytes) : 0;
      return (hasHash + hasMagnet) * 1_000_000_000_000 + hasDownload * 10_000_000_000 + q * 1_000_000_000 + s;
    };
    if (score(c) > score(existing)) map.set(key, c);
  }
  return Array.from(map.values());
}

function sortCandidates(candidates, sceneInfo = {}) {
  return [...candidates].sort((a, b) => {
    // Quality is most important
    const qa = parseQuality(a.quality);
    const qb = parseQuality(b.quality);
    if (qb !== qa) return qb - qa;

    // For same quality, check release date proximity (if we have scene date)
    if (sceneInfo.sceneDate) {
      const dateScoreA = calculateReleaseDateScore(a.name, sceneInfo.sceneDate);
      const dateScoreB = calculateReleaseDateScore(b.name, sceneInfo.sceneDate);
      if (dateScoreA !== dateScoreB) return dateScoreB - dateScoreA;
    }

    // Then by size (larger is usually more complete)
    const sa = a.sizeBytes && !isNaN(a.sizeBytes) ? Number(a.sizeBytes) : 0;
    const sb = b.sizeBytes && !isNaN(b.sizeBytes) ? Number(b.sizeBytes) : 0;
    if (sb !== sa) return sb - sa;
    
    return 0;
  });
}

function mergeAndSort(all, sceneInfo = {}) {
  return sortCandidates(dedupe(all.filter(Boolean)), sceneInfo);
}

module.exports = {
  parseQuality,
  extractDateFromTitle,
  calculateReleaseDateScore,
  dedupe,
  sortCandidates,
  mergeAndSort
};


