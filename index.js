import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { dashboardController } from "./lib/controllers/dashboard.js";
import { scrobblesController } from "./lib/controllers/scrobbles.js";
import { lovedController } from "./lib/controllers/loved.js";
import { statsController } from "./lib/controllers/stats.js";
import { nowPlayingController } from "./lib/controllers/now-playing.js";
import { startSync } from "./lib/sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const protectedRouter = express.Router();
const publicRouter = express.Router();

const defaults = {
  mountPath: "/lastfm",
  apiKey: process.env.LASTFM_API_KEY,
  username: process.env.LASTFM_USERNAME,
  cacheTtl: 900_000, // 15 minutes in ms
  syncInterval: 300_000, // 5 minutes in ms
  limits: {
    scrobbles: 20,
    loved: 20,
    topArtists: 10,
    topAlbums: 10,
  },
};

export default class LastFmEndpoint {
  name = "Last.fm listening activity endpoint";

  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.mountPath = this.options.mountPath;
  }

  get environment() {
    return ["LASTFM_API_KEY", "LASTFM_USERNAME"];
  }

  get localesDirectory() {
    return path.join(__dirname, "locales");
  }

  get navigationItems() {
    return {
      href: this.options.mountPath,
      text: "lastfm.title",
      requiresDatabase: true,
    };
  }

  get shortcutItems() {
    return {
      url: this.options.mountPath,
      name: "lastfm.scrobbles",
      iconName: "syndicate",
      requiresDatabase: true,
    };
  }

  /**
   * Protected routes (require authentication)
   * Admin dashboard only - detailed views are on the public frontend
   */
  get routes() {
    // Dashboard overview
    protectedRouter.get("/", dashboardController.get);

    // Save settings
    protectedRouter.post("/settings", dashboardController.saveSettings);

    // Manual sync trigger
    protectedRouter.post("/sync", dashboardController.sync);

    return protectedRouter;
  }

  /**
   * Public routes (no authentication required)
   * JSON API endpoints for Eleventy frontend
   */
  get routesPublic() {
    publicRouter.get("/api/now-playing", nowPlayingController.api);
    publicRouter.get("/api/scrobbles", scrobblesController.api);
    publicRouter.get("/api/loved", lovedController.api);
    publicRouter.get("/api/stats", statsController.api);
    publicRouter.get("/api/stats/trends", statsController.apiTrends);

    return publicRouter;
  }

  init(Indiekit) {
    Indiekit.addEndpoint(this);

    // Add MongoDB collections
    Indiekit.addCollection("scrobbles");
    Indiekit.addCollection("lastfmMeta");

    // Store Last.fm config in application for controller access
    Indiekit.config.application.lastfmConfig = this.options;
    Indiekit.config.application.lastfmEndpoint = this.mountPath;

    // Store database getter for controller access
    Indiekit.config.application.getLastfmDb = () => Indiekit.database;

    // Start background sync if database is available
    if (Indiekit.config.application.mongodbUrl) {
      startSync(Indiekit, this.options);
    }
  }
}
