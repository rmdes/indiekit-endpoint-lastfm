import { LastFmClient } from "../lastfm-client.js";
import * as utils from "../utils.js";

/**
 * Loved tracks controller
 */
export const lovedController = {
  /**
   * JSON API for loved tracks
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
        parseInt(request.query.limit) || limits.loved || 20,
        200
      );

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl,
      });

      const lovedRes = await client.getLovedTracks(page, limit);
      const tracks = lovedRes.lovedtracks?.track || [];
      const loved = tracks.map((t) => utils.formatLovedTrack(t));

      const attrs = lovedRes.lovedtracks?.["@attr"] || {};
      const totalPages = parseInt(attrs.totalPages) || 1;

      response.json({
        loved,
        total: parseInt(attrs.total) || loved.length,
        page: parseInt(attrs.page) || page,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      });
    } catch (error) {
      console.error("[Last.fm] Loved API error:", error);
      response.status(500).json({ error: error.message });
    }
  },
};
