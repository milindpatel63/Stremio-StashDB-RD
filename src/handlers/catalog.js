const cache = require('../cache');
const stashdb = require('../services/stashdb');
const logger = require('../logger');

function analyzeMetasForDebug(metas) {
  const issues = {
    total: Array.isArray(metas) ? metas.length : 0,
    missingId: 0,
    missingName: 0,
    duplicateIdCount: 0
  };

  if (!Array.isArray(metas) || metas.length === 0) {
    return { issues, ids: [] };
  }

  const ids = metas.map(m => m?.id).filter(Boolean);
  const idSet = new Set();

  for (const m of metas) {
    if (!m?.id || typeof m.id !== 'string') issues.missingId += 1;
    if (!m?.name || typeof m.name !== 'string' || m.name.trim().length === 0) issues.missingName += 1;
  }

  for (const id of ids) {
    if (idSet.has(id)) issues.duplicateIdCount += 1;
    idSet.add(id);
  }

  return { issues, ids };
}

/**
 * Catalog handler - lazy fetch from StashDB (browse + search + pagination)
 * contentType: 'SCENES' | 'PERFORMERS' | 'STUDIOS'
 * sort: 'TRENDING' | 'DATE' (for scenes) | 'SCENE_COUNT' (for performers) | 'UPDATED_AT' (for studios)
 */
function catalogHandler(args, contentType = 'SCENES', sort = 'TRENDING') {
  const stashdbApiKey = process.env.STASHDB_API_KEY;
  const perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10);
  const skip = args?.extra?.skip ? parseInt(args.extra.skip, 10) : 0;
  const page = Math.floor((isNaN(skip) ? 0 : skip) / perPage) + 1;
  const search = args?.extra?.search ? String(args.extra.search).trim() : null;
  
  if (search) console.log(`[catalog] type=${contentType} search="${search}" skip=${skip} page=${page}`);
  logger.debug('[catalog] request', {
    id: args?.id,
    type: args?.type,
    contentType,
    sortRequested: sort,
    search: search || null,
    extra: args?.extra || null,
    perPage,
    skip,
    page
  });

  if (!stashdbApiKey) {
    logger.debug('[catalog] missing STASHDB_API_KEY (returning empty metas)');
    return { metas: [] };
  }

  // Determine sort order based on content type and search
  let finalSort = sort;
  if (contentType === 'SCENES') {
    // If searching, use DATE sort for better relevance. Otherwise, use the provided sort (TRENDING or DATE)
    if (search) {
      finalSort = 'DATE';
    }
    // Note: finalSort keeps its original value (passed by caller) when not searching
  } else if (contentType === 'PERFORMERS') {
    finalSort = search ? 'NAME' : 'SCENE_COUNT';
  } else if (contentType === 'STUDIOS') {
    finalSort = search ? 'NAME' : 'UPDATED_AT';
  }
  const direction = 'DESC';

  if (contentType === 'SCENES') {
    return handleScenesCatalog(stashdbApiKey, skip, page, perPage, search, finalSort, direction);
  } else if (contentType === 'PERFORMERS') {
    return handlePerformersCatalog(stashdbApiKey, page, perPage, search, finalSort, direction);
  } else if (contentType === 'STUDIOS') {
    return handleStudiosCatalog(stashdbApiKey, page, perPage, search, finalSort, direction);
  }

  return { metas: [] };
}

/**
 * Handle scenes catalog
 */
async function fetchScenesWindow(apiKey, { skip, page, perPage, search, sort, direction }) {
  const normalizedSkip = isNaN(skip) ? 0 : Math.max(0, skip);
  const inPageOffset = normalizedSkip % perPage;

  // Fast path for aligned requests (skip 0, 25, 50...)
  if (inPageOffset === 0) {
    const { scenes } = await stashdb.queryScenesPage(apiKey, { page, perPage, text: search, sort, direction });
    return scenes;
  }

  // Native Stremio apps can request non-aligned skip values (e.g. 49).
  // To avoid replaying the same page, gather a small rolling window across pages.
  const maxPagesToScan = 4;
  const collected = [];
  const seenIds = new Set();

  for (let p = page; p < page + maxPagesToScan; p++) {
    const { scenes } = await stashdb.queryScenesPage(apiKey, { page: p, perPage, text: search, sort, direction });
    if (!Array.isArray(scenes) || scenes.length === 0) break;

    for (const scene of scenes) {
      const sceneId = scene?.id ? String(scene.id) : null;
      if (!sceneId) continue;
      if (seenIds.has(sceneId)) continue;
      seenIds.add(sceneId);
      collected.push(scene);
    }

    if (scenes.length < perPage) break;
    if (collected.length >= inPageOffset + perPage) break;
  }

  logger.debug('[catalog] scenes window mode', {
    skip: normalizedSkip,
    page,
    perPage,
    inPageOffset,
    collected: collected.length,
    returned: collected.slice(inPageOffset, inPageOffset + perPage).length
  });

  return collected.slice(inPageOffset, inPageOffset + perPage);
}

function handleScenesCatalog(apiKey, skip, page, perPage, search, sort, direction) {
  return fetchScenesWindow(apiKey, { skip, page, perPage, search, sort, direction }).then((scenes) => {
    logger.debug('[catalog] scenes result', {
      page,
      perPage,
      returned: Array.isArray(scenes) ? scenes.length : null
    });
    logger.debug('[catalog] scenes ids', {
      page,
      ids: Array.isArray(scenes) ? scenes.map(s => s?.id).filter(Boolean) : []
    });
    // Update cache for meta/stream handlers
    for (const scene of scenes) {
      const existing = cache.get(`scene:${scene.id}`);
      cache.set(`scene:${scene.id}`, { ...(existing || {}), ...scene });
    }

    const metas = scenes.map(scene => {
      // Find landscape poster (width > height)
      let poster = null;
      if (scene.images && scene.images.length > 0) {
        const landscapeImage = scene.images.find(img =>
          img.url && img.width && img.height && img.width > img.height
        );
        poster = landscapeImage?.url || scene.images[0]?.url || null;
      }

      return {
        id: `stashdb-scene:${scene.id}`,
        type: 'adult',
        name: scene.title,
        poster: poster,
        posterShape: 'landscape',
        description: scene.details,
        releaseInfo: scene.date || scene.release_date || null
      };
    });

    const metaDebug = analyzeMetasForDebug(metas);
    logger.debug('[catalog] metas sanity', {
      page,
      perPage,
      ...metaDebug.issues,
      ids: metaDebug.ids
    });

    return { metas };
  });
}

/**
 * Handle performers catalog
 */
function handlePerformersCatalog(apiKey, page, perPage, search, sort, direction) {
  return stashdb.queryPerformersPage(apiKey, { page, perPage, text: search, sort, direction }).then(({ performers }) => {
    logger.debug('[catalog] performers result', {
      page,
      perPage,
      returned: Array.isArray(performers) ? performers.length : null
    });
    // Update cache for meta handler
    for (const performer of performers) {
      const existing = cache.get(`performer:${performer.id}`);
      cache.set(`performer:${performer.id}`, { ...(existing || {}), ...performer });
    }

    const metas = performers.map(performer => {
      // Find poster image
      let poster = null;
      if (performer.images && performer.images.length > 0) {
        poster = performer.images[0]?.url || null;
      }

      return {
        id: `stashdb-performer:${performer.id}`,
        type: 'adult',
        name: performer.name,
        poster: poster,
        posterShape: 'portrait',
        description: ''
      };
    });

    return { metas };
  });
}

/**
 * Handle studios catalog
 */
function handleStudiosCatalog(apiKey, page, perPage, search, sort, direction) {
  return stashdb.queryStudiosPage(apiKey, { page, perPage, text: search, sort, direction }).then(({ studios }) => {
    logger.debug('[catalog] studios result', {
      page,
      perPage,
      returned: Array.isArray(studios) ? studios.length : null
    });
    // Update cache for meta handler
    for (const studio of studios) {
      const existing = cache.get(`studio:${studio.id}`);
      cache.set(`studio:${studio.id}`, { ...(existing || {}), ...studio });
    }

    const metas = studios.map(studio => {
      // Studio logos/banners are often very wide; pick a smaller landscape if possible.
      let poster = null;
      if (studio.images && studio.images.length > 0) {
        const landscapes = studio.images
          .filter(img => img?.url && img?.width && img?.height && img.width > img.height)
          .sort((a, b) => (a.width - b.width)); // smallest first
        poster = landscapes[0]?.url || studio.images[0]?.url || null;
      }

      return {
        id: `stashdb-studio:${studio.id}`,
        type: 'adult',
        name: studio.name,
        poster: poster,
        // square fits better for logos in Stremio UI
        posterShape: 'square',
        description: ''
      };
    });

    return { metas };
  });
}

module.exports = catalogHandler;

