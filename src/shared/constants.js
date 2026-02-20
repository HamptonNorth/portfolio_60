/**
 * @description Application-wide constants for Portfolio 60
 */

/** @type {string} Application display name */
export const APP_NAME = "Portfolio 60";

/** @type {string} Current application version */
export const APP_VERSION = "0.11.0";

/** @type {number} Port the Bun HTTP server listens on */
export const SERVER_PORT = 1420;

/** @type {string} Path to the SQLite database file */
export const DB_PATH = "data/portfolio60.db";

/** @type {string} Directory for database backups */
export const BACKUP_DIR = "backups";

/** @type {string} Default root directory for documentation markdown files */
export const DOCS_DIR = "docs";

/** @type {string} Default subdirectory under DOCS_DIR for uploaded media (images) */
export const DOCS_MEDIA_DIR = "docs/media";

/**
 * @description Get the effective docs directory. Returns the DOCS_DIR
 * environment variable if set (e.g. for test mode pointing at test reference
 * docs), otherwise returns the default DOCS_DIR constant.
 * @returns {string} The docs directory path
 */
export function getDocsDir() {
  return process.env.DOCS_DIR || DOCS_DIR;
}

/**
 * @description Get the effective docs media directory. Derived from
 * getDocsDir() with "/media" appended.
 * @returns {string} The docs media directory path
 */
export function getDocsMediaDir() {
  return getDocsDir() + "/media";
}

/** @type {number} Multiplier for storing currency rates as integers (e.g. 1.2543 stored as 12543) */
export const CURRENCY_SCALE_FACTOR = 10000;

/**
 * @description Scrape delay profiles. Each profile defines random pause ranges
 * (in milliseconds) between requests during price scraping. The "sameDomain"
 * range applies when consecutive requests hit the same domain; "differentDomain"
 * applies when switching to a new domain. A random value between min and max
 * is chosen for each pause.
 *
 * - interactive: short pauses for manual testing (same domain 2-5s, different 0.5-1s)
 * - cron: longer pauses for unattended scheduled runs (same domain 5-30s, different 1-5s)
 *
 * @type {Object.<string, {sameDomain: {min: number, max: number}, differentDomain: {min: number, max: number}}>}
 */
export const SCRAPE_DELAY_PROFILES = {
  interactive: {
    sameDomain: { min: 2000, max: 5000 },
    differentDomain: { min: 500, max: 1000 },
  },
  cron: {
    sameDomain: { min: 5000, max: 30000 },
    differentDomain: { min: 1000, max: 5000 },
  },
};

/** @type {string} Default scrape delay profile. Override via SCRAPE_DELAY_PROFILE env var. */
export const DEFAULT_SCRAPE_DELAY_PROFILE = "interactive";

/**
 * @description Retry configuration for individual scrape failures.
 * When a single investment or benchmark fails to scrape, it will be retried
 * up to maxAttempts times with increasing delays between attempts.
 */
export const SCRAPE_RETRY_CONFIG = {
  /** @type {number} Maximum number of retry attempts per item (including initial attempt) */
  maxAttempts: 3,
  /** @type {number[]} Delay in ms before each retry attempt (index 0 = delay before attempt 2, etc.) */
  retryDelays: [2000, 5000],
};
