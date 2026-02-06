/**
 * @description Utility for loading and matching known scraper site configurations.
 * Reads from config/scraper-sites.json and provides URL pattern matching to
 * auto-detect selectors for known financial websites.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * @typedef {Object} SiteConfig
 * @property {string} pattern - Domain or path pattern to match
 * @property {string} name - Human-readable site name
 * @property {string} selector - CSS selector for the price/value element
 * @property {string} waitStrategy - "domcontentloaded" or "networkidle"
 * @property {string} [notes] - Optional notes about the site
 */

/**
 * @description Cache for loaded site configurations.
 * @type {SiteConfig[]|null}
 */
let cachedSites = null;

/**
 * @description Get the path to the scraper-sites.json config file.
 * Handles both development (project root) and production (Tauri resource) paths.
 * @returns {string} Absolute path to the config file
 */
function getConfigPath() {
  // Try project root first (development)
  const projectRoot = join(import.meta.dir, "..", "..", "config", "scraper-sites.json");
  if (existsSync(projectRoot)) {
    return projectRoot;
  }

  // Try relative to current working directory
  const cwdPath = join(process.cwd(), "config", "scraper-sites.json");
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  // Fallback - return project root path (will error on read if missing)
  return projectRoot;
}

/**
 * @description Load site configurations from the JSON file.
 * Results are cached after first load. Call clearCache() to reload.
 * @returns {SiteConfig[]} Array of site configurations
 */
export function loadSiteConfigs() {
  if (cachedSites !== null) {
    return cachedSites;
  }

  try {
    const configPath = getConfigPath();
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);
    cachedSites = config.sites || [];
    return cachedSites;
  } catch (err) {
    console.error("Failed to load scraper-sites.json:", err.message);
    cachedSites = [];
    return cachedSites;
  }
}

/**
 * @description Clear the cached site configurations.
 * Call this if the config file has been modified and needs reloading.
 */
export function clearCache() {
  cachedSites = null;
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
