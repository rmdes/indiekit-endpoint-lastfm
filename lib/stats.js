import { formatTopArtist, formatTopAlbum, mapPeriodToLastfm } from "./utils.js";

/**
 * Get date match filter for a time period
 * @param {string} period - 'all', 'week', or 'month'
 * @returns {object} - MongoDB match filter
 */
function getDateMatch(period) {
  const now = new Date();
  switch (period) {
    case "week":
      return { scrobbledAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } };
    case "month":
      return { scrobbledAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) } };
    default:
      return {};
  }
}

/**
 * Get top artists from MongoDB (fallback if API unavailable)
 * @param {object} db - MongoDB database
 * @param {string} period - 'all', 'week', or 'month'
 * @param {number} limit - Number of artists to return
 * @returns {Promise<Array>} - Top artists
 */
export async function getTopArtistsFromDb(db, period = "all", limit = 10) {
  const match = getDateMatch(period);
  const collection = db.collection("scrobbles");

  return collection
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: "$artistName",
          name: { $first: "$artistName" },
          playCount: { $sum: 1 },
          mbid: { $first: "$artistMbid" },
        },
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { playCount: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          name: 1,
          playCount: 1,
          mbid: 1,
        },
      },
    ])
    .toArray();
}

/**
 * Get top albums from MongoDB (fallback if API unavailable)
 * @param {object} db - MongoDB database
 * @param {string} period - 'all', 'week', or 'month'
 * @param {number} limit - Number of albums to return
 * @returns {Promise<Array>} - Top albums
 */
export async function getTopAlbumsFromDb(db, period = "all", limit = 10) {
  const match = getDateMatch(period);
  const collection = db.collection("scrobbles");

  return collection
    .aggregate([
      { $match: { ...match, albumTitle: { $ne: null } } },
      {
        $group: {
          _id: { album: "$albumTitle", artist: "$artistName" },
          title: { $first: "$albumTitle" },
          artist: { $first: "$artistName" },
          coverUrl: { $first: "$coverUrl" },
          playCount: { $sum: 1 },
          mbid: { $first: "$albumMbid" },
        },
      },
      { $sort: { playCount: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          title: 1,
          artist: 1,
          coverUrl: 1,
          playCount: 1,
          mbid: 1,
        },
      },
    ])
    .toArray();
}

/**
 * Get top artists from Last.fm API
 * @param {object} client - LastFmClient instance
 * @param {string} period - 'all', 'week', or 'month'
 * @param {number} limit - Number of artists to return
 * @returns {Promise<Array>} - Top artists
 */
export async function getTopArtistsFromApi(client, period = "all", limit = 10) {
  const lastfmPeriod = mapPeriodToLastfm(period);
  const response = await client.getTopArtists(lastfmPeriod, limit);
  const artists = response.topartists?.artist || [];

  return artists.map((artist, index) => formatTopArtist(artist, index + 1));
}

/**
 * Get top albums from Last.fm API
 * @param {object} client - LastFmClient instance
 * @param {string} period - 'all', 'week', or 'month'
 * @param {number} limit - Number of albums to return
 * @returns {Promise<Array>} - Top albums
 */
export async function getTopAlbumsFromApi(client, period = "all", limit = 10) {
  const lastfmPeriod = mapPeriodToLastfm(period);
  const response = await client.getTopAlbums(lastfmPeriod, limit);
  const albums = response.topalbums?.album || [];

  return albums.map((album, index) => formatTopAlbum(album, index + 1));
}

/**
 * Get scrobble trends (daily counts)
 * @param {object} db - MongoDB database
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} - Daily scrobble counts
 */
export async function getScrobbleTrends(db, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const collection = db.collection("scrobbles");

  return collection
    .aggregate([
      { $match: { scrobbledAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$scrobbledAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          count: 1,
        },
      },
    ])
    .toArray();
}

/**
 * Get summary statistics for a time period
 * @param {object} db - MongoDB database
 * @param {string} period - 'all', 'week', or 'month'
 * @returns {Promise<object>} - Summary stats
 */
export async function getSummary(db, period = "all") {
  const match = getDateMatch(period);
  const collection = db.collection("scrobbles");

  const result = await collection
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalPlays: { $sum: 1 },
          uniqueTracks: { $addToSet: { $concat: ["$artistName", ":", "$trackTitle"] } },
          uniqueArtists: { $addToSet: "$artistName" },
          uniqueAlbums: { $addToSet: "$albumTitle" },
          lovedCount: {
            $sum: { $cond: [{ $eq: ["$loved", true] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalPlays: 1,
          lovedCount: 1,
          uniqueTracks: { $size: "$uniqueTracks" },
          uniqueArtists: {
            $size: {
              $filter: {
                input: "$uniqueArtists",
                cond: { $ne: ["$$this", null] },
              },
            },
          },
          uniqueAlbums: {
            $size: {
              $filter: {
                input: "$uniqueAlbums",
                cond: { $ne: ["$$this", null] },
              },
            },
          },
        },
      },
    ])
    .toArray();

  return (
    result[0] || {
      totalPlays: 0,
      lovedCount: 0,
      uniqueTracks: 0,
      uniqueArtists: 0,
      uniqueAlbums: 0,
    }
  );
}

/**
 * Get all stats for all time periods
 * Uses Last.fm API for top artists/albums (more accurate) with DB fallback
 * @param {object} db - MongoDB database
 * @param {object} limits - Limits for top lists
 * @param {object} [client] - LastFmClient instance (optional, for API-based stats)
 * @returns {Promise<object>} - All stats
 */
export async function getAllStats(db, limits = {}, client = null) {
  const topArtistsLimit = limits.topArtists || 10;
  const topAlbumsLimit = limits.topAlbums || 10;

  // Get summaries from database
  const [summaryAll, summaryMonth, summaryWeek, trends] = await Promise.all([
    getSummary(db, "all"),
    getSummary(db, "month"),
    getSummary(db, "week"),
    getScrobbleTrends(db, 30),
  ]);

  // Get top artists/albums - prefer API (more accurate), fall back to DB
  let topArtists = { all: [], month: [], week: [] };
  let topAlbums = { all: [], month: [], week: [] };

  if (client) {
    try {
      const [
        topArtistsAll,
        topArtistsMonth,
        topArtistsWeek,
        topAlbumsAll,
        topAlbumsMonth,
        topAlbumsWeek,
      ] = await Promise.all([
        getTopArtistsFromApi(client, "all", topArtistsLimit),
        getTopArtistsFromApi(client, "month", topArtistsLimit),
        getTopArtistsFromApi(client, "week", topArtistsLimit),
        getTopAlbumsFromApi(client, "all", topAlbumsLimit),
        getTopAlbumsFromApi(client, "month", topAlbumsLimit),
        getTopAlbumsFromApi(client, "week", topAlbumsLimit),
      ]);

      topArtists = { all: topArtistsAll, month: topArtistsMonth, week: topArtistsWeek };
      topAlbums = { all: topAlbumsAll, month: topAlbumsMonth, week: topAlbumsWeek };
    } catch (err) {
      console.warn("[Last.fm] API stats failed, using DB fallback:", err.message);
      // Fall through to DB-based stats
    }
  }

  // Fall back to DB if API failed or client not provided
  if (topArtists.all.length === 0) {
    const [
      topArtistsAll,
      topArtistsMonth,
      topArtistsWeek,
      topAlbumsAll,
      topAlbumsMonth,
      topAlbumsWeek,
    ] = await Promise.all([
      getTopArtistsFromDb(db, "all", topArtistsLimit),
      getTopArtistsFromDb(db, "month", topArtistsLimit),
      getTopArtistsFromDb(db, "week", topArtistsLimit),
      getTopAlbumsFromDb(db, "all", topAlbumsLimit),
      getTopAlbumsFromDb(db, "month", topAlbumsLimit),
      getTopAlbumsFromDb(db, "week", topAlbumsLimit),
    ]);

    topArtists = { all: topArtistsAll, month: topArtistsMonth, week: topArtistsWeek };
    topAlbums = { all: topAlbumsAll, month: topAlbumsMonth, week: topAlbumsWeek };
  }

  return {
    summary: {
      all: summaryAll,
      month: summaryMonth,
      week: summaryWeek,
    },
    topArtists,
    topAlbums,
    trends,
  };
}
