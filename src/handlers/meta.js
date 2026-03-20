const cache = require('../cache');
const stashdb = require('../services/stashdb');

const STASHDB_WEB_URL = process.env.STASHDB_WEB_URL || 'https://stashdb.org';
const META_DESCRIPTION_MAX_LENGTH = parseInt(process.env.META_DESCRIPTION_MAX_LENGTH || '1400', 10);

/**
 * Meta handler - returns full meta object for a specific scene, performer, or studio
 */
async function metaHandler(args) {
  const { id } = args;
  console.log('[metaHandler] Called with id:', id);
  
  // Parse the ID to determine content type
  if (id.startsWith('stashdb-scene:')) {
    return handleSceneMeta(id.replace('stashdb-scene:', ''));
  } else if (id.startsWith('stashdb-performer:')) {
    const performerId = id.replace('stashdb-performer:', '');
    console.log('[metaHandler] Routing to performer handler for:', performerId);
    const result = await handlePerformerMeta(performerId);
    console.log('[metaHandler] Performer result:', result ? Object.keys(result) : 'null', 'meta:', result?.meta ? Object.keys(result.meta) : 'null');
    return result;
  } else if (id.startsWith('stashdb-studio:')) {
    return handleStudioMeta(id.replace('stashdb-studio:', ''));
  }

  return Promise.resolve({ meta: null });
}

/**
 * Handle scene meta
 */
async function handleSceneMeta(sceneId) {
  let scene = cache.get(`scene:${sceneId}`);
  
  // Always fetch fresh scene data to get performers
  const apiKey = process.env.STASHDB_API_KEY;
  if (apiKey) {
    const freshScene = await stashdb.findSceneById(apiKey, sceneId);
    if (freshScene) {
      scene = freshScene;
      cache.set(`scene:${sceneId}`, scene);
    }
  }
  
  if (!scene) {
    return Promise.resolve({ meta: null });
  }

  // Find landscape poster and background images
  let poster = null;
  let background = null;
  
  if (scene.images && scene.images.length > 0) {
    // Prefer landscape images for poster
    const landscapeImage = scene.images.find(img => 
      img.url && img.width && img.height && img.width > img.height
    );
    poster = landscapeImage?.url || scene.images[0]?.url || null;
    
    // Use another landscape image for background if available
    const backgroundImage = scene.images.find(img => 
      img.url && img.url !== poster && img.width && img.height && img.width > img.height
    );
    background = backgroundImage?.url || poster;
  }

  // Extract genres from tags
  const genres = scene.tags?.map(tag => tag.name) || [];

  // Format runtime (convert seconds to minutes if needed)
  const runtime = scene.duration 
    ? `${Math.floor(scene.duration / 60)} min`
    : null;

  // Always show performers first (Stremio may truncate long descriptions)
  const performerNames = (scene.performers || [])
    .map(p => p?.performer?.name)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ');

  const headerLines = [];
  if (performerNames) headerLines.push(`With: ${performerNames}`);
  if (scene.studio?.name) headerLines.push(`Studio: ${scene.studio.name}`);
  const header = headerLines.length ? `${headerLines.join(' • ')}\n\n` : '';

  // Keep details after header; truncate to keep header visible
  const details = scene.details || '';
  const description = (header + details).slice(0, META_DESCRIPTION_MAX_LENGTH);

  const meta = {
    id: `stashdb-scene:${scene.id}`,
    type: 'adult',
    name: scene.title,
    poster: poster,
    posterShape: 'landscape',
    background: background,
    description: description,
    releaseInfo: scene.date || scene.release_date || null,
    director: scene.director ? [scene.director] : [],
    cast: [],
    genres: genres,
    runtime: runtime,
    // Additional metadata
    links: [
      {
        name: 'StashDB',
        category: 'imdb',
        url: `${STASHDB_WEB_URL}/scenes/${scene.id}`
      }
    ]
  };

  return { meta };
}

/**
 * Handle performer meta
 */
async function handlePerformerMeta(performerId) {
  console.log(`[handlePerformerMeta] START for ${performerId}`);
  let performer = cache.get(`performer:${performerId}`);
  console.log(`[handlePerformerMeta] Cached performer fields:`, performer ? Object.keys(performer).sort() : null);

  // Try to fetch full performer details from API (only for meta page, not catalog)
  const apiKey = process.env.STASHDB_API_KEY;
  if (apiKey) {
    try {
      console.log(`[handlePerformerMeta] Attempting fresh fetch from API`);
      const fresh = await stashdb.findPerformerById(apiKey, performerId);
      if (fresh) {
        console.log(`[handlePerformerMeta] Fresh fetch result fields:`, Object.keys(fresh).sort());
        performer = fresh;
        cache.set(`performer:${performerId}`, performer);
      } else {
        console.log(`[handlePerformerMeta] Fresh fetch returned null`);
      }
    } catch (err) {
      console.log(`[handlePerformerMeta] API fetch exception:`, err.message);
      // Fallback to cached data
    }
  }

  if (!performer) {
    console.log(`[handlePerformerMeta] No performer found for ${performerId}`);
    return Promise.resolve({ meta: null });
  }

  console.log(`[handlePerformerMeta] Building meta for: ${performer.name}`);
  let poster = null;
  if (performer.images && performer.images.length > 0) {
    poster = performer.images[0]?.url || null;
  }

  // Build description with ALL available performer details
  const descLines = [];
  
  if (performer.disambiguation) descLines.push(performer.disambiguation);
  if (performer.age != null) descLines.push(`Age: ${performer.age}`);
  
  // Handle birthdate - can be string or object with date property
  if (performer.birth_date) {
    descLines.push(`Born: ${performer.birth_date}`);
  } else if (performer.birthdate) {
    if (typeof performer.birthdate === 'object' && performer.birthdate.date) {
      descLines.push(`Born: ${performer.birthdate.date}`);
    } else if (typeof performer.birthdate === 'string') {
      descLines.push(`Born: ${performer.birthdate}`);
    }
  }
  
  if (performer.death_date) descLines.push(`Died: ${performer.death_date}`);
  if (performer.gender) descLines.push(`Gender: ${performer.gender}`);
  if (performer.ethnicity) descLines.push(`Ethnicity: ${performer.ethnicity}`);
  if (performer.country) descLines.push(`Country: ${performer.country}`);
  if (performer.height) descLines.push(`Height: ${performer.height} cm`);
  if (performer.eye_color) descLines.push(`Eye color: ${performer.eye_color}`);
  if (performer.hair_color) descLines.push(`Hair color: ${performer.hair_color}`);
  if (performer.breast_type) descLines.push(`Breast type: ${performer.breast_type}`);
  
  if (performer.band_size || performer.cup_size) {
    const bra = performer.band_size ? `${performer.band_size}${performer.cup_size || ''}` : performer.cup_size;
    if (bra) descLines.push(`Bra size: ${bra}`);
  }
  
  if (performer.waist_size) descLines.push(`Waist: ${performer.waist_size}`);
  if (performer.hip_size) descLines.push(`Hips: ${performer.hip_size}`);
  
  if (performer.career_start_year || performer.career_end_year) {
    descLines.push(`Career: ${performer.career_start_year || '?'}–${performer.career_end_year || 'present'}`);
  }
  
  if (performer.scene_count != null) descLines.push(`Scene count: ${performer.scene_count}`);
  
  if (performer.aliases && performer.aliases.length > 0) {
    descLines.push(`Also known as: ${performer.aliases.slice(0, 10).join(', ')}`);
  }
  
  if (performer.urls && performer.urls.length > 0) {
    const urlStrings = performer.urls.map(u => u.url || u).filter(Boolean);
    if (urlStrings.length > 0) {
      descLines.push(`Links: ${urlStrings.slice(0, 5).join(' • ')}`);
    }
  }

  const description = descLines.join('\n').slice(0, META_DESCRIPTION_MAX_LENGTH);
  console.log(`[handlePerformerMeta] Built description with ${descLines.length} lines, ${description.length} chars`);
  if (descLines.length === 0) {
    console.log(`[handlePerformerMeta] WARNING: No description lines built. Performer object:`, JSON.stringify(performer, null, 2).slice(0, 500));
  }

  // Build genres/tags from aliases if available
  const genres = [];
  if (performer.aliases && performer.aliases.length > 0) {
    genres.push(...performer.aliases.slice(0, 5));
  }

  // Build metadata identical to scene handler
  const meta = {
    id: `stashdb-performer:${performer.id}`,
    type: 'adult',
    name: performer.name,
    poster: poster,
    posterShape: 'portrait',
    description: description,
    releaseInfo: (performer.career_start_year || performer.career_end_year) 
      ? `${performer.career_start_year || '?'}–${performer.career_end_year || 'present'}`
      : null,
    director: [],
    cast: [],
    genres: genres,
    runtime: null,
    links: [
      {
        name: 'StashDB',
        category: 'imdb',
        url: `${STASHDB_WEB_URL}/performers/${performer.id}`
      }
    ]
  };

  console.log(`[handlePerformerMeta] Returning meta with ${meta.description.length} char description`);
  return { meta };
}

/**
 * Handle studio meta
 */
async function handleStudioMeta(studioId) {
  let studio = cache.get(`studio:${studioId}`);

  if (!studio) return Promise.resolve({ meta: null });

  let poster = null;
  if (studio.images && studio.images.length > 0) {
    const landscapes = studio.images
      .filter(img => img?.url && img?.width && img?.height && img.width > img.height)
      .sort((a, b) => (b.width - a.width));
    poster = landscapes[0]?.url || studio.images[0]?.url || null;
  }

  // Build description with only available data
  const descLines = [];
  descLines.push('Studio from StashDB');

  const description = descLines.join('\n').slice(0, META_DESCRIPTION_MAX_LENGTH);

  // Build metadata identical to scene handler
  const meta = {
    id: `stashdb-studio:${studio.id}`,
    type: 'adult',
    name: studio.name,
    poster: poster,
    posterShape: 'square',
    description: description,
    releaseInfo: null,
    director: [],
    cast: [],
    genres: [],
    runtime: null,
    links: [
      {
        name: 'StashDB',
        category: 'imdb',
        url: `${STASHDB_WEB_URL}/studios/${studio.id}`
      }
    ]
  };

  return { meta };
}

module.exports = metaHandler;

