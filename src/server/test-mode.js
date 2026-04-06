import { resolve, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { DATA_DIR, TEST_DB_FILENAME } from "../shared/server-constants.js";
import {
  closeDatabase,
  createDatabase,
  getDatabase,
  resetDatabasePath,
} from "./db/connection.js";
import { setConfigPath, reloadConfig } from "./config.js";

/**
 * @description The public-facing hostname that must always serve demo data.
 * When the Host header matches this value, the app forces demo mode regardless
 * of which passphrase is entered. This prevents live data from being exposed
 * through the public URL.
 * @type {string}
 */
const PUBLIC_DEMO_HOSTNAME = "portfolio60.redmug.dev";

/**
 * @description Check whether a request originates from the public demo hostname.
 * Compares the Host header (stripping any port suffix) against PUBLIC_DEMO_HOSTNAME.
 * @param {Request} request - The incoming HTTP request
 * @returns {boolean} True if the request is from the public demo hostname
 */
export function isPublicDemoHost(request) {
  const host = (request.headers.get("host") || "").split(":")[0];
  return host === PUBLIC_DEMO_HOSTNAME;
}

/**
 * @description In-memory flag tracking whether the current session is in test mode.
 * @type {boolean}
 */
let testModeActive = false;

/**
 * @description In-memory flag tracking whether the current session is in demo
 * (read-only) mode. When true, all write operations are blocked and fetch
 * requests return simulated data from the existing database.
 * @type {boolean}
 */
let demoModeActive = false;

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
  const testDbPath = resolve(TEST_REF_DIR, TEST_DB_FILENAME);
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
  // Point DB_PATH at the test reference location.
  // createDatabase() handles directory creation — it must create the
  // directory itself so that disableCopyOnWrite() is called on btrfs
  // filesystems (prevents "disk I/O error" under sustained writes).
  const testDbPath = resolve(TEST_REF_DIR, TEST_DB_FILENAME);
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
    console.log(
      "[Test Mode] Test database created and seeded at " + testDbPath,
    );
  } else {
    console.warn(
      "[Test Mode] Test database created but seed file not found: " + seedPath,
    );
  }

  // Close so activateTestMode can re-open cleanly
  closeDatabase();

  return true;
}

/**
 * @description Copy guide markdown files from the repo docs directory into
 * the test reference docs directory. This ensures that user guides are
 * available for search and viewing in demo/test mode even though the test
 * docs directory starts empty. Only copies files that don't already exist
 * in the target (preserves any test-specific docs).
 */
function syncRepoGuidesToTestDocs(testDocsDir) {
  try {
    const repoDocsDir = resolve("docs");
    if (!existsSync(repoDocsDir)) return;

    const categories = readdirSync(repoDocsDir, { withFileTypes: true });
    for (let i = 0; i < categories.length; i++) {
      if (!categories[i].isDirectory()) continue;

      const categoryName = categories[i].name;
      const srcDir = join(repoDocsDir, categoryName);
      const destDir = join(testDocsDir, categoryName);

      mkdirSync(destDir, { recursive: true });

      const files = readdirSync(srcDir);
      for (let j = 0; j < files.length; j++) {
        if (!files[j].endsWith(".md")) continue;
        const srcFile = join(srcDir, files[j]);
        const destFile = join(destDir, files[j]);
        if (!existsSync(destFile)) {
          copyFileSync(srcFile, destFile);
        }
      }
    }
  } catch (err) {
    console.warn("[Test Mode] Failed to sync repo guides to test docs:", err.message);
  }
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
  process.env.DB_PATH = resolve(TEST_REF_DIR, TEST_DB_FILENAME);
  resetDatabasePath();

  // Point docs at test reference, copying repo guide files if needed
  const testDocsDir = resolve(TEST_REF_DIR, "docs");
  process.env.DOCS_DIR = testDocsDir;
  syncRepoGuidesToTestDocs(testDocsDir);

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
  demoModeActive = false;

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

/**
 * @description Check whether the current session is in demo (read-only) mode.
 * Demo mode uses the test database but blocks all write operations.
 * @returns {boolean} True if demo mode is active
 */
export function isDemoMode() {
  return demoModeActive;
}

/**
 * @description Set the demo mode flag. Called during passphrase handling
 * to enable or disable read-only demo mode.
 * @param {boolean} value - True to enable demo mode, false to disable
 */
export function setDemoMode(value) {
  demoModeActive = !!value;
}
