const cache = require('../cache');
const stashdb = require('../services/stashdb');

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

  if (!stashdbApiKey) {
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
    return handleScenesCatalog(stashdbApiKey, page, perPage, search, finalSort, direction);
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
function handleScenesCatalog(apiKey, page, perPage, search, sort, direction) {
  return stashdb.queryScenesPage(apiKey, { page, perPage, text: search, sort, direction }).then(({ scenes }) => {
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

    return { metas };
  });
}

/**
 * Handle performers catalog
 */
function handlePerformersCatalog(apiKey, page, perPage, search, sort, direction) {
  return stashdb.queryPerformersPage(apiKey, { page, perPage, text: search, sort, direction }).then(({ performers }) => {
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

