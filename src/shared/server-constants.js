/**
 * @description Application-wide constants for Portfolio 60
 */

import { join } from "node:path";
import { APP_NAME, APP_VERSION } from "../../app-identity.js";

// Re-export from root app-identity.js (single source of truth)
export { APP_NAME, APP_VERSION };

/** @type {number} Port the Bun HTTP server listens on */
export const SERVER_PORT = 1420;

/**
 * @description Base directory for writable data files (database, backups, docs, .env, config).
 * Defaults to "." (project root) for normal development. Set to an absolute path
 * (e.g. ~/.config/portfolio_60) in Flatpak mode via the PORTFOLIO60_DATA_DIR env var.
 * @type {string}
 */
export const DATA_DIR = process.env.PORTFOLIO60_DATA_DIR || ".";

/** @type {string} Path to the SQLite database file */
export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, "data", "portfolio60.db");

/** @type {string} Directory for database backups */
export const BACKUP_DIR = join(DATA_DIR, "backups");

/** @type {string} Default root directory for documentation markdown files */
export const DOCS_DIR = join(DATA_DIR, "docs");

/** @type {string} Default subdirectory under DOCS_DIR for uploaded media (images) */
export const DOCS_MEDIA_DIR = join(DATA_DIR, "docs", "media");

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
 * @description Convert a Date object to a local-time ISO-8601 date string (YYYY-MM-DD).
 * Unlike toISOString().split("T")[0], this uses local time components so it
 * returns the correct date during BST (UTC+1) and other timezone offsets.
 * @param {Date} date - The date to format
 * @returns {string} Date string in YYYY-MM-DD format using local time
 */
export function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
