/**
 * Extract info hash from magnet URI
 */
function extractInfoHashFromMagnet(magnet) {
  if (!magnet || typeof magnet !== 'string') return null;
  const m = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
  if (!m) return null;
  const raw = m[1];
  // If already hex (40 chars), normalize to lower
  if (/^[a-fA-F0-9]{40}$/.test(raw)) return raw.toLowerCase();
  // Base32 -> hex (RFC4648 alphabet) for 20-byte output
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = raw.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) return null;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  if (bytes.length < 20) return null;
  return bytes.slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
}

module.exports = {
  extractInfoHashFromMagnet
};
