# @rmdes/indiekit-endpoint-lastfm

Last.fm scrobble and listening activity endpoint for [Indiekit](https://getindiekit.com).

## Features

- Display scrobble history from Last.fm
- Now playing / recently played status
- Loved tracks
- Listening statistics (top artists, albums, trends)
- Background sync to MongoDB for offline access
- Public JSON API for frontend integration

## Installation

```bash
npm install @rmdes/indiekit-endpoint-lastfm
```

## Configuration

Add to your Indiekit config:

```javascript
import LastFmEndpoint from "@rmdes/indiekit-endpoint-lastfm";

export default {
  plugins: [
    "@rmdes/indiekit-endpoint-lastfm",
    // ... other plugins
  ],

  "@rmdes/indiekit-endpoint-lastfm": {
    mountPath: "/lastfmapi",
    apiKey: process.env.LASTFM_API_KEY,
    username: process.env.LASTFM_USERNAME,
    cacheTtl: 900_000,        // 15 minutes
    syncInterval: 300_000,    // 5 minutes
    limits: {
      scrobbles: 20,
      loved: 20,
      topArtists: 10,
      topAlbums: 10,
    },
  },
};
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LASTFM_API_KEY` | Your Last.fm API key ([get one here](https://www.last.fm/api/account/create)) |
| `LASTFM_USERNAME` | Last.fm username to track |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/now-playing` | Current or recently played track |
| `GET /api/scrobbles` | Paginated scrobble history |
| `GET /api/loved` | Paginated loved tracks |
| `GET /api/stats` | Listening statistics |
| `GET /api/stats/trends` | Daily scrobble trends |

## Requirements

- Node.js >= 20
- Indiekit >= 1.0.0-beta.25
- MongoDB (for background sync and statistics)

## License

MIT
