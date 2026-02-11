import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Default configuration values. Used when keys are missing
 * or invalid in the config file.
 * @type {Object}
 */
/**
 * @typedef {Object} SiteConfig
 * @property {string} pattern - Domain or path pattern to match
 * @property {string} name - Human-readable site name
 * @property {string} selector - CSS selector for the price/value element
 * @property {string} waitStrategy - "domcontentloaded" or "networkidle"
 * @property {string} [notes] - Optional notes about the site
 */

const DEFAULTS = {
  allowed_providers: [],
  scheduling: {
    enabled: false,
    cron: "0 8 * * 6",
    runOnStartupIfMissed: true,
    startupDelayMinutes: 10,
  },
  retry: {
    delayMinutes: 5,
    maxAttempts: 5,
  },
  isaAllowance: {
    annualLimit: 20000,
    taxYearStartMonth: 4,
    taxYearStartDay: 6,
  },
  scrapeDelayProfile: "cron",
  scraperSites: {
    sites: [],
  },
};

/**
 * @description Cached config object. Cleared by reloadConfig().
 * @type {Object|null}
 */
let configCache = null;

/**
 * @description Override path for testing. When set, loadConfig() reads
 * from this path instead of the default location.
 * @type {string|null}
 */
let configPathOverride = null;

/**
 * @description Set a custom path for the config file. Used by tests to
 * point the loader at a temporary config file.
 * @param {string|null} path - Absolute path to config file, or null to reset
 */
export function setConfigPath(path) {
  configPathOverride = path;
  configCache = null;
}

/**
 * @description Get the resolved path to the config file.
 * @returns {string} Absolute path to config.json
 */
function getConfigFilePath() {
  if (configPathOverride) {
    return configPathOverride;
  }
  return resolve("src/shared/config.json");
}

/**
 * @description Load, validate, and cache the application configuration
 * from src/shared/config.json. Missing or invalid values are replaced
 * with defaults. The result is cached until reloadConfig() is called.
 * @returns {Object} The validated config object
 */
export function loadConfig() {
  if (configCache) {
    return configCache;
  }

  let rawConfig = {};

  try {
    const configPath = getConfigFilePath();
    const raw = readFileSync(configPath, "utf-8");
    rawConfig = JSON.parse(raw);
  } catch (err) {
    console.warn("Failed to load config.json, using defaults:", err.message);
    rawConfig = {};
  }

  // Build validated config by merging with defaults
  const config = {};

  // allowed_providers — must be an array
  config.allowed_providers = Array.isArray(rawConfig.allowed_providers) ? rawConfig.allowed_providers : DEFAULTS.allowed_providers;

  // scheduling — validate each sub-key
  const rawScheduling = rawConfig.scheduling || {};
  config.scheduling = {
    enabled: typeof rawScheduling.enabled === "boolean" ? rawScheduling.enabled : DEFAULTS.scheduling.enabled,

    cron: typeof rawScheduling.cron === "string" && rawScheduling.cron.trim().length > 0 ? rawScheduling.cron.trim() : DEFAULTS.scheduling.cron,

    runOnStartupIfMissed: typeof rawScheduling.runOnStartupIfMissed === "boolean" ? rawScheduling.runOnStartupIfMissed : DEFAULTS.scheduling.runOnStartupIfMissed,

    startupDelayMinutes: typeof rawScheduling.startupDelayMinutes === "number" && rawScheduling.startupDelayMinutes >= 0 ? rawScheduling.startupDelayMinutes : DEFAULTS.scheduling.startupDelayMinutes,
  };

  // retry — validate each sub-key
  const rawRetry = rawConfig.retry || {};
  config.retry = {
    delayMinutes: typeof rawRetry.delayMinutes === "number" && rawRetry.delayMinutes > 0 ? rawRetry.delayMinutes : DEFAULTS.retry.delayMinutes,

    maxAttempts: typeof rawRetry.maxAttempts === "number" && Number.isInteger(rawRetry.maxAttempts) && rawRetry.maxAttempts >= 1 && rawRetry.maxAttempts <= 10 ? rawRetry.maxAttempts : DEFAULTS.retry.maxAttempts,
  };

  // isaAllowance — validate each sub-key
  const rawIsaAllowance = rawConfig.isaAllowance || {};
  config.isaAllowance = {
    annualLimit: typeof rawIsaAllowance.annualLimit === "number" && rawIsaAllowance.annualLimit > 0 ? rawIsaAllowance.annualLimit : DEFAULTS.isaAllowance.annualLimit,

    taxYearStartMonth: typeof rawIsaAllowance.taxYearStartMonth === "number" && Number.isInteger(rawIsaAllowance.taxYearStartMonth) && rawIsaAllowance.taxYearStartMonth >= 1 && rawIsaAllowance.taxYearStartMonth <= 12 ? rawIsaAllowance.taxYearStartMonth : DEFAULTS.isaAllowance.taxYearStartMonth,

    taxYearStartDay: typeof rawIsaAllowance.taxYearStartDay === "number" && Number.isInteger(rawIsaAllowance.taxYearStartDay) && rawIsaAllowance.taxYearStartDay >= 1 && rawIsaAllowance.taxYearStartDay <= 28 ? rawIsaAllowance.taxYearStartDay : DEFAULTS.isaAllowance.taxYearStartDay,
  };

  // scrapeDelayProfile — must be "interactive" or "cron"
  const validProfiles = ["interactive", "cron"];
  config.scrapeDelayProfile = validProfiles.includes(rawConfig.scrapeDelayProfile) ? rawConfig.scrapeDelayProfile : DEFAULTS.scrapeDelayProfile;

  // scraperSites — validate sites is an array, preserve metadata
  const rawScraperSites = rawConfig.scraperSites || {};
  config.scraperSites = {
    _readme: rawScraperSites._readme || "",
    _format: rawScraperSites._format || {},
    sites: Array.isArray(rawScraperSites.sites) ? rawScraperSites.sites : DEFAULTS.scraperSites.sites,
  };

  // scraperTesting — feature flag for the scraper testing sandbox
  const rawScraperTesting = rawConfig.scraperTesting || {};
  const stalestLimit = parseInt(rawScraperTesting.stalestLimit, 10);
  const stalestRetries = parseInt(rawScraperTesting.stalestRetries, 10);
  config.scraperTesting = {
    enabled: typeof rawScraperTesting.enabled === "boolean" ? rawScraperTesting.enabled : false,
    stalestLimit: Number.isFinite(stalestLimit) && stalestLimit > 0 ? stalestLimit : 20,
    stalestRetries: Number.isFinite(stalestRetries) && stalestRetries >= 1 && stalestRetries <= 3 ? stalestRetries : 1,
  };

  configCache = config;
  return config;
}

/**
 * @description Get the scheduling configuration with defaults applied.
 * @returns {{ enabled: boolean, cron: string, runOnStartupIfMissed: boolean, startupDelayMinutes: number }}
 */
export function getSchedulingConfig() {
  const config = loadConfig();
  return config.scheduling;
}

/**
 * @description Get the retry configuration with defaults applied.
 * @returns {{ delayMinutes: number, maxAttempts: number }}
 */
export function getRetryConfig() {
  const config = loadConfig();
  return config.retry;
}

/**
 * @description Get the scrape delay profile name for scheduled runs.
 * @returns {string} Either "interactive" or "cron"
 */
export function getScrapeDelayProfile() {
  const config = loadConfig();
  return config.scrapeDelayProfile;
}

/**
 * @description Get the list of allowed provider objects.
 * @returns {Object[]} Array of { code, name } objects
 */
export function getAllowedProviders() {
  const config = loadConfig();
  return config.allowed_providers;
}

/**
 * @description Get the ISA allowance configuration with defaults applied.
 * @returns {{ annualLimit: number, taxYearStartMonth: number, taxYearStartDay: number }}
 */
export function getIsaAllowanceConfig() {
  const config = loadConfig();
  return config.isaAllowance;
}

/**
 * @description Check whether the Scraper Testing feature is enabled in config.
 * @returns {boolean} True if scraperTesting.enabled is true
 */
export function getScraperTestingEnabled() {
  const config = loadConfig();
  return config.scraperTesting && config.scraperTesting.enabled === true;
}

/**
 * @description Get the configured limit for the "Test Stalest" feature.
 * Defaults to 20 if not set or invalid.
 * @returns {number} Number of stalest investments to test per run
 */
export function getStalestLimit() {
  const config = loadConfig();
  return config.scraperTesting ? config.scraperTesting.stalestLimit : 20;
}

/**
 * @description Get the configured max retry attempts for the "Test Stalest" feature.
 * Defaults to 1 (no retries). Maximum 3.
 * @returns {number} Max attempts per investment (1 = no retries, 3 = max)
 */
export function getStalestRetries() {
  const config = loadConfig();
  return config.scraperTesting ? config.scraperTesting.stalestRetries : 1;
}

/**
 * @description Clear the cached config and re-read from disk on next access.
 * Call this after the config file has been modified (e.g. by the Settings UI).
 */
export function reloadConfig() {
  configCache = null;
}

// ---------------------------------------------------------------------------
// Scraper site configuration functions
// ---------------------------------------------------------------------------

/**
 * @description Load site configurations from the config.
 * Returns the scraperSites.sites array from the cached config.
 * @returns {SiteConfig[]} Array of site configurations
 */
export function loadSiteConfigs() {
  const config = loadConfig();
  return config.scraperSites.sites;
}

/**
 * @description Clear the cached site configurations.
 * Delegates to reloadConfig() since sites are part of the main config.
 */
export function clearSiteCache() {
  reloadConfig();
}

/**
 * @description Find a matching site configuration for a given URL.
 * Matches the URL against known site patterns (domain + path fragments).
 * @param {string} url - The URL to match
 * @returns {SiteConfig|null} Matching site config, or null if no match
 */
export function findSiteConfig(url) {
  if (!url) {
    return null;
  }

  const sites = loadSiteConfigs();

  // Normalise the URL for matching (lowercase, remove protocol)
  const normalisedUrl = url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");

  for (const site of sites) {
    const pattern = site.pattern.toLowerCase();
    if (normalisedUrl.includes(pattern)) {
      return site;
    }
  }

  return null;
}

/**
 * @description Get the selector for a URL, with custom selector taking priority.
 * Priority order:
 * 1. Custom selector (if provided) - user override always wins
 * 2. Known site config selector (if URL matches a known site)
 * 3. None (no selector available)
 * @param {string} url - The URL to scrape
 * @param {string|null} customSelector - Custom selector provided by user (optional)
 * @returns {{selector: string|null, source: "config"|"custom"|"none", siteName: string|null, waitStrategy: string}}
 */
export function getSelector(url, customSelector) {
  const siteConfig = findSiteConfig(url);

  // Custom selector always takes priority (user override)
  if (customSelector) {
    return {
      selector: customSelector,
      source: "custom",
      siteName: siteConfig ? siteConfig.name : null,
      waitStrategy: siteConfig ? siteConfig.waitStrategy || "domcontentloaded" : "domcontentloaded",
    };
  }

  // Fall back to config selector if URL matches a known site
  if (siteConfig) {
    return {
      selector: siteConfig.selector,
      source: "config",
      siteName: siteConfig.name,
      waitStrategy: siteConfig.waitStrategy || "domcontentloaded",
    };
  }

  return {
    selector: null,
    source: "none",
    siteName: null,
    waitStrategy: "domcontentloaded",
  };
}

/**
 * @description Get all known site configurations.
 * Useful for displaying available sites in the UI.
 * @returns {SiteConfig[]} Array of all site configurations
 */
export function getAllSiteConfigs() {
  return loadSiteConfigs();
}

/**
 * @description Check if a URL matches a known site pattern.
 * @param {string} url - The URL to check
 * @returns {boolean} True if URL matches a known site
 */
export function isKnownSite(url) {
  return findSiteConfig(url) !== null;
}
