function normalizeLevel(level) {
  return String(level || '').trim().toUpperCase();
}

function isDebugEnabled() {
  // Enabled only when explicitly requested.
  // Examples:
  // - LOG_LEVEL=DEBUG
  // - DEBUG=1
  const logLevel = normalizeLevel(process.env.LOG_LEVEL);
  if (logLevel === 'DEBUG') return true;

  const debug = normalizeLevel(process.env.DEBUG);
  return debug === '1' || debug === 'TRUE' || debug === 'YES' || debug === 'DEBUG';
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function debug(message, data) {
  if (!isDebugEnabled()) return;
  if (typeof data === 'undefined') {
    console.log(message);
  } else {
    console.log(`${message} ${safeJson(data)}`);
  }
}

module.exports = {
  isDebugEnabled,
  debug
};

