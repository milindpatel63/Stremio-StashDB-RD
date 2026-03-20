/**
 * Redirect handler for deep links
 * Detects if request is from Stremio app or web browser
 * Redirects app users to stremio:// protocol, web users to StashDB
 */

const STASHDB_WEB_URL = process.env.STASHDB_WEB_URL || 'https://stashdb.org';

function isStremioApp(userAgent) {
  if (!userAgent) return false;
  // Stremio app identifies itself in User-Agent
  return userAgent.toLowerCase().includes('stremio');
}

function redirectHandler(req, res) {
  const { type, id } = req.params;
  const userAgent = req.get('user-agent') || '';
  
  console.log(`[redirectHandler] Request: type=${type}, id=${id}, userAgent=${userAgent.slice(0, 100)}`);
  
  if (!type || !id) {
    console.log('[redirectHandler] Missing type or id');
    res.status(400).send('Missing type or id parameter');
    return;
  }

  if (isStremioApp(userAgent)) {
    // Stremio app - use stremio:// protocol
    console.log('[redirectHandler] Detected Stremio app, redirecting to stremio protocol');
    const stremioUrl = `stremio:///detail/${type}/${id}`;
    res.redirect(302, stremioUrl);
  } else {
    // Web browser - redirect to StashDB
    // Extract scene ID (format: stashdb-scene:{uuid})
    const sceneId = id.replace('stashdb-scene:', '');
    const stashdbUrl = `${STASHDB_WEB_URL}/scenes/${sceneId}`;
    console.log(`[redirectHandler] Detected web browser, redirecting to StashDB: ${stashdbUrl}`);
    res.redirect(302, stashdbUrl);
  }
}

module.exports = redirectHandler;
