import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { closeDatabase, resetDatabasePath } from "./db/connection.js";
import { setConfigPath, reloadConfig } from "./config.js";

/**
 * @description In-memory flag tracking whether the current session is in test mode.
 * @type {boolean}
 */
let testModeActive = false;

/**
 * @description The test reference data directory path.
 * @type {string}
 */
const TEST_REF_DIR = "data/test_reference";

/**
 * @description Check whether test reference data exists on disk.
 * @returns {boolean} True if the test reference database exists
 */
export function testReferenceExists() {
  const testDbPath = resolve(TEST_REF_DIR, "portfolio60.db");
  return existsSync(testDbPath);
}

/**
 * @description Activate test mode. Switches the database, docs, and config
 * paths to point at the test reference data. Closes the current database
 * connection so the next getDatabase() call opens the test reference database.
 * @returns {boolean} True if test mode was activated successfully
 */
export function activateTestMode() {
  if (!testReferenceExists()) {
    return false;
  }

  testModeActive = true;

  // Close the current database connection
  closeDatabase();

  // Point database at test reference
  process.env.DB_PATH = resolve(TEST_REF_DIR, "portfolio60.db");
  resetDatabasePath();

  // Point docs at test reference
  process.env.DOCS_DIR = resolve(TEST_REF_DIR, "docs");

  // Load test reference config
  const testConfigPath = resolve(TEST_REF_DIR, "config.json");
  if (existsSync(testConfigPath)) {
    setConfigPath(testConfigPath);
  }

  return true;
}

/**
 * @description Deactivate test mode. Resets paths back to live data.
 * Called on app restart or explicit logout.
 */
export function deactivateTestMode() {
  testModeActive = false;

  // Close the test database connection
  closeDatabase();

  // Reset database path to default (removes env override)
  delete process.env.DB_PATH;
  resetDatabasePath();

  // Reset docs path to default
  delete process.env.DOCS_DIR;

  // Reset config to default path
  setConfigPath(null);
  reloadConfig();
}

/**
 * @description Check whether the current session is in test mode.
 * @returns {boolean} True if test mode is active
 */
export function isTestMode() {
  return testModeActive;
}
