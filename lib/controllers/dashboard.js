import { LastFmClient } from "../lastfm-client.js";
import { getEffectiveConfig } from "../config.js";
import { runSync, getCachedStats, refreshStatsCache } from "../sync.js";
import * as utils from "../utils.js";

/**
 * Extract and clear flash messages from session
 * Returns { success, error } for Indiekit's native notificationBanner
 */
function consumeFlashMessage(request) {
  const result = {};
  if (request.session?.messages?.length) {
    const msg = request.session.messages[0];
    if (msg.type === "success") result.success = msg.content;
    else if (msg.type === "error" || msg.type === "warning")
      result.error = msg.content;
    request.session.messages = null;
  }
  return result;
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

      // Extract flash messages for native Indiekit notification banner
      const flash = consumeFlashMessage(request);

      // If no credentials, show settings form only
      if (!apiKey || !username) {
        return response.render("lastfm", {
          title: response.__("lastfm.title"),
          configError: response.__("lastfm.error.noConfig"),
          settings: { apiKey: "", username: "" },
          mountPath: request.baseUrl,
          ...flash,
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
          ...flash,
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

      // Public page is the combined /listening page
      const publicUrl = "/listening";

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
        ...flash,
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
      request.session.messages = [
        { type: "success", content: request.__("lastfm.settingsSaved") },
      ];
      response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[Last.fm] Settings save error:", error);
      request.session.messages = [
        { type: "error", content: error.message },
      ];
      response.redirect(request.baseUrl);
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
      const result = await runSync({ database: db }, syncOptions);

      request.session.messages = [
        {
          type: "success",
          content: `Synced ${result.synced || 0} new scrobbles`,
        },
      ];
      response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[Last.fm] Manual sync error:", error);
      request.session.messages = [
        { type: "error", content: error.message },
      ];
      response.redirect(request.baseUrl);
    }
  },
};
