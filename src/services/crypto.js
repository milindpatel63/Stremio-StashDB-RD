const crypto = require('crypto');

function getKey() {
  const raw = process.env.SECRET_KEY;
  if (!raw) return null;
  const buf = Buffer.from(String(raw).trim(), 'hex');
  if (buf.length !== 32) return null;
  return buf;
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64');
}

function encryptJson(obj) {
  const key = getKey();
  if (!key) {
    throw new Error('SECRET_KEY must be 64 hex chars (32 bytes)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // payload = iv || tag || ciphertext
  return b64urlEncode(Buffer.concat([iv, tag, enc]));
}

function decryptJson(payload) {
  const key = getKey();
  if (!key) {
    throw new Error('SECRET_KEY must be 64 hex chars (32 bytes)');
  }
  const buf = b64urlDecode(payload);
  if (buf.length < 12 + 16 + 1) throw new Error('Invalid payload');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

module.exports = { encryptJson, decryptJson };

