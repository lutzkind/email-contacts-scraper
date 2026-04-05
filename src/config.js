const path = require("path");

function intFromEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");

module.exports = {
  host: process.env.HOST || "0.0.0.0",
  port: intFromEnv("PORT", 3015),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, "email-contacts-scraper.db"),
  exportsDir: process.env.EXPORTS_DIR || path.join(dataDir, "exports"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
  workerPollMs: intFromEnv("WORKER_POLL_MS", 3000),
  adminUsername: process.env.ADMIN_USERNAME || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "email_scraper_session",
  sessionTtlHours: intFromEnv("SESSION_TTL_HOURS", 24),
  crawl4aiBaseUrl: process.env.CRAWL4AI_BASE_URL || null,
  crawl4aiBearerToken: process.env.CRAWL4AI_BEARER_TOKEN || null,
  emailEnrichmentTimeoutMs: intFromEnv("EMAIL_ENRICHMENT_TIMEOUT_MS", 20000),
  emailEnrichmentMaxPages: intFromEnv("EMAIL_ENRICHMENT_MAX_PAGES", 12),
  emailEnrichmentConcurrency: intFromEnv("EMAIL_ENRICHMENT_CONCURRENCY", 2),
  emailEnrichmentRetryCount: intFromEnv("EMAIL_ENRICHMENT_RETRY_COUNT", 2),
  browserFallbackEnabled: String(process.env.BROWSER_FALLBACK_ENABLED || "true") !== "false",
  browserFallbackTimeoutMs: intFromEnv("BROWSER_FALLBACK_TIMEOUT_MS", 25000),
  browserFallbackWaitMs: intFromEnv("BROWSER_FALLBACK_WAIT_MS", 1500),
  directFetchUserAgent:
    process.env.DIRECT_FETCH_USER_AGENT ||
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
};
