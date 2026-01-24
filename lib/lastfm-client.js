import { IndiekitError } from "@indiekit/error";

const API_BASE = "https://ws.audioscrobbler.com/2.0/";

export class LastFmClient {
  /**
   * @param {object} options - Client options
   * @param {string} options.apiKey - Last.fm API key
   * @param {string} options.username - Last.fm username to fetch data for
   * @param {number} [options.cacheTtl] - Cache TTL in milliseconds
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.username = options.username;
    this.cacheTtl = options.cacheTtl || 900_000;
    this.cache = new Map();
  }

  /**
   * Fetch from Last.fm API with caching
   * @param {string} method - API method name
   * @param {object} [params] - Additional query parameters
   * @returns {Promise<object>} - Response data
   */
  async fetch(method, params = {}) {
    const url = new URL(API_BASE);
    url.searchParams.set("method", method);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("user", this.username);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    const cacheKey = url.toString();

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.data;
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "indiekit-endpoint-lastfm/1.0.0",
      },
    });

    // Check content type before parsing
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      // Handle non-JSON error responses (e.g., HTML error pages)
      if (!contentType.includes("application/json")) {
        const text = await response.text();
        console.error("[Last.fm] Non-JSON error response:", text.slice(0, 200));
        throw new IndiekitError(`Last.fm API returned ${response.status}: ${response.statusText}`, {
          status: response.status,
        });
      }
      throw await IndiekitError.fromFetch(response);
    }

    // Handle non-JSON success responses (shouldn't happen but be safe)
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      console.error("[Last.fm] Unexpected non-JSON response:", text.slice(0, 200));
      throw new Error("Last.fm API returned non-JSON response");
    }

    const data = await response.json();

    // Check for Last.fm API errors
    if (data.error) {
      throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
    }

    // Cache result
    this.cache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  }

  /**
   * Get recent tracks (scrobbles)
   * @param {number} [page] - Page number
   * @param {number} [limit] - Items per page (max 200)
   * @param {number} [from] - Start timestamp (UNIX)
   * @param {number} [to] - End timestamp (UNIX)
   * @returns {Promise<object>} - Recent tracks response
   */
  async getRecentTracks(page = 1, limit = 50, from = null, to = null) {
    const params = {
      page,
      limit: Math.min(limit, 200),
      extended: 1, // Include loved status and artist info
    };

    if (from) params.from = from;
    if (to) params.to = to;

    return this.fetch("user.getRecentTracks", params);
  }

  /**
   * Get all recent tracks by paginating through all pages
   * @param {number} [maxPages] - Maximum pages to fetch (safety limit)
   * @returns {Promise<Array>} - All recent tracks
   */
  async getAllRecentTracks(maxPages = 50) {
    const allTracks = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const response = await this.getRecentTracks(page, 200);
      const tracks = response.recenttracks?.track || [];

      // Filter out "now playing" track (has @attr.nowplaying)
      const scrobbledTracks = tracks.filter((t) => !t["@attr"]?.nowplaying);
      allTracks.push(...scrobbledTracks);

      const totalPages = parseInt(response.recenttracks?.["@attr"]?.totalPages) || 1;
      hasMore = page < totalPages;
      page++;
    }

    return allTracks;
  }

  /**
   * Get new scrobbles since a given timestamp
   * Used for incremental sync
   * @param {Date} since - Only fetch scrobbles after this date
   * @returns {Promise<Array>} - New scrobbles
   */
  async getNewScrobbles(since) {
    const fromTimestamp = Math.floor(since.getTime() / 1000);
    const newScrobbles = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getRecentTracks(page, 200, fromTimestamp);
      const tracks = response.recenttracks?.track || [];

      // Filter out "now playing" track
      const scrobbledTracks = tracks.filter((t) => !t["@attr"]?.nowplaying);
      newScrobbles.push(...scrobbledTracks);

      const totalPages = parseInt(response.recenttracks?.["@attr"]?.totalPages) || 1;
      hasMore = page < totalPages;
      page++;
    }

    return newScrobbles;
  }

  /**
   * Get loved tracks
   * @param {number} [page] - Page number
   * @param {number} [limit] - Items per page
   * @returns {Promise<object>} - Loved tracks response
   */
  async getLovedTracks(page = 1, limit = 50) {
    return this.fetch("user.getLovedTracks", {
      page,
      limit: Math.min(limit, 200),
    });
  }

  /**
   * Get all loved tracks
   * @param {number} [maxPages] - Maximum pages to fetch
   * @returns {Promise<Array>} - All loved tracks
   */
  async getAllLovedTracks(maxPages = 20) {
    const allTracks = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const response = await this.getLovedTracks(page, 200);
      const tracks = response.lovedtracks?.track || [];
      allTracks.push(...tracks);

      const totalPages = parseInt(response.lovedtracks?.["@attr"]?.totalPages) || 1;
      hasMore = page < totalPages;
      page++;
    }

    return allTracks;
  }

  /**
   * Get top artists for a time period
   * @param {string} [period] - Time period: overall, 7day, 1month, 3month, 6month, 12month
   * @param {number} [limit] - Number of artists to return
   * @returns {Promise<object>} - Top artists response
   */
  async getTopArtists(period = "overall", limit = 10) {
    return this.fetch("user.getTopArtists", {
      period,
      limit,
    });
  }

  /**
   * Get top albums for a time period
   * @param {string} [period] - Time period: overall, 7day, 1month, 3month, 6month, 12month
   * @param {number} [limit] - Number of albums to return
   * @returns {Promise<object>} - Top albums response
   */
  async getTopAlbums(period = "overall", limit = 10) {
    return this.fetch("user.getTopAlbums", {
      period,
      limit,
    });
  }

  /**
   * Get top tracks for a time period
   * @param {string} [period] - Time period: overall, 7day, 1month, 3month, 6month, 12month
   * @param {number} [limit] - Number of tracks to return
   * @returns {Promise<object>} - Top tracks response
   */
  async getTopTracks(period = "overall", limit = 10) {
    return this.fetch("user.getTopTracks", {
      period,
      limit,
    });
  }

  /**
   * Get user info
   * @returns {Promise<object>} - User info response
   */
  async getUserInfo() {
    return this.fetch("user.getInfo");
  }

  /**
   * Get the most recent scrobble (or now playing)
   * @returns {Promise<object|null>} - Most recent track or null
   */
  async getLatestScrobble() {
    const response = await this.getRecentTracks(1, 1);
    return response.recenttracks?.track?.[0] || null;
  }

  /**
   * Check if currently playing
   * @returns {Promise<object|null>} - Now playing track or null
   */
  async getNowPlaying() {
    const response = await this.getRecentTracks(1, 1);
    const track = response.recenttracks?.track?.[0];

    if (track && track["@attr"]?.nowplaying === "true") {
      return track;
    }

    return null;
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
}
