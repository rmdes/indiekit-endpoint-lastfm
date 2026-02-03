import { LastFmClient } from "../lastfm-client.js";
import { getEffectiveConfig } from "../config.js";
import * as utils from "../utils.js";

/**
 * Scrobbles controller
 */
export const scrobblesController = {
  /**
   * JSON API for scrobbles
   * @type {import("express").RequestHandler}
   */
  async api(request, response, next) {
    try {
      const { application } = request.app.locals;
      const { lastfmConfig } = application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      const db = application.getLastfmDb?.();
      const { apiKey, username } = await getEffectiveConfig(db, lastfmConfig);
      const limits = lastfmConfig.limits || {};
      const page = parseInt(request.query.page) || 1;
      const limit = Math.min(
        parseInt(request.query.limit) || limits.scrobbles || 20,
        200
      );

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl: lastfmConfig.cacheTtl,
      });

      const scrobblesRes = await client.getRecentTracks(page, limit);
      const tracks = scrobblesRes.recenttracks?.track || [];
      const scrobbles = tracks.map((s) => utils.formatScrobble(s));

      const attrs = scrobblesRes.recenttracks?.["@attr"] || {};
      const totalPages = parseInt(attrs.totalPages) || 1;

      response.json({
        scrobbles,
        total: parseInt(attrs.total) || scrobbles.length,
        page: parseInt(attrs.page) || page,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      });
    } catch (error) {
      console.error("[Last.fm] Scrobbles API error:", error);
      // Use error status if available (from IndiekitError), otherwise 500
      const status = error.status || 500;
      // For transient errors (503), suggest retry
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
