import { LastFmClient } from "../lastfm-client.js";
import { getEffectiveConfig } from "../config.js";
import * as utils from "../utils.js";

/**
 * Now Playing controller
 */
export const nowPlayingController = {
  /**
   * JSON API for now playing / recently played
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

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl: Math.min(lastfmConfig.cacheTtl, 60_000),
      });

      const track = await client.getLatestScrobble();

      if (!track) {
        return response.json({
          playing: false,
          status: null,
          message: "No recent plays",
        });
      }

      const formatted = utils.formatScrobble(track);

      response.json({
        playing: formatted.status === "now-playing",
        status: formatted.status,
        track: formatted.track,
        artist: formatted.artist,
        album: formatted.album,
        coverUrl: formatted.coverUrl,
        trackUrl: formatted.trackUrl,
        loved: formatted.loved,
        scrobbledAt: formatted.scrobbledAt,
        relativeTime: formatted.relativeTime,
      });
    } catch (error) {
      console.error("[Last.fm] Now Playing API error:", error);
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
