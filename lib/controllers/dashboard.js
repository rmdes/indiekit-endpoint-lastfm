import { LastFmClient } from "../lastfm-client.js";
import { runSync, getCachedStats, refreshStatsCache } from "../sync.js";
import * as utils from "../utils.js";

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
      const { lastfmConfig, lastfmEndpoint } = request.app.locals.application;

      if (!lastfmConfig) {
        return response.status(500).render("lastfm", {
          title: "Last.fm",
          error: { message: "Last.fm endpoint not configured" },
        });
      }

      const { apiKey, username, cacheTtl, limits } = lastfmConfig;

      if (!apiKey || !username) {
        return response.render("lastfm", {
          title: response.locals.__("lastfm.title"),
          error: { message: response.locals.__("lastfm.error.noConfig") },
        });
      }

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl,
      });

      // Fetch recent data from API
      let scrobbles = [];
      let lovedTracks = [];
      let nowPlaying = null;
      let userInfo = null;

      try {
        const [scrobblesRes, lovedRes, userRes] = await Promise.all([
          client.getRecentTracks(1, limits.scrobbles || 10),
          client.getLovedTracks(1, limits.loved || 5),
          client.getUserInfo(),
        ]);

        const tracks = scrobblesRes.recenttracks?.track || [];
        scrobbles = tracks.map((s) => utils.formatScrobble(s));
        lovedTracks = (lovedRes.lovedtracks?.track || []).map((t) =>
          utils.formatLovedTrack(t)
        );
        userInfo = userRes.user || null;

        // Check for now playing
        if (scrobbles.length > 0 && scrobbles[0].status) {
          nowPlaying = scrobbles[0];
        }
      } catch (apiError) {
        console.error("[Last.fm] API error:", apiError.message);
        return response.render("lastfm", {
          title: response.locals.__("lastfm.title"),
          error: { message: response.locals.__("lastfm.error.connection") },
        });
      }

      // Get stats from cache (same source as public API)
      // If cache is empty, try to refresh it from database
      let cachedStats = getCachedStats();
      if (!cachedStats) {
        const getDb = request.app.locals.application.getLastfmDb;
        if (getDb) {
          const db = getDb();
          if (db) {
            cachedStats = await refreshStatsCache(db, limits, client);
          }
        }
      }
      const summary = cachedStats?.summary?.all || null;

      // Determine public frontend URL (strip 'api' from mount path)
      // e.g., /lastfmapi -> /lastfm
      const publicUrl = lastfmEndpoint
        ? lastfmEndpoint.replace(/api$/, "")
        : "/lastfm";

      response.render("lastfm", {
        title: response.locals.__("lastfm.title"),
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
      });
    } catch (error) {
      console.error("[Last.fm] Dashboard error:", error);
      next(error);
    }
  },

  /**
   * Trigger manual sync
   * @type {import("express").RequestHandler}
   */
  async sync(request, response, next) {
    try {
      const { lastfmConfig } = request.app.locals.application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      // Get Indiekit instance from app
      const Indiekit = request.app.locals.indiekit;
      if (!Indiekit || !Indiekit.database) {
        return response.status(500).json({ error: "Database not available" });
      }

      const result = await runSync(Indiekit, lastfmConfig);

      response.json({
        success: true,
        synced: result.synced,
        message: `Synced ${result.synced} new scrobbles`,
      });
    } catch (error) {
      console.error("[Last.fm] Manual sync error:", error);
      response.status(500).json({ error: error.message });
    }
  },
};
