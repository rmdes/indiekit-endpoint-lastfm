/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} [maxLength] - Maximum length
 * @returns {string} - Truncated text
 */
export function truncate(text, maxLength = 80) {
  if (!text || text.length <= maxLength) return text || "";
  return text.slice(0, maxLength - 1) + "...";
}

/**
 * Get the artist name from a Last.fm track
 * @param {object} track - Last.fm track object
 * @returns {string} - Artist name
 */
export function getArtistName(track) {
  if (!track) return "Unknown Artist";

  // Extended format has artist.name
  if (track.artist?.name) {
    return track.artist.name;
  }

  // Standard format has artist["#text"]
  if (track.artist?.["#text"]) {
    return track.artist["#text"];
  }

  // Sometimes it's just a string
  if (typeof track.artist === "string") {
    return track.artist;
  }

  return "Unknown Artist";
}

/**
 * Get the album name from a Last.fm track
 * @param {object} track - Last.fm track object
 * @returns {string|null} - Album name or null
 */
export function getAlbumName(track) {
  if (!track?.album) return null;

  if (track.album["#text"]) {
    return track.album["#text"];
  }

  if (typeof track.album === "string") {
    return track.album;
  }

  return null;
}

/**
 * Get the best available cover URL from a Last.fm track
 * @param {object} track - Last.fm track object
 * @param {string} [preferredSize] - Size preference: 'small', 'medium', 'large', 'extralarge'
 * @returns {string|null} - Cover URL or null
 */
export function getCoverUrl(track, preferredSize = "extralarge") {
  if (!track?.image || !Array.isArray(track.image)) return null;

  // Size priority order
  const sizePriority = ["extralarge", "large", "medium", "small"];
  const startIndex = sizePriority.indexOf(preferredSize);
  const orderedSizes = [
    ...sizePriority.slice(startIndex),
    ...sizePriority.slice(0, startIndex),
  ];

  for (const size of orderedSizes) {
    const img = track.image.find((i) => i.size === size);
    if (img?.["#text"]) {
      return img["#text"];
    }
  }

  // Fall back to any available image
  const anyImg = track.image.find((i) => i["#text"]);
  return anyImg?.["#text"] || null;
}

/**
 * Get the track URL on Last.fm
 * @param {object} track - Last.fm track object
 * @returns {string|null} - Track URL or null
 */
export function getTrackUrl(track) {
  return track?.url || null;
}

/**
 * Get the MusicBrainz ID if available
 * @param {object} track - Last.fm track object
 * @returns {string|null} - MBID or null
 */
export function getMbid(track) {
  return track?.mbid || null;
}

/**
 * Parse Unix timestamp from Last.fm date object
 * @param {object|string} dateInput - Last.fm date object or ISO string
 * @returns {Date} - JavaScript Date object
 */
export function parseDate(dateInput) {
  if (!dateInput) return new Date();

  // If it's a Last.fm date object with uts (Unix timestamp)
  if (dateInput.uts) {
    return new Date(parseInt(dateInput.uts) * 1000);
  }

  // If it's already a Date or ISO string
  return new Date(dateInput);
}

/**
 * Format duration in seconds to human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration (e.g., "3:45" or "1h 23m")
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format total listening time for stats display
 * @param {number} seconds - Total seconds
 * @returns {string} - Human-readable duration
 */
export function formatTotalTime(seconds) {
  if (!seconds || seconds < 0) return "0 minutes";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days} days`;
  }

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours} hours`;
  }

  return `${minutes} minutes`;
}

/**
 * Format date for display
 * @param {string|Date|object} dateInput - ISO date string, Date object, or Last.fm date
 * @param {string} [locale] - Locale for formatting
 * @returns {string} - Formatted date
 */
export function formatDate(dateInput, locale = "en") {
  const date = parseDate(dateInput);
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format relative time
 * @param {string|Date|object} dateInput - ISO date string, Date object, or Last.fm date
 * @returns {string} - Relative time string
 */
export function formatRelativeTime(dateInput) {
  const date = parseDate(dateInput);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(dateInput);
}

/**
 * Determine the playing status based on track attributes or timestamp
 * @param {object} track - Last.fm track object
 * @returns {string|null} - 'now-playing', 'recently-played', or null
 */
export function getPlayingStatus(track) {
  // Check if currently playing via Last.fm attribute
  if (track["@attr"]?.nowplaying === "true") {
    return "now-playing";
  }

  // Otherwise check based on timestamp
  const date = parseDate(track.date);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = diffMs / 60_000;

  if (diffMins < 60) {
    return "now-playing";
  }

  if (diffMins < 24 * 60) {
    return "recently-played";
  }

  return null;
}

/**
 * Format a scrobble entry for API response
 * @param {object} scrobble - Last.fm track object or MongoDB document
 * @param {boolean} [fromDb] - Whether the scrobble is from MongoDB
 * @returns {object} - Formatted scrobble
 */
export function formatScrobble(scrobble, fromDb = false) {
  if (fromDb) {
    // From MongoDB
    const scrobbledAt = scrobble.scrobbledAt;
    return {
      id: scrobble.lastfmId || scrobble._id?.toString(),
      track: scrobble.trackTitle,
      artist: scrobble.artistName,
      album: scrobble.albumTitle,
      coverUrl: scrobble.coverUrl,
      trackUrl: scrobble.trackUrl,
      mbid: scrobble.mbid,
      loved: scrobble.loved || false,
      scrobbledAt: scrobbledAt.toISOString(),
      relativeTime: formatRelativeTime(scrobbledAt),
      status: getPlayingStatus({ date: scrobbledAt }),
    };
  }

  // From API
  const scrobbledAt = parseDate(scrobble.date);
  const isNowPlaying = scrobble["@attr"]?.nowplaying === "true";

  return {
    id: `${scrobble.artist?.mbid || ""}:${scrobble.mbid || scrobble.name}:${scrobbledAt.getTime()}`,
    track: scrobble.name,
    artist: getArtistName(scrobble),
    album: getAlbumName(scrobble),
    coverUrl: getCoverUrl(scrobble),
    trackUrl: getTrackUrl(scrobble),
    mbid: getMbid(scrobble),
    loved: scrobble.loved === "1",
    scrobbledAt: isNowPlaying ? new Date().toISOString() : scrobbledAt.toISOString(),
    relativeTime: isNowPlaying ? "now" : formatRelativeTime(scrobbledAt),
    status: getPlayingStatus(scrobble),
  };
}

/**
 * Format a loved track entry for API response
 * @param {object} track - Last.fm loved track object
 * @returns {object} - Formatted loved track
 */
export function formatLovedTrack(track) {
  const lovedAt = parseDate(track.date);

  return {
    id: track.mbid || `${getArtistName(track)}:${track.name}`,
    track: track.name,
    artist: getArtistName(track),
    coverUrl: getCoverUrl(track),
    trackUrl: getTrackUrl(track),
    mbid: getMbid(track),
    lovedAt: lovedAt.toISOString(),
    relativeTime: formatRelativeTime(lovedAt),
  };
}

/**
 * Format a top artist entry for API response
 * @param {object} artist - Last.fm top artist object
 * @param {number} rank - Artist rank
 * @returns {object} - Formatted artist
 */
export function formatTopArtist(artist, rank) {
  // Handle edge cases where artist data might be malformed
  let name = artist?.name;
  if (typeof name !== "string") {
    name = name?.["#text"] || String(name || "Unknown Artist");
  }

  return {
    rank,
    name,
    playCount: parseInt(artist?.playcount) || 0,
    url: artist?.url || null,
    mbid: artist?.mbid || null,
    imageUrl: getCoverUrl(artist),
  };
}

/**
 * Format a top album entry for API response
 * @param {object} album - Last.fm top album object
 * @param {number} rank - Album rank
 * @returns {object} - Formatted album
 */
export function formatTopAlbum(album, rank) {
  // Handle edge cases where album data might be malformed
  let title = album?.name;
  if (typeof title !== "string") {
    title = title?.["#text"] || String(title || "Unknown Album");
  }

  // Extract artist name from various possible formats
  let artist = album?.artist;
  if (typeof artist === "object" && artist !== null) {
    artist = artist.name || artist["#text"] || "Unknown Artist";
  }
  if (typeof artist !== "string") {
    artist = String(artist || "Unknown Artist");
  }

  return {
    rank,
    title,
    artist,
    playCount: parseInt(album?.playcount) || 0,
    url: album?.url || null,
    mbid: album?.mbid || null,
    coverUrl: getCoverUrl(album),
  };
}

/**
 * Map Last.fm period to internal period name
 * @param {string} period - Last.fm period (7day, 1month, 3month, 6month, 12month, overall)
 * @returns {string} - Internal period name (week, month, all)
 */
export function mapPeriodToInternal(period) {
  switch (period) {
    case "7day":
      return "week";
    case "1month":
    case "3month":
      return "month";
    default:
      return "all";
  }
}

/**
 * Map internal period to Last.fm period
 * @param {string} period - Internal period (week, month, all)
 * @returns {string} - Last.fm period
 */
export function mapPeriodToLastfm(period) {
  switch (period) {
    case "week":
      return "7day";
    case "month":
      return "1month";
    default:
      return "overall";
  }
}
