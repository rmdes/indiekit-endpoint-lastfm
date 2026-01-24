import { LastFmClient } from "../lastfm-client.js";
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
      const { lastfmConfig } = request.app.locals.application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      const { apiKey, username, cacheTtl, limits } = lastfmConfig;
      const page = parseInt(request.query.page) || 1;
      const limit = Math.min(
        parseInt(request.query.limit) || limits.scrobbles || 20,
        200
      );

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl,
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
      response.status(500).json({ error: error.message });
    }
  },
};
