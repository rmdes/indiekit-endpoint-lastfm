/**
 * Get effective config: DB-stored settings override env var defaults
 * @param {object} db - MongoDB database instance
 * @param {object} lastfmConfig - Plugin config from env vars
 * @returns {Promise<object>} Effective apiKey, username, and other config
 */
export async function getEffectiveConfig(db, lastfmConfig) {
  let apiKey = lastfmConfig?.apiKey || "";
  let username = lastfmConfig?.username || "";

  if (db) {
    try {
      const settings = await db
        .collection("lastfmMeta")
        .findOne({ key: "settings" });
      if (settings) {
        if (settings.apiKey) apiKey = settings.apiKey;
        if (settings.username) username = settings.username;
      }
    } catch {
      // Fall through to defaults
    }
  }

  return { apiKey, username };
}
