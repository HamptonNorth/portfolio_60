import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { DATA_DIR } from "../shared/server-constants.js";

/**
 * @description Default configuration values. Used when keys are missing
 * or invalid in the config file.
 * @type {Object}
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
  fetchBatch: {
    batchSize: 8,
    cooldownSeconds: 120,
  },
  reportsOpenInNewTab: true,
  cronUpdateTestDatabase: false,
  fetchDelayProfile: "cron",
  fetchServer: {
    enabled: false,
    url: "",
    syncOnStartup: true,
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
 * @description Get the resolved path to the config file for reading.
 * In Flatpak mode (DATA_DIR set), checks the writable data directory first
 * and falls back to the bundled config in the app bundle.
 * @returns {string} Absolute path to user-settings.json
 */
export function getConfigFilePath() {
  if (configPathOverride) {
    return configPathOverride;
  }
  if (DATA_DIR !== ".") {
    const dataConfig = resolve(join(DATA_DIR, "user-settings.json"));
    if (existsSync(dataConfig)) {
      return dataConfig;
    }
  }
  return resolve("src/shared/user-settings.json");
}

/**
 * @description Get the writable path for saving config changes.
 * In Flatpak mode, always returns the DATA_DIR location so writes go to the
 * writable data directory. In normal mode, returns the project source path.
 * @returns {string} Absolute path to the writable user-settings.json
 */
export function getWritableConfigPath() {
  if (configPathOverride) {
    return configPathOverride;
  }
  if (DATA_DIR !== ".") {
    return resolve(join(DATA_DIR, "user-settings.json"));
  }
  return resolve("src/shared/user-settings.json");
}

/**
 * @description Load, validate, and cache the application configuration
 * from src/shared/user-settings.json. Missing or invalid values are replaced
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
    console.warn("Failed to load user-settings.json, using defaults:", err.message);
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

  // fetchDelayProfile — must be "interactive" or "cron"
  // Also accepts legacy key name "scrapeDelayProfile" for backwards compatibility
  const validProfiles = ["interactive", "cron"];
  const rawProfile = rawConfig.fetchDelayProfile || rawConfig.scrapeDelayProfile;
  config.fetchDelayProfile = validProfiles.includes(rawProfile) ? rawProfile : DEFAULTS.fetchDelayProfile;

  // fetchBatch — batch size and cooldown between batches during fetching
  // Also accepts legacy key name "scrapeBatch" for backwards compatibility
  const rawFetchBatch = rawConfig.fetchBatch || rawConfig.scrapeBatch || {};
  config.fetchBatch = {
    batchSize: typeof rawFetchBatch.batchSize === "number" && Number.isInteger(rawFetchBatch.batchSize) && rawFetchBatch.batchSize >= 1 && rawFetchBatch.batchSize <= 50 ? rawFetchBatch.batchSize : DEFAULTS.fetchBatch.batchSize,

    cooldownSeconds: typeof rawFetchBatch.cooldownSeconds === "number" && Number.isInteger(rawFetchBatch.cooldownSeconds) && rawFetchBatch.cooldownSeconds >= 0 && rawFetchBatch.cooldownSeconds <= 600 ? rawFetchBatch.cooldownSeconds : DEFAULTS.fetchBatch.cooldownSeconds,
  };

  // lists — embedded spreadsheet lists for the Lists menu
  const rawLists = rawConfig.lists || {};
  config.lists = {
    _readme: rawLists._readme || "",
    items: Array.isArray(rawLists.items) ? rawLists.items : [],
  };

  // docs — documentation subsystem categories
  var rawDocs = rawConfig.docs || {};
  config.docs = {
    _readme: rawDocs._readme || "",
    categories: typeof rawDocs.categories === "object" && rawDocs.categories !== null ? rawDocs.categories : {},
  };

  // reportsOpenInNewTab — boolean flag for opening report pages in a new tab
  config.reportsOpenInNewTab = typeof rawConfig.reportsOpenInNewTab === "boolean" ? rawConfig.reportsOpenInNewTab : DEFAULTS.reportsOpenInNewTab;

  // cronUpdateTestDatabase — whether cron-initiated fetches also update the test database
  config.cronUpdateTestDatabase = typeof rawConfig.cronUpdateTestDatabase === "boolean" ? rawConfig.cronUpdateTestDatabase : DEFAULTS.cronUpdateTestDatabase;

  // fetchServer — optional remote fetch server integration
  const rawFetchServer = rawConfig.fetchServer || {};
  config.fetchServer = {
    enabled: typeof rawFetchServer.enabled === "boolean" ? rawFetchServer.enabled : DEFAULTS.fetchServer.enabled,
    url: typeof rawFetchServer.url === "string" ? rawFetchServer.url.trim() : DEFAULTS.fetchServer.url,
    syncOnStartup: typeof rawFetchServer.syncOnStartup === "boolean" ? rawFetchServer.syncOnStartup : DEFAULTS.fetchServer.syncOnStartup,
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
 * @description Get whether report pages should open in a new browser tab.
 * @returns {boolean} True if reports should open in a new tab
 */
export function getReportsOpenInNewTab() {
  const config = loadConfig();
  return config.reportsOpenInNewTab === true;
}

/**
 * @description Get the fetch delay profile name for scheduled runs.
 * @returns {string} Either "interactive" or "cron"
 */
export function getFetchDelayProfile() {
  const config = loadConfig();
  return config.fetchDelayProfile;
}

/**
 * @description Get the fetch batch configuration with defaults applied.
 * Controls how many items are fetched per batch and the cooldown pause
 * between batches to avoid rate-limiting by target APIs.
 * @returns {{ batchSize: number, cooldownSeconds: number }}
 */
export function getFetchBatchConfig() {
  const config = loadConfig();
  return config.fetchBatch;
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
 * @description Get whether cron-initiated fetches should also update the test database.
 * @returns {boolean} True if the test database should be updated after live fetch
 */
export function getCronUpdateTestDatabase() {
  const config = loadConfig();
  return config.cronUpdateTestDatabase === true;
}

/**
 * @description Get the list items for embedded spreadsheet lists.
 * Returns an array of { title, spreadsheet, iframe } objects.
 * @returns {Array<{title: string, spreadsheet: string, iframe: string}>}
 */
export function getListItems() {
  const config = loadConfig();
  return config.lists ? config.lists.items : [];
}

/**
 * @description Get the docs configuration with defaults applied.
 * Returns the categories object from the docs config section.
 * @returns {{ categories: Object.<string, {style: string, label: string}> }}
 */
export function getDocsConfig() {
  var config = loadConfig();
  var rawDocs = config.docs || {};
  var categories = rawDocs.categories || {};
  return { categories: categories };
}

/**
 * @description Get the fetch server configuration.
 * @returns {{ enabled: boolean, url: string, syncOnStartup: boolean }}
 */
export function getFetchServerConfig() {
  const config = loadConfig();
  const fs = config.fetchServer || DEFAULTS.fetchServer;
  return {
    enabled: fs.enabled === true,
    url: fs.url || "",
    syncOnStartup: fs.syncOnStartup !== false,
  };
}

/**
 * @description Clear the cached config and re-read from disk on next access.
 * Call this after the config file has been modified (e.g. by the Settings UI).
 */
export function reloadConfig() {
  configCache = null;
}
