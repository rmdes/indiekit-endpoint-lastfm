import { LastFmClient } from "../lastfm-client.js";
import { runSync, getCachedStats, refreshStatsCache } from "../sync.js";
import * as utils from "../utils.js";

/**
 * Get effective config: DB-stored settings override env var defaults
 * @param {object} db - MongoDB database instance
 * @param {object} lastfmConfig - Plugin config from env vars
 * @returns {Promise<object>} Effective apiKey and username
 */
async function getEffectiveConfig(db, lastfmConfig) {
  let apiKey = lastfmConfig?.apiKey || "";
  let username = lastfmConfig?.username || "";

  if (db) {
    try {
      const settings = await db
        .collection("lastfmMeta")
        .findOne({ key: "settings" });
      if (settings) {
        if (settings.apiKey) apiKey = settings.apiKey;
        if (settings.username) username = settings.username;
      }
    } catch {
      // Fall through to defaults
    }
  }

  return { apiKey, username };
}

/**
 * Dashboard controller
 */
export const dashboardController = {
  /**
   * Render dashboard page
   * @type {import("express").RequestHandler}
   */
  async get(request, response, next) {
    try {
      const { application } = request.app.locals;
      const { lastfmConfig, lastfmEndpoint } = application;

      if (!lastfmConfig) {
        return response.status(500).render("lastfm", {
          title: "Last.fm",
          configError: "Last.fm endpoint not configured",
        });
      }

      const db = application.getLastfmDb?.();
      const config = await getEffectiveConfig(db, lastfmConfig);
      const { apiKey, username } = config;

      // If no credentials, show settings form only
      if (!apiKey || !username) {
        return response.render("lastfm", {
          title: response.__("lastfm.title"),
          configError: response.__("lastfm.error.noConfig"),
          settings: { apiKey: "", username: "" },
          mountPath: request.baseUrl,
        });
      }

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl: lastfmConfig.cacheTtl,
      });

      // Fetch recent data from API
      let scrobbles = [];
      let lovedTracks = [];
      let nowPlaying = null;
      let userInfo = null;

      try {
        const limits = lastfmConfig.limits || {};
        const [scrobblesRes, lovedRes, userRes] = await Promise.all([
          client.getRecentTracks(1, limits.scrobbles || 10),
          client.getLovedTracks(1, limits.loved || 5),
          client.getUserInfo(),
        ]);

        const tracks = scrobblesRes.recenttracks?.track || [];
        scrobbles = tracks.map((s) => utils.formatScrobble(s));
        lovedTracks = (lovedRes.lovedtracks?.track || []).map((t) =>
          utils.formatLovedTrack(t),
        );
        userInfo = userRes.user || null;

        // Check for now playing
        if (scrobbles.length > 0 && scrobbles[0].status) {
          nowPlaying = scrobbles[0];
        }
      } catch (apiError) {
        console.error("[Last.fm] API error:", apiError.message);
        return response.render("lastfm", {
          title: response.__("lastfm.title"),
          configError: response.__("lastfm.error.connection"),
          settings: { apiKey, username },
          mountPath: request.baseUrl,
        });
      }

      // Get stats from cache
      let cachedStatsData = getCachedStats();
      if (!cachedStatsData && db) {
        cachedStatsData = await refreshStatsCache(
          db,
          lastfmConfig.limits || {},
          client,
        );
      }
      const summary = cachedStatsData?.summary?.all || null;

      // Determine public frontend URL
      const publicUrl = lastfmEndpoint
        ? lastfmEndpoint.replace(/api$/, "")
        : "/lastfm";

      response.render("lastfm", {
        title: response.__("lastfm.title"),
        nowPlaying,
        scrobbles: scrobbles.slice(0, 5),
        lovedTracks: lovedTracks.slice(0, 5),
        totalPlays: summary?.totalPlays || userInfo?.playcount || 0,
        uniqueTracks: summary?.uniqueTracks || 0,
        uniqueArtists: summary?.uniqueArtists || 0,
        hasStats: !!summary,
        userInfo,
        publicUrl,
        mountPath: request.baseUrl,
        settings: { apiKey, username },
        synced: request.query.synced,
        saved: request.query.saved,
        queryError: request.query.error,
      });
    } catch (error) {
      console.error("[Last.fm] Dashboard error:", error);
      next(error);
    }
  },

  /**
   * Save settings
   * POST /settings
   */
  async saveSettings(request, response) {
    try {
      const { application } = request.app.locals;
      const db = application.getLastfmDb?.();

      if (!db) {
        return response.status(503).json({ error: "Database not available" });
      }

      const { apiKey, username } = request.body;

      await db.collection("lastfmMeta").updateOne(
        { key: "settings" },
        {
          $set: {
            key: "settings",
            apiKey: apiKey || "",
            username: username || "",
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      console.log("[Last.fm] Settings saved");
      response.redirect(request.baseUrl + "?saved=true");
    } catch (error) {
      console.error("[Last.fm] Settings save error:", error);
      response.redirect(
        request.baseUrl + "?error=" + encodeURIComponent(error.message),
      );
    }
  },

  /**
   * Trigger manual sync
   * @type {import("express").RequestHandler}
   */
  async sync(request, response) {
    try {
      const { application } = request.app.locals;
      const { lastfmConfig } = application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      const db = application.getLastfmDb?.();
      if (!db) {
        return response.status(500).json({ error: "Database not available" });
      }

      // Use effective config (DB settings override env vars)
      const config = await getEffectiveConfig(db, lastfmConfig);
      const syncOptions = { ...lastfmConfig, ...config };

      // Build a minimal Indiekit-like object for runSync
      const result = await runSync(
        { database: db },
        syncOptions,
      );

      response.redirect(request.baseUrl + "?synced=" + (result.synced || 0));
    } catch (error) {
      console.error("[Last.fm] Manual sync error:", error);
      response.redirect(
        request.baseUrl + "?error=" + encodeURIComponent(error.message),
      );
    }
  },
};
