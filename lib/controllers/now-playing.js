import { LastFmClient } from "../lastfm-client.js";
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
      const { lastfmConfig } = request.app.locals.application;

      if (!lastfmConfig) {
        return response.status(500).json({ error: "Not configured" });
      }

      const { apiKey, username, cacheTtl } = lastfmConfig;

      const client = new LastFmClient({
        apiKey,
        username,
        cacheTtl: Math.min(cacheTtl, 60_000), // Max 1 minute cache for now playing
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
      response.status(500).json({ error: error.message });
    }
  },
};
