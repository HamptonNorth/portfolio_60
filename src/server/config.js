import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { DATA_DIR } from "../shared/server-constants.js";

/**
 * @description Check whether a value is a plain object (not an array, not null).
 * Used by deepMerge to decide whether to recurse.
 * @param {*} val - The value to check
 * @returns {boolean} True if val is a plain object
 */
function isPlainObject(val) {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * @description Deep-merge two plain objects. For each key, if both the base
 * and override values are plain objects (not arrays, not null), recurse.
 * Otherwise the override value wins. Keys present only in override are kept.
 * Arrays are replaced entirely by the override value (not merged element-by-element).
 * @param {Object} base - The base/default object
 * @param {Object} override - The user override object
 * @returns {Object} A new merged object
 */
function deepMerge(base, override) {
  const result = {};

  // Start with all base keys
  const baseKeys = Object.keys(base);
  for (let i = 0; i < baseKeys.length; i++) {
    const key = baseKeys[i];
    if (key in override) {
      if (isPlainObject(base[key]) && isPlainObject(override[key])) {
        result[key] = deepMerge(base[key], override[key]);
      } else {
        result[key] = override[key];
      }
    } else {
      result[key] = base[key];
    }
  }

  // Carry over any keys only in override
  const overrideKeys = Object.keys(override);
  for (let j = 0; j < overrideKeys.length; j++) {
    const oKey = overrideKeys[j];
    if (!(oKey in result)) {
      result[oKey] = override[oKey];
    }
  }

  return result;
}

/**
 * @description Load the repo-bundled default user-settings.json.
 * This is the template shipped with the application source code.
 * New config keys added here automatically appear for existing users
 * via the deep-merge in loadConfig().
 * @returns {Object} Parsed JSON from src/shared/user-settings.json, or empty object on failure
 */
function getRepoDefaultConfig() {
  try {
    const repoPath = resolve("src/shared/user-settings.json");
    const raw = readFileSync(repoPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

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
    const repoPath = resolve("src/shared/user-settings.json");

    if (configPathOverride || resolve(configPath) === repoPath) {
      // Test mode (configPathOverride set) or running from source — no merge needed
      rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } else {
      // User has a separate config file — deep-merge repo defaults underneath
      const repoDefaults = getRepoDefaultConfig();
      const userConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      rawConfig = deepMerge(repoDefaults, userConfig);
    }
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

  // docs — documentation subsystem categories and guide links
  const rawDocs = rawConfig.docs || {};
  config.docs = {
    _readme: rawDocs._readme || "",
    categories: typeof rawDocs.categories === "object" && rawDocs.categories !== null ? rawDocs.categories : {},
    guides: Array.isArray(rawDocs.guides) ? rawDocs.guides : [],
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
 * @description File paths for the live and test list definition files.
 * Follows the same pattern as user-reports.json / user-reports-test.json.
 * @type {string}
 */
const listsFilePath = resolve("src/shared/user-lists.json");
const listsTestFilePath = resolve("src/shared/user-lists-test.json");

/**
 * @description Get the list items for embedded spreadsheet lists.
 * Reads from user-lists.json (live) or user-lists-test.json (test/demo mode).
 * Re-reads the JSON file on every call so hand-edits take effect without restart.
 * @param {boolean} [testMode=false] - Whether to use the test lists file
 * @returns {Array<{title: string, spreadsheet: string, iframe: string, range?: string}>}
 */
export function getListItems(testMode) {
  try {
    const filePath = testMode ? listsTestFilePath : listsFilePath;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/**
 * @description Get the document (PDF) entries from the lists config.
 * Reads from user-lists.json (live) or user-lists-test.json (test/demo mode).
 * Re-reads the JSON file on every call so hand-edits take effect without restart.
 * @param {boolean} [testMode=false] - Whether to use the test lists file
 * @returns {Array<{title: string, filename: string}>}
 */
export function getListDocuments(testMode) {
  try {
    const filePath = testMode ? listsTestFilePath : listsFilePath;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.documents) ? parsed.documents : [];
  } catch {
    return [];
  }
}

/**
 * @description Create a timestamped backup of a lists JSON file before overwriting.
 * @param {string} filePath - Absolute path to the file to back up
 */
function backupListsFile(filePath) {
  if (!existsSync(filePath)) return;
  const dir = dirname(filePath);
  const base = basename(filePath, ".json");
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const timestamp = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "-" + pad(now.getHours()) + "-" + pad(now.getMinutes());
  const backupName = base + "-backup-" + timestamp + ".json";
  const backupPath = join(dir, backupName);
  copyFileSync(filePath, backupPath);
}

/**
 * @description Read the full lists JSON file (items + documents).
 * @param {boolean} testMode - Whether to use the test lists file
 * @returns {{ _readme: string, items: Array, documents: Array }}
 */
function readListsFile(testMode) {
  const filePath = testMode ? listsTestFilePath : listsFilePath;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * @description Write the full lists JSON file back to disk with a backup.
 * @param {boolean} testMode - Whether to use the test lists file
 * @param {Object} data - The full JSON object to write
 */
function writeListsFile(testMode, data) {
  const filePath = testMode ? listsTestFilePath : listsFilePath;
  backupListsFile(filePath);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * @description Save the spreadsheet items array to the lists config file.
 * Preserves the _readme field and documents array. Creates a backup first.
 * @param {boolean} testMode - Whether to use the test lists file
 * @param {Array<{title: string, spreadsheet: string, iframe: string, range?: string}>} items
 */
export function saveListItems(testMode, items) {
  const data = readListsFile(testMode);
  data.items = items;
  writeListsFile(testMode, data);
}

/**
 * @description Save the documents array to the lists config file.
 * Preserves the _readme field and items array. Creates a backup first.
 * @param {boolean} testMode - Whether to use the test lists file
 * @param {Array<{title: string, filename: string}>} documents
 */
export function saveListDocuments(testMode, documents) {
  const data = readListsFile(testMode);
  data.documents = documents;
  writeListsFile(testMode, data);
}

/**
 * @description Get the file path for the lists directory where PDFs are stored.
 * @returns {string} Absolute path to the docs/lists/ directory
 */
export function getListsDir() {
  return resolve("docs/lists");
}

/**
 * @description Get the docs configuration with defaults applied.
 * Returns the categories object from the docs config section.
 * @returns {{ categories: Object.<string, {style: string, label: string}> }}
 */
export function getDocsConfig() {
  const config = loadConfig();
  const rawDocs = config.docs || {};
  const categories = rawDocs.categories || {};
  const guides = rawDocs.guides || [];
  return { categories: categories, guides: guides };
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
 * @description Get the full merged configuration as a formatted JSON string.
 * Used by the Settings editor to show all keys (including new defaults that
 * may not yet be in the user's file). The editor saves the result back to
 * the user file, so after one save the user file contains all keys.
 * @returns {string} Pretty-printed JSON of the merged config
 */
export function getMergedConfigRaw() {
  try {
    const repoDefaults = getRepoDefaultConfig();
    const configPath = getConfigFilePath();
    const repoPath = resolve("src/shared/user-settings.json");

    if (resolve(configPath) === repoPath) {
      return readFileSync(configPath, "utf-8");
    }

    const userConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    const merged = deepMerge(repoDefaults, userConfig);
    return JSON.stringify(merged, null, 2);
  } catch {
    return readFileSync(resolve("src/shared/user-settings.json"), "utf-8");
  }
}

/**
 * @description Clear the cached config and re-read from disk on next access.
 * Call this after the config file has been modified (e.g. by the Settings UI).
 */
export function reloadConfig() {
  configCache = null;
}
