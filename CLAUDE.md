# CLAUDE.md - Last.fm Listening Activity Endpoint

## Package Overview

**Name:** `@rmdes/indiekit-endpoint-lastfm`
**Version:** 1.0.10
**Type:** Indiekit endpoint plugin
**Repository:** https://github.com/rmdes/indiekit-endpoint-lastfm

Displays Last.fm scrobble and listening activity including recent tracks, loved tracks, listening statistics, and now playing status. Syncs scrobbles to MongoDB in the background and provides both an admin dashboard and public JSON API routes for Eleventy frontend integration.

## Architecture

### Entry Point
`index.js` exports the `LastFmEndpoint` class, which:
- Registers protected routes (admin dashboard)
- Registers public routes (JSON API for Eleventy widgets)
- Adds MongoDB collections (`scrobbles`, `lastfmMeta`)
- Starts background sync process (5min interval by default)
- Stores configuration in `application.lastfmConfig`

### Data Flow
```
Last.fm API (ws.audioscrobbler.com)
    ↓
LastFmClient (caching layer, 15min TTL)
    ↓
Background Sync (lib/sync.js, runs every 5min)
    ↓
MongoDB (scrobbles collection)
    ↓
Stats Aggregation (lib/stats.js)
    ↓
In-Memory Stats Cache (5min TTL)
    ↓
Controllers (dashboard, scrobbles, loved, stats, now-playing)
    ↓
Nunjucks views (admin) OR JSON API (public)
```

### Key Architectural Decisions
1. **Dual Data Sources:** Recent scrobbles from API (fast), historical data from MongoDB (complete)
2. **Stats Caching:** Aggregation queries are expensive, so stats are cached in-memory and refreshed during sync
3. **Public Route Access:** Public routes can't access MongoDB, so they rely on in-memory stats cache
4. **DB Settings Override:** Admin can configure API key/username in dashboard, which overrides env vars

## Key Files

| File | Purpose |
|------|---------|
| `index.js` | Plugin entry point, route registration, MongoDB setup, sync initialization |
| `lib/lastfm-client.js` | Last.fm API client with caching (15min TTL by default) |
| `lib/sync.js` | Background sync process, incremental scrobble fetching, stats cache management |
| `lib/stats.js` | MongoDB aggregation queries for top artists/albums/tracks, trends, summaries |
| `lib/utils.js` | Data transformation utilities (formatScrobble, getCoverUrl, parseDate, etc.) |
| `lib/config.js` | Database settings loader (admin UI settings override env vars) |
| `lib/controllers/dashboard.js` | Admin dashboard with overview, settings, and manual sync |
| `lib/controllers/scrobbles.js` | Recent scrobbles API |
| `lib/controllers/loved.js` | Loved tracks API |
| `lib/controllers/stats.js` | Statistics API (summary, top artists/albums, trends) |
| `lib/controllers/now-playing.js` | Now playing/recently played API |
| `views/lastfm.njk` | Admin dashboard template |
| `locales/en.json` | Internationalization strings |

## Routes

### Protected Routes (Admin)
Authentication required via Indiekit's auth middleware.

| Route | Controller | Method | Purpose |
|-------|------------|--------|---------|
| `GET /lastfm` | `dashboardController.get` | GET | Admin dashboard overview with settings form |
| `POST /lastfm/settings` | `dashboardController.saveSettings` | POST | Save API key/username to MongoDB |
| `POST /lastfm/sync` | `dashboardController.sync` | POST | Trigger manual sync (bypasses interval) |

### Public Routes (JSON API)
No authentication required. Used by Eleventy frontend widgets.

| Route | Controller | Response |
|-------|------------|----------|
| `GET /lastfm/api/now-playing` | `nowPlayingController.api` | `{ track: {...}, isPlaying: bool }` or null |
| `GET /lastfm/api/scrobbles?page=1&limit=20` | `scrobblesController.api` | `{ scrobbles: [...], total: N, page: N, hasNext: bool, hasPrev: bool }` |
| `GET /lastfm/api/loved?page=1&limit=20` | `lovedController.api` | `{ tracks: [...], total: N, page: N, hasNext: bool, hasPrev: bool }` |
| `GET /lastfm/api/stats` | `statsController.api` | `{ summary: {...}, topArtists: {...}, topAlbums: {...}, trends: [...] }` |
| `GET /lastfm/api/stats/trends?days=30` | `statsController.apiTrends` | `{ trends: [...], days: N }` |

## MongoDB Schema

### Collection: `scrobbles`
Stores all synced scrobbles.

```javascript
{
  _id: ObjectId,
  lastfmId: String,           // Unique ID: "Artist:Track:UnixTimestamp"
  trackTitle: String,
  trackUrl: String | null,
  artistName: String,
  artistMbid: String | null,  // MusicBrainz ID
  albumTitle: String | null,
  albumMbid: String | null,
  mbid: String | null,        // Track MusicBrainz ID
  coverUrl: String | null,    // Album art URL
  loved: Boolean,
  scrobbledAt: String,        // ISO 8601 string (e.g., "2025-02-13T14:30:00.000Z")
  syncedAt: String            // ISO 8601 string
}
```

**Indexes:**
- `{ lastfmId: 1 }` - Unique index for deduplication
- `{ trackTitle: 1, artistName: 1, scrobbledAt: 1 }` - Compound unique index (fallback deduplication)
- `{ scrobbledAt: -1 }` - Time-based queries (recent scrobbles, trends)
- `{ artistName: 1 }` - Aggregation queries (top artists)
- `{ albumTitle: 1 }` - Aggregation queries (top albums)

### Collection: `lastfmMeta`
Stores plugin metadata and user settings.

```javascript
{
  _id: ObjectId,
  key: "settings",            // Document type identifier
  apiKey: String,             // Last.fm API key (overrides env var)
  username: String,           // Last.fm username (overrides env var)
  updatedAt: Date
}
```

No indexes required (small collection, single document).

## Configuration Options

Configure in `indiekit.config.js`:

```javascript
import LastFmEndpoint from "@rmdes/indiekit-endpoint-lastfm";

export default {
  plugins: [
    new LastFmEndpoint({
      mountPath: "/lastfm",           // Admin route prefix (default: /lastfm)
      apiKey: process.env.LASTFM_API_KEY, // Last.fm API key (can be overridden in admin)
      username: process.env.LASTFM_USERNAME, // Last.fm username (can be overridden in admin)
      cacheTtl: 900_000,              // API cache TTL in ms (default: 15 minutes)
      syncInterval: 300_000,          // Background sync interval in ms (default: 5 minutes)
      limits: {
        scrobbles: 20,                // Max scrobbles per page (default: 20)
        loved: 20,                    // Max loved tracks per page (default: 20)
        topArtists: 10,               // Max top artists (default: 10)
        topAlbums: 10,                // Max top albums (default: 10)
      },
    }),
  ],
};
```

### Environment Variables

- `LASTFM_API_KEY` - Last.fm API key (get one at last.fm/api/account/create)
- `LASTFM_USERNAME` - Last.fm username to fetch scrobbles from

**Note:** Settings saved in the admin UI override environment variables. This allows runtime reconfiguration without restarting Indiekit.

## Inter-Plugin Relationships

### Navigation Integration
Registers a navigation item in Indiekit's admin sidebar:
```javascript
get navigationItems() {
  return {
    href: this.options.mountPath,
    text: "lastfm.title",
    requiresDatabase: true, // Requires MongoDB for sync
  };
}
```

### Shortcut Integration
Registers a shortcut in Indiekit's admin dashboard:
```javascript
get shortcutItems() {
  return {
    url: this.options.mountPath,
    name: "lastfm.scrobbles",
    iconName: "syndicate",
    requiresDatabase: true,
  };
}
```

### Config and DB Access
Stores configuration and database getter for controller access:
```javascript
init(Indiekit) {
  Indiekit.addEndpoint(this);
  Indiekit.addCollection("scrobbles");
  Indiekit.addCollection("lastfmMeta");

  Indiekit.config.application.lastfmConfig = this.options;
  Indiekit.config.application.lastfmEndpoint = this.mountPath;
  Indiekit.config.application.getLastfmDb = () => Indiekit.database;

  if (Indiekit.config.application.mongodbUrl) {
    startSync(Indiekit, this.options);
  }
}
```

## Known Gotchas

### 1. Date Handling Convention (CRITICAL)
**All dates MUST be stored as ISO 8601 strings, NOT Date objects.**

This is the Indiekit date handling convention. The Nunjucks `| date` filter is `@indiekit/util`'s `formatDate()`, which calls `date-fns parseISO(string)` and ONLY accepts ISO strings.

**Correct pattern:**
```javascript
// Storage — use .toISOString()
scrobbledAt: new Date().toISOString(),
syncedAt: new Date().toISOString(),

// Controller — pass through unchanged
published: item.scrobbledAt, // already ISO string

// Template — use | date filter with guard
{% if scrobbledAt %}
  {{ scrobbledAt | date("PPp") }}
{% endif %}
```

**What breaks:**
```javascript
// WRONG — Date objects crash | date filter with "dateString.split is not a function"
scrobbledAt: new Date(),

// WRONG — null/undefined crashes with "Cannot read properties of undefined (reading 'match')"
{{ scrobbledAt | date("PPp") }} // without {% if %} guard
```

**Historical note:** Versions prior to 1.0.7 stored `scrobbledAt` as Date objects. The sync code now stores ISO strings, but old documents may have Date objects. The `formatScrobble()` function handles both:
```javascript
const scrobbledAtISO = scrobbledAtRaw instanceof Date
  ? scrobbledAtRaw.toISOString()
  : scrobbledAtRaw;
```

### 2. Public Routes and Stats Cache
Public routes (no auth) can't access MongoDB directly. They rely on the in-memory stats cache populated during background sync.

**Problem:** If the plugin starts and someone immediately hits `/api/stats`, the cache is empty → 503 error.

**Mitigation:** The `statsController` checks for cached stats and returns 503 with retry header if unavailable:
```javascript
stats = getCachedStats();
if (!stats) {
  return response.status(503).json({
    error: "Stats not available yet",
    message: "Stats are computed during background sync. Please try again shortly.",
  });
}
```

**Future improvement:** Pre-populate cache on startup by running an initial sync.

### 3. Incremental Sync Deduplication
The sync logic uses compound indexes to prevent duplicates:
```javascript
await collection.updateOne(
  {
    trackTitle: doc.trackTitle,
    artistName: doc.artistName,
    scrobbledAt: doc.scrobbledAt,
  },
  { $set: doc },
  { upsert: true }
);
```

**Why both `lastfmId` and compound index?**
- `lastfmId` deduplicates based on Last.fm data
- Compound index deduplicates if the same track is scrobbled at the exact same timestamp (edge case: API returns duplicate entries)

### 4. First Sync is Partial
On first sync, the plugin fetches only the most recent 2,000 scrobbles (10 pages × 200 per page) to avoid rate limits and long sync times.

**Implication:** Historical scrobbles beyond 2,000 are not synced unless you modify `maxPages` in `getAllRecentTracks()`.

**Workaround:** For complete history sync, temporarily increase `maxPages` in `lib/sync.js`:
```javascript
newScrobbles = await client.getAllRecentTracks(100); // ~20,000 tracks
```

### 5. Last.fm API Rate Limits
Last.fm has unpublished rate limits. From experience:
- ~5 requests/second is safe
- Bursts of 10+ requests/second may trigger 29 (rate limit exceeded)
- Error codes 8, 11, 16, 29 are transient (503 retry)

The plugin uses:
- API-level caching (15min TTL)
- Sequential page fetching in sync (no parallel requests)
- Transient error detection and 503 status codes

### 6. Top Artists/Albums: API vs DB
The plugin prefers Last.fm API for top artists/albums (more accurate, includes all-time data) but falls back to MongoDB aggregation if API fails.

**API advantage:** Accurate play counts for all time (Last.fm stores full history)
**DB advantage:** Works offline, faster for recent periods (week/month)

**Note:** MongoDB can only compute stats for synced scrobbles (limited to what's in the DB).

### 7. Nunjucks `| dump | safe` Breaks on Single Quotes
**Problem:** Hidden form inputs using `value='{{ data | dump | safe }}'` break when JSON contains single quotes.

**Fix:** Remove `| safe` — browsers auto-decode HTML entities from `.value`:
```nunjucks
{# WRONG #}
<input type="hidden" name="settings" value='{{ settings | dump | safe }}'>

{# CORRECT #}
<input type="hidden" name="settings" value="{{ settings | dump }}">
```

## Dependencies

### Runtime
- `@indiekit/error` (^1.0.0-beta.25) - Error handling
- `express` (^5.0.0) - HTTP routing

### Peer
- `@indiekit/indiekit` (>=1.0.0-beta.25) - Core plugin API

### Implicit
- Relies on native `fetch` (Node 18+)
- Requires MongoDB (accessed via Indiekit's database connection)
- Uses Indiekit's `@indiekit/util` for date formatting in templates

## Debugging Tips

### Enable Last.fm API Logging
The plugin logs errors to console but not successful requests. To debug API calls:
```javascript
// In lib/lastfm-client.js, add before line 43:
console.log('[Last.fm] Fetching:', url.toString());
```

### Monitor Background Sync
The sync process logs to console:
```
[Last.fm] Background sync started (interval: 300s)
[Last.fm] Syncing scrobbles since: 2025-02-13T14:30:00.000Z
[Last.fm] Found 15 new scrobbles
[Last.fm] Synced 15 scrobbles
[Last.fm] Stats cache updated
```

### Trigger Manual Sync
Click "Sync Now" in the admin dashboard or POST to `/lastfm/sync`.

### Inspect MongoDB Collections
```javascript
// In MongoDB shell
use indiekit
db.scrobbles.find().limit(5).sort({ scrobbledAt: -1 })
db.scrobbles.countDocuments()
db.lastfmMeta.find()
```

### Verify Stats Cache
```javascript
// In lib/sync.js, add after line 30:
console.log('Stats cache contents:', JSON.stringify(cachedStats, null, 2));
```

### Test Public API Routes Locally
```bash
# Without auth (public routes)
curl http://localhost:3000/lastfm/api/now-playing
curl http://localhost:3000/lastfm/api/scrobbles
curl http://localhost:3000/lastfm/api/stats
```

### Check Date Formats in Database
```javascript
// Verify scrobbledAt is ISO string, not Date object
db.scrobbles.aggregate([
  { $project: { scrobbledAt: 1, type: { $type: "$scrobbledAt" } } },
  { $limit: 5 }
])
// Should return "type": "string", not "type": "date"
```

## Common Patterns

### Adding a New Public API Route
1. Create controller method in `lib/controllers/new-feature.js`
2. Export `api` method that returns JSON
3. Register route in `index.js`:
   ```javascript
   publicRouter.get('/api/new-feature', newFeatureController.api);
   ```
4. Handle stats cache access (for public routes):
   ```javascript
   const stats = getCachedStats();
   if (!stats) {
     return response.status(503).json({ error: "Not available yet" });
   }
   ```

### Adding Stats Aggregation
1. Add aggregation function to `lib/stats.js`:
   ```javascript
   export async function getNewStat(db, period = 'all') {
     const match = getDateMatch(period);
     return db.collection('scrobbles').aggregate([
       { $match: match },
       // ... aggregation pipeline
     ]).toArray();
   }
   ```
2. Include in `getAllStats()`:
   ```javascript
   const [summary, trends, newStat] = await Promise.all([
     getSummary(db, 'all'),
     getScrobbleTrends(db, 30),
     getNewStat(db, 'all'),
   ]);
   ```
3. Access in controllers via `getCachedStats().newStat`

### Formatting Last.fm Data
Last.fm API returns inconsistent structures. Always use utils:
```javascript
import { getArtistName, getAlbumName, getCoverUrl, parseDate } from './utils.js';

const artist = getArtistName(track); // Handles artist.name, artist["#text"], or string
const album = getAlbumName(track);   // Handles album["#text"], album, or null
const cover = getCoverUrl(track);    // Gets best available cover size
const date = parseDate(track.date);  // Handles Last.fm date object or ISO string
```

## Testing Checklist

- [ ] Admin dashboard loads without errors
- [ ] Settings form saves to MongoDB and overrides env vars
- [ ] Manual sync button works and shows success message
- [ ] Now playing widget shows current track (if playing)
- [ ] Recent scrobbles display correctly
- [ ] Loved tracks display correctly
- [ ] Statistics page shows top artists/albums/trends
- [ ] Public API routes return valid JSON
- [ ] Stats cache populates during background sync
- [ ] Scrobbles are deduplicated correctly (no duplicates in MongoDB)
- [ ] Date fields are ISO strings (check MongoDB directly)
- [ ] All dates render correctly with `| date` filter
- [ ] Navigation item appears in Indiekit admin sidebar
- [ ] Shortcut appears in Indiekit admin dashboard
- [ ] Error states render correctly (no API key, API failure, 503 for empty cache)
- [ ] Transient Last.fm errors (rate limits) return 503 with retry header

## Changelog Endpoint Integration

This plugin is designed to integrate with the `/listening` page on the Eleventy frontend, which aggregates listening activity from multiple sources (Last.fm, Funkwhale, etc.).

The public API routes provide all necessary data for widgets:
- `/api/now-playing` - Current or recently played track
- `/api/scrobbles` - Paginated scrobble history
- `/api/stats` - Comprehensive statistics (summary, top artists/albums, trends)

See `indiekit-eleventy-theme` for widget implementation examples.
