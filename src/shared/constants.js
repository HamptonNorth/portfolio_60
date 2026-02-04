/**
 * @description Application-wide constants for Portfolio 60
 */

/** @type {string} Application display name */
export const APP_NAME = "Portfolio 60";

/** @type {string} Current application version */
export const APP_VERSION = "0.1.0";

/** @type {number} Port the Bun HTTP server listens on */
export const SERVER_PORT = 1420;

/** @type {string} Path to the SQLite database file */
export const DB_PATH = "data/portfolio60.db";

/** @type {string} Directory for database backups */
export const BACKUP_DIR = "backups";

/** @type {number} Multiplier for storing currency rates as integers (e.g. 1.2543 stored as 12543) */
export const CURRENCY_SCALE_FACTOR = 10000;
