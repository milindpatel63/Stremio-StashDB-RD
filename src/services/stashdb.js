const axios = require('axios');
const logger = require('../logger');

const STASHDB_URL = process.env.STASHDB_URL || 'https://stashdb.org/graphql';

const TRENDING_SCENES_QUERY = `
  query QueryScenes($page: Int!) {
    queryScenes(input: { page: $page, per_page: 25, sort: TRENDING }) {
      scenes {
        id
        title
        details
        date
        release_date
        production_date
        duration
        director
        code
        created
        updated
        studio {
          id
          name
          aliases
        }
        performers {
          performer {
            id
            name
          }
        }
        tags {
          name
          id
        }
        images {
          url
          width
          height
        }
      }
      count
    }
  }
`;

const BROWSE_SCENES_QUERY = `
  query QueryScenes($page: Int!, $perPage: Int!, $text: String, $sort: SceneSortEnum!, $direction: SortDirectionEnum!) {
    queryScenes(input: { page: $page, per_page: $perPage, sort: $sort, direction: $direction, text: $text }) {
      scenes {
        id
        title
        details
        date
        release_date
        production_date
        duration
        director
        code
        created
        updated
        studio {
          id
          name
          aliases
        }
        performers {
          performer {
            id
            name
          }
        }
        tags {
          name
          id
        }
        images {
          url
          width
          height
        }
      }
      count
    }
  }
`;

const SCENE_BY_ID_QUERY = `
  query FindScene($id: ID!) {
    findScene(id: $id) {
      id
      title
      details
      date
      release_date
      production_date
      duration
      director
      code
      created
      updated
      studio {
        id
        name
        aliases
      }
      performers {
        performer {
          id
          name
        }
      }
      tags {
        name
        id
      }
      images {
        url
        width
        height
      }
    }
  }
`;

/**
 * Query trending scenes from StashDB
 * Fetches multiple pages to get ~100 results
 */
async function getTrendingScenes(apiKey, targetCount = 100) {
  const allScenes = [];
  const perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10);
  const maxPages = Math.ceil(targetCount / perPage);
  const normalizedKey = apiKey ? String(apiKey).trim() : '';

  try {
    for (let page = 1; page <= maxPages; page++) {
      const response = await axios.post(
        STASHDB_URL,
        {
          query: TRENDING_SCENES_QUERY,
          variables: { page }
        },
        {
          headers: {
            'apikey': normalizedKey,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.errors) {
        console.error('StashDB GraphQL errors:', response.data.errors);
        break;
      }

      const scenes = response.data.data.queryScenes.scenes || [];
      allScenes.push(...scenes);

      console.log(`  Fetched page ${page}: ${scenes.length} scenes`);

      // Stop if we got fewer scenes than expected (last page)
      if (scenes.length < perPage) {
        break;
      }

      // Small delay between pages
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return allScenes;
  } catch (error) {
    console.error('StashDB API error:', error.message);
    return allScenes; // Return what we have so far
  }
}

async function queryScenesPage(apiKey, { page, perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10), text = null, sort = 'TRENDING', direction = 'DESC' }) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    logger.debug('[stashdb] queryScenesPage request', {
      url: STASHDB_URL,
      page,
      perPage,
      text,
      sort,
      direction
    });
    const response = await axios.post(
      STASHDB_URL,
      {
        query: BROWSE_SCENES_QUERY,
        variables: { page, perPage, text, sort, direction }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      logger.debug('[stashdb] queryScenesPage graphql errors', response.data.errors);
      return { scenes: [], count: 0 };
    }

    const result = response.data.data?.queryScenes;
    const scenes = result?.scenes || [];
    logger.debug('[stashdb] queryScenesPage response', {
      page,
      perPage,
      returned: Array.isArray(scenes) ? scenes.length : null,
      count: result?.count || 0
    });
    logger.debug('[stashdb] queryScenesPage scene ids/titles', {
      page,
      ids: Array.isArray(scenes) ? scenes.map(s => s?.id).filter(Boolean) : [],
      missingTitleCount: Array.isArray(scenes)
        ? scenes.filter(s => !s?.title || String(s.title).trim().length === 0).length
        : null
    });
    return { scenes, count: result?.count || 0 };
  } catch (error) {
    console.error('StashDB API error:', error.message);
    logger.debug('[stashdb] queryScenesPage error', {
      page,
      perPage,
      message: error?.message || null,
      status: error?.response?.status || null,
      data: error?.response?.data || null
    });
    return { scenes: [], count: 0 };
  }
}

async function findSceneById(apiKey, id) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    const response = await axios.post(
      STASHDB_URL,
      {
        query: SCENE_BY_ID_QUERY,
        variables: { id }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      return null;
    }

    return response.data.data?.findScene || null;
  } catch (error) {
    console.error('StashDB API error:', error.message);
    return null;
  }
}

/**
 * Format date as YY.MM.DD for search queries
 */
function formatDateForQuery(dateString) {
  if (!dateString) return null;
  
  const date = new Date(dateString);
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  return { yy, mm, dd };
}

/**
 * Format studio name for search queries (alphanumeric only)
 */
function formatStudioName(studioName) {
  if (!studioName) return null;
  // Remove non-alphanumeric characters and spaces
  return studioName.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Build search query from scene metadata
 */
function buildSearchQuery(scene) {
  const dateInfo = formatDateForQuery(scene.date || scene.release_date);
  if (!dateInfo) return null;

  const studioName = formatStudioName(scene.studio?.name);
  if (!studioName) return null;

  return `${studioName}.${dateInfo.yy}.${dateInfo.mm}.${dateInfo.dd}`;
}

const BROWSE_PERFORMERS_QUERY = `
  query QueryPerformers($page: Int!, $perPage: Int!, $name: String, $sort: PerformerSortEnum!, $direction: SortDirectionEnum!) {
    queryPerformers(input: { page: $page, per_page: $perPage, sort: $sort, direction: $direction, name: $name, gender: FEMALE }) {
      performers {
        id
        name
        birthdate {
          date
          accuracy
        }
        created
        updated
        images {
          url
          width
          height
        }
      }
      count
    }
  }
`;

const BROWSE_STUDIOS_QUERY = `
  query QueryStudios($page: Int!, $perPage: Int!, $name: String, $sort: StudioSortEnum!, $direction: SortDirectionEnum!) {
    queryStudios(input: { page: $page, per_page: $perPage, sort: $sort, direction: $direction, name: $name }) {
      studios {
        id
        name
        created
        updated
        images {
          url
          width
          height
        }
      }
      count
    }
  }
`;

const PERFORMER_SCENES_QUERY = `
  query QueryScenes($page: Int!, $perPage: Int!, $performerId: ID!) {
    queryScenes(input: { page: $page, per_page: $perPage, sort: CREATED_AT, direction: DESC, performers: { value: [$performerId], modifier: INCLUDES } }) {
      scenes {
        id
        title
        date
        studio {
          id
          name
        }
        images {
          url
          width
          height
        }
      }
      count
    }
  }
`;

const STUDIO_SCENES_QUERY = `
  query QueryScenes($page: Int!, $perPage: Int!, $studioId: ID!) {
    queryScenes(input: { page: $page, per_page: $perPage, sort: CREATED_AT, direction: DESC, studios: { value: [$studioId], modifier: INCLUDES } }) {
      scenes {
        id
        title
        date
        studio {
          id
          name
        }
        images {
          url
          width
          height
        }
      }
      count
    }
  }
`;

const PERFORMER_BY_ID_QUERY = `
  query FindPerformer($id: ID!) {
    findPerformer(id: $id) {
      id
      name
      disambiguation
      aliases
      gender
      urls {
        url
        type
      }
      birth_date
      death_date
      age
      ethnicity
      country
      eye_color
      hair_color
      height
      cup_size
      band_size
      waist_size
      hip_size
      breast_type
      career_start_year
      career_end_year
      scene_count
      images {
        url
        width
        height
      }
      created
      updated
    }
  }
`;

const STUDIO_BY_ID_QUERY = `
  query FindStudio($id: ID!) {
    findStudio(id: $id) {
      id
      name
      aliases
      urls
      created
      updated
      images {
        url
        width
        height
      }
    }
  }
`;

/**
 * Query performers from StashDB
 * For performers, valid sorts are: NAME, BIRTHDATE, DEATHDATE, SCENE_COUNT, CAREER_START_YEAR, DEBUT, LAST_SCENE, CREATED_AT, UPDATED_AT
 * Default to SCENE_COUNT (most scenes) which is a good indicator of popularity
 */
async function queryPerformersPage(apiKey, { page, perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10), text = null, sort = 'SCENE_COUNT', direction = 'DESC' }) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    logger.debug('[stashdb] queryPerformersPage request', {
      url: STASHDB_URL,
      page,
      perPage,
      text,
      sort,
      direction
    });
    const response = await axios.post(
      STASHDB_URL,
      {
        query: BROWSE_PERFORMERS_QUERY,
        variables: { page, perPage, name: text, sort, direction }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      logger.debug('[stashdb] queryPerformersPage graphql errors', response.data.errors);
      return { performers: [], count: 0 };
    }

    const result = response.data.data?.queryPerformers;
    logger.debug('[stashdb] queryPerformersPage response', {
      page,
      perPage,
      returned: Array.isArray(result?.performers) ? result.performers.length : null,
      count: result?.count || 0
    });
    return { performers: result?.performers || [], count: result?.count || 0 };
  } catch (error) {
    console.error('StashDB API error:', error.message);
    logger.debug('[stashdb] queryPerformersPage error', {
      page,
      perPage,
      message: error?.message || null,
      status: error?.response?.status || null,
      data: error?.response?.data || null
    });
    return { performers: [], count: 0 };
  }
}

/**
 * Query studios from StashDB
 * For studios, valid sorts are: NAME, CREATED_AT, UPDATED_AT
 * Default to UPDATED_AT (recently updated studios)
 */
async function queryStudiosPage(apiKey, { page, perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10), text = null, sort = 'UPDATED_AT', direction = 'DESC' }) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    logger.debug('[stashdb] queryStudiosPage request', {
      url: STASHDB_URL,
      page,
      perPage,
      text,
      sort,
      direction
    });
    const response = await axios.post(
      STASHDB_URL,
      {
        query: BROWSE_STUDIOS_QUERY,
        variables: { page, perPage, name: text, sort, direction }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      logger.debug('[stashdb] queryStudiosPage graphql errors', response.data.errors);
      return { studios: [], count: 0 };
    }

    const result = response.data.data?.queryStudios;
    logger.debug('[stashdb] queryStudiosPage response', {
      page,
      perPage,
      returned: Array.isArray(result?.studios) ? result.studios.length : null,
      count: result?.count || 0
    });
    return { studios: result?.studios || [], count: result?.count || 0 };
  } catch (error) {
    console.error('StashDB API error:', error.message);
    logger.debug('[stashdb] queryStudiosPage error', {
      page,
      perPage,
      message: error?.message || null,
      status: error?.response?.status || null,
      data: error?.response?.data || null
    });
    return { studios: [], count: 0 };
  }
}

/**
 * Query scenes for a specific performer
 */
async function queryPerformerScenes(apiKey, performerId, { page = 1, perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10) }) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    const response = await axios.post(
      STASHDB_URL,
      {
        query: PERFORMER_SCENES_QUERY,
        variables: { page, perPage, performerId }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      return { scenes: [], count: 0 };
    }

    const result = response.data.data?.queryScenes;
    return { scenes: result?.scenes || [], count: result?.count || 0 };
  } catch (error) {
    if (error.response?.status === 422) {
      console.error('StashDB API 422 error for performer query:', error.response?.data || error.message);
    } else {
      console.error('StashDB API error:', error.message);
    }
    return { scenes: [], count: 0 };
  }
}

/**
 * Query scenes for a specific studio
 */
async function queryStudioScenes(apiKey, studioId, { page = 1, perPage = parseInt(process.env.STASHDB_PER_PAGE || '25', 10) }) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    const response = await axios.post(
      STASHDB_URL,
      {
        query: STUDIO_SCENES_QUERY,
        variables: { page, perPage, studioId }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      return { scenes: [], count: 0 };
    }

    const result = response.data.data?.queryScenes;
    return { scenes: result?.scenes || [], count: result?.count || 0 };
  } catch (error) {
    if (error.response?.status === 422) {
      console.error('StashDB API 422 error for studio query:', error.response?.data || error.message);
    } else {
      console.error('StashDB API error:', error.message);
    }
    return { scenes: [], count: 0 };
  }
}

async function findPerformerById(apiKey, id) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    const response = await axios.post(
      STASHDB_URL,
      {
        query: PERFORMER_BY_ID_QUERY,
        variables: { id }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      // Return partial data if available
      return response.data.data?.findPerformer || null;
    }
    return response.data.data?.findPerformer || null;
  } catch (error) {
    if (error.response?.status === 422) {
      console.error('StashDB API 422 error for performer query:', error.response?.data || error.message);
    } else {
      console.error('StashDB API error:', error.message);
    }
    return null;
  }
}

async function findStudioById(apiKey, id) {
  const normalizedKey = apiKey ? String(apiKey).trim() : '';
  try {
    const response = await axios.post(
      STASHDB_URL,
      {
        query: STUDIO_BY_ID_QUERY,
        variables: { id }
      },
      {
        headers: {
          apikey: normalizedKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      console.error('StashDB GraphQL errors:', response.data.errors);
      return null;
    }
    return response.data.data?.findStudio || null;
  } catch (error) {
    console.error('StashDB API error:', error.message);
    return null;
  }
}

module.exports = {
  getTrendingScenes,
  queryScenesPage,
  findSceneById,
  queryPerformersPage,
  queryStudiosPage,
  queryPerformerScenes,
  queryStudioScenes,
  findPerformerById,
  findStudioById,
  formatDateForQuery,
  formatStudioName,
  buildSearchQuery
};

