import { resolve, join } from "node:path";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { DATA_DIR } from "../shared/server-constants.js";
import { closeDatabase, createDatabase, getDatabase, resetDatabasePath } from "./db/connection.js";
import { setConfigPath, reloadConfig } from "./config.js";

/**
 * @description In-memory flag tracking whether the current session is in test mode.
 * @type {boolean}
 */
let testModeActive = false;

/**
 * @description Whether the test database was freshly created in this session.
 * When true, the UI should prompt the user to run Fetch All to populate prices.
 * @type {boolean}
 */
let freshlyCreated = false;

/**
 * @description The test reference data directory path, under DATA_DIR/data/test_reference.
 * @type {string}
 */
const TEST_REF_DIR = join(DATA_DIR, "data", "test_reference");

/**
 * @description Check whether test reference data exists on disk.
 * @returns {boolean} True if the test reference database exists
 */
export function testReferenceExists() {
  const testDbPath = resolve(TEST_REF_DIR, "portfolio60.db");
  return existsSync(testDbPath);
}

/**
 * @description Check whether the test database was freshly created in this session.
 * @returns {boolean} True if the test database was created during this activation
 */
export function isTestDatabaseFresh() {
  return freshlyCreated;
}

/**
 * @description Create and seed a new test database from scratch. Sets up
 * the schema, base seed data (investment_types + GBP), runs migrations,
 * then applies the test-specific seed (currencies, investments, benchmarks).
 * @returns {boolean} True if creation succeeded
 */
function createTestDatabase() {
  // Ensure the test reference directory exists
  if (!existsSync(TEST_REF_DIR)) {
    mkdirSync(TEST_REF_DIR, { recursive: true });
  }

  // Point DB_PATH at the test reference location
  const testDbPath = resolve(TEST_REF_DIR, "portfolio60.db");
  process.env.DB_PATH = testDbPath;
  resetDatabasePath();

  // Create schema + base seed (investment_types + GBP)
  createDatabase();

  // Open the database (triggers migrations)
  const db = getDatabase();

  // Apply test-specific seed data (currencies, investments, benchmarks)
  const seedPath = resolve("src/server/db/seed-test-database.sql");
  if (existsSync(seedPath)) {
    const seedSql = readFileSync(seedPath, "utf-8");
    db.exec(seedSql);
    console.log("[Test Mode] Test database created and seeded at " + testDbPath);
  } else {
    console.warn("[Test Mode] Test database created but seed file not found: " + seedPath);
  }

  // Close so activateTestMode can re-open cleanly
  closeDatabase();

  return true;
}

/**
 * @description Activate test mode. If no test database exists, creates and
 * seeds one from scratch. Switches the database, docs, and config paths to
 * point at the test reference data. Closes the current database connection
 * so the next getDatabase() call opens the test reference database.
 * @returns {boolean} True if test mode was activated successfully
 */
export function activateTestMode() {
  freshlyCreated = false;

  // If no test database exists, create and seed one
  if (!testReferenceExists()) {
    // Close the live database first
    closeDatabase();

    try {
      createTestDatabase();
      freshlyCreated = true;
    } catch (err) {
      console.error("[Test Mode] Failed to create test database:", err.message);
      // Reset DB_PATH back to live
      delete process.env.DB_PATH;
      resetDatabasePath();
      return false;
    }
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
  const testConfigPath = resolve(TEST_REF_DIR, "user-settings.json");
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
