import { LastFmClient } from "./lastfm-client.js";
import { getCoverUrl, getArtistName, getAlbumName, parseDate, getMbid, getTrackUrl } from "./utils.js";
import { getAllStats } from "./stats.js";

let syncInterval = null;

// In-memory cache for stats (accessible to public routes)
let cachedStats = null;
let cachedStatsTime = null;
const STATS_CACHE_TTL = 300_000; // 5 minutes

/**
 * Get cached stats (for public API routes that can't access DB)
 * @returns {object|null} - Cached stats or null
 */
export function getCachedStats() {
  if (!cachedStats) return null;
  if (cachedStatsTime && Date.now() - cachedStatsTime > STATS_CACHE_TTL) {
    return cachedStats; // Return stale cache, sync will refresh
  }
  return cachedStats;
}

/**
 * Update stats cache
 * @param {object} stats - Stats to cache
 */
export function setCachedStats(stats) {
  cachedStats = stats;
  cachedStatsTime = Date.now();
}

/**
 * Refresh stats cache from database (for when cache is empty)
 * @param {object} db - MongoDB database instance
 * @param {object} limits - Limits for top lists
 * @param {object} client - LastFmClient instance for API-based stats
 * @returns {Promise<object|null>} - Stats or null if failed
 */
export async function refreshStatsCache(db, limits = {}, client = null) {
  if (!db) return null;
  try {
    const stats = await getAllStats(db, limits, client);
    setCachedStats(stats);
    console.log("[Last.fm] Stats cache refreshed on-demand");
    return stats;
  } catch (err) {
    console.error("[Last.fm] Failed to refresh stats cache:", err.message);
    return null;
  }
}

/**
 * Start background sync process
 * @param {object} Indiekit - Indiekit instance
 * @param {object} options - Plugin options
 */
export function startSync(Indiekit, options) {
  const intervalMs = options.syncInterval || 300_000; // 5 minutes default

  // Initial sync after a short delay
  setTimeout(() => {
    runSync(Indiekit, options).catch((err) => {
      console.error("[Last.fm] Initial sync error:", err.message);
    });
  }, 5000);

  // Schedule recurring sync
  syncInterval = setInterval(() => {
    runSync(Indiekit, options).catch((err) => {
      console.error("[Last.fm] Sync error:", err.message);
    });
  }, intervalMs);

  console.log(
    `[Last.fm] Background sync started (interval: ${intervalMs / 1000}s)`
  );
}

/**
 * Stop background sync
 */
export function stopSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[Last.fm] Background sync stopped");
  }
}

/**
 * Get effective config from DB settings, falling back to env var config
 * @param {object} db - MongoDB database instance
 * @param {object} options - Plugin config from env vars
 * @returns {Promise<object>} Options with effective settings
 */
async function getEffectiveSyncOptions(db, options) {
  try {
    const settings = await db
      .collection("lastfmMeta")
      .findOne({ key: "settings" });
    if (settings) {
      return {
        ...options,
        apiKey: settings.apiKey || options.apiKey,
        username: settings.username || options.username,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return options;
}

/**
 * Run a single sync operation
 * @param {object} Indiekit - Indiekit instance (or {database} object)
 * @param {object} options - Plugin options
 * @returns {Promise<object>} - Sync result
 */
export async function runSync(Indiekit, options) {
  const db = Indiekit.database;
  if (!db) {
    console.log("[Last.fm] No database available, skipping sync");
    return { synced: 0, error: "No database" };
  }

  // Use effective config (DB settings override env vars)
  const effectiveOptions = await getEffectiveSyncOptions(db, options);

  if (!effectiveOptions.apiKey || !effectiveOptions.username) {
    console.log("[Last.fm] No API key or username configured, skipping sync");
    return { synced: 0, error: "Not configured" };
  }

  const client = new LastFmClient({
    apiKey: effectiveOptions.apiKey,
    username: effectiveOptions.username,
    cacheTtl: 60_000, // Short cache for sync
  });

  const result = await syncScrobbles(db, client);

  // Update stats cache after sync
  try {
    const stats = await getAllStats(db, effectiveOptions.limits || {}, client);
    setCachedStats(stats);
    console.log("[Last.fm] Stats cache updated");
  } catch (err) {
    console.error("[Last.fm] Failed to cache stats:", err.message);
  }

  return result;
}

/**
 * Sync scrobbles to MongoDB
 * @param {object} db - MongoDB database instance
 * @param {LastFmClient} client - Last.fm API client
 * @returns {Promise<object>} - Sync result
 */
export async function syncScrobbles(db, client) {
  const collection = db.collection("scrobbles");

  // Create indexes for efficient queries
  await collection.createIndex({ lastfmId: 1 }, { unique: true, sparse: true });
  // Create compound index for deduplication (same track at same time)
  await collection.createIndex(
    { trackTitle: 1, artistName: 1, scrobbledAt: 1 },
    { unique: true }
  );
  // Create index on scrobbledAt for time-based queries
  await collection.createIndex({ scrobbledAt: -1 });
  // Create indexes for aggregation
  await collection.createIndex({ artistName: 1 });
  await collection.createIndex({ albumTitle: 1 });

  // Get the latest synced scrobble
  const latest = await collection.findOne({}, { sort: { scrobbledAt: -1 } });
  const latestDate = latest?.scrobbledAt || new Date(0);

  console.log(
    `[Last.fm] Syncing scrobbles since: ${latestDate.toISOString()}`
  );

  // Fetch new scrobbles
  let newScrobbles;
  if (latestDate.getTime() === 0) {
    // First sync: get recent history (not all-time to avoid rate limits)
    console.log("[Last.fm] First sync, fetching recent scrobbles...");
    newScrobbles = await client.getAllRecentTracks(10); // ~2000 tracks max
  } else {
    // Incremental sync
    newScrobbles = await client.getNewScrobbles(latestDate);
  }

  if (newScrobbles.length === 0) {
    console.log("[Last.fm] No new scrobbles to sync");
    return { synced: 0 };
  }

  console.log(`[Last.fm] Found ${newScrobbles.length} new scrobbles`);

  // Transform to our schema
  const docs = newScrobbles.map((s) => transformScrobble(s));

  // Upsert each document (in case of duplicates)
  let synced = 0;
  for (const doc of docs) {
    try {
      await collection.updateOne(
        {
          trackTitle: doc.trackTitle,
          artistName: doc.artistName,
          scrobbledAt: doc.scrobbledAt,
        },
        { $set: doc },
        { upsert: true }
      );
      synced++;
    } catch (err) {
      // Ignore duplicate key errors
      if (err.code !== 11000) {
        console.error(`[Last.fm] Error inserting scrobble:`, err.message);
      }
    }
  }

  console.log(`[Last.fm] Synced ${synced} scrobbles`);
  return { synced };
}

/**
 * Transform Last.fm scrobble to our schema
 * @param {object} scrobble - Last.fm track object
 * @returns {object} - Transformed document
 */
function transformScrobble(scrobble) {
  const scrobbledAt = parseDate(scrobble.date);
  const artistName = getArtistName(scrobble);
  const albumTitle = getAlbumName(scrobble);

  return {
    // Create a unique ID from track info and timestamp
    lastfmId: `${artistName}:${scrobble.name}:${scrobbledAt.getTime()}`,
    trackTitle: scrobble.name,
    trackUrl: getTrackUrl(scrobble),
    artistName,
    artistMbid: scrobble.artist?.mbid || null,
    albumTitle,
    albumMbid: scrobble.album?.mbid || null,
    mbid: getMbid(scrobble),
    coverUrl: getCoverUrl(scrobble),
    loved: scrobble.loved === "1",
    scrobbledAt,
    syncedAt: new Date(),
  };
}
