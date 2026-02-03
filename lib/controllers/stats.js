import { LastFmClient } from "../lastfm-client.js";
import { getEffectiveConfig } from "../config.js";
import { getAllStats, getScrobbleTrends } from "../stats.js";
import { getCachedStats } from "../sync.js";

/**
 * Stats controller
 */
export const statsController = {
  /**
   * JSON API for all stats
   * @type {import("express").RequestHandler}
   */
  async api(request, response, next) {
    try {
      const { application } = request.app.locals;
      const { lastfmConfig } = application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      // Try database first, fall back to cache for public routes
      const db = application.getLastfmDb?.();
      let stats;

      if (db) {
        const { apiKey, username } = await getEffectiveConfig(db, lastfmConfig);
        const client = new LastFmClient({
          apiKey,
          username,
          cacheTtl: lastfmConfig.cacheTtl,
        });

        stats = await getAllStats(db, lastfmConfig.limits, client);
      } else {
        // Public routes don't have DB access, use cached stats
        stats = getCachedStats();
        if (!stats) {
          return response.status(503).json({
            error: "Stats not available yet",
            message:
              "Stats are computed during background sync. Please try again shortly.",
          });
        }
      }

      response.json(stats);
    } catch (error) {
      console.error("[Last.fm] Stats API error:", error);
      const status = error.status || 500;
      if (status === 503) {
        response.set("Retry-After", "60");
      }
      response.status(status).json({
        error: error.message,
        code: error.code || "unknown",
        retryable: status === 503 || status === 502,
      });
    }
  },

  /**
   * JSON API for trends only (for charts)
   * @type {import("express").RequestHandler}
   */
  async apiTrends(request, response, next) {
    try {
      const { application } = request.app.locals;
      const { lastfmConfig } = application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      const db = application.getLastfmDb?.();
      const days = Math.min(parseInt(request.query.days) || 30, 90);

      if (db) {
        const trends = await getScrobbleTrends(db, days);
        return response.json({ trends, days });
      }

      // Fall back to cached stats for public routes
      const cachedStats = getCachedStats();
      if (cachedStats?.trends) {
        return response.json({ trends: cachedStats.trends, days: 30 });
      }

      return response.status(503).json({
        error: "Trends not available yet",
        message:
          "Trends are computed during background sync. Please try again shortly.",
      });
    } catch (error) {
      console.error("[Last.fm] Trends API error:", error);
      const status = error.status || 500;
      if (status === 503) {
        response.set("Retry-After", "60");
      }
      response.status(status).json({
        error: error.message,
        code: error.code || "unknown",
        retryable: status === 503 || status === 502,
      });
    }
  },
};
