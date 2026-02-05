import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DB_PATH } from "../../shared/constants.js";

/**
 * @description Cached resolved path to the database file. Set on first
 * call to getResolvedDbPath() so that test files can override
 * process.env.DB_PATH before any database function is called.
 * (ES module imports are hoisted above all other code, so a module-level
 * constant would evaluate before the test's env var assignment.)
 * @type {string|null}
 */
let resolvedDbPath = null;

/**
 * @description Get the resolved absolute path to the SQLite database file.
 * Uses the DB_PATH environment variable if set (e.g. for testing with
 * isolated databases), otherwise falls back to DB_PATH from constants.
 * The result is cached after the first call.
 * @returns {string} The absolute path to the database file
 */
function getResolvedDbPath() {
  if (resolvedDbPath === null) {
    resolvedDbPath = resolve(process.env.DB_PATH || DB_PATH);
  }
  return resolvedDbPath;
}

/**
 * @description Singleton database instance. Null until the database is
 * first opened via getDatabase().
 * @type {Database|null}
 */
let db = null;

/**
 * @description Check whether the database file exists on disk.
 * @returns {boolean} True if the database file exists
 */
export function databaseExists() {
  return existsSync(getResolvedDbPath());
}

/**
 * @description Get the singleton database connection. Opens the database
 * if not already open, enables WAL mode and foreign key enforcement.
 * Throws an error if the database file does not exist — use
 * createDatabase() first.
 * @returns {Database} The open database connection
 */
export function getDatabase() {
  if (db) {
    return db;
  }

  if (!databaseExists()) {
    throw new Error("Database does not exist. Call createDatabase() first.");
  }

  db = new Database(getResolvedDbPath());
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  return db;
}

/**
 * @description Run any pending schema migrations on an existing database.
 * Each migration checks whether it has already been applied before running.
 * @param {Database} database - The open database connection
 */
function runMigrations(database) {
  // Migration 1: Increase investments.selector CHECK constraint from 120 to 255.
  // Detect by inspecting the CREATE TABLE SQL in sqlite_master.
  const tableInfo = database.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='investments'").get();

  if (tableInfo && tableInfo.sql && tableInfo.sql.includes("length(selector) <= 120")) {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN TRANSACTION");
    try {
      database.exec(`
        CREATE TABLE investments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          currencies_id INTEGER NOT NULL,
          investment_type_id INTEGER NOT NULL,
          description TEXT NOT NULL CHECK(length(description) <= 60),
          investment_url TEXT CHECK(investment_url IS NULL OR length(investment_url) <= 255),
          selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
          FOREIGN KEY (currencies_id) REFERENCES currencies(id),
          FOREIGN KEY (investment_type_id) REFERENCES investment_types(id)
        )
      `);
      database.exec("INSERT INTO investments_new SELECT * FROM investments");
      database.exec("DROP TABLE investments");
      database.exec("ALTER TABLE investments_new RENAME TO investments");
      // Recreate indexes that were on the original table
      database.exec("CREATE INDEX IF NOT EXISTS idx_investments_type ON investments(investment_type_id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_investments_currency ON investments(currencies_id)");
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }
}

/**
 * @description Create the database file, run the schema SQL to create all
 * tables and indexes, then run the seed SQL to insert initial data
 * (investment types and GBP currency). Ensures the data/ directory exists.
 * If the database already exists, this is a no-op and returns false.
 * @returns {boolean} True if the database was created, false if it already existed
 */
export function createDatabase() {
  if (databaseExists()) {
    return false;
  }

  // Ensure the data/ directory exists
  const dbPath = getResolvedDbPath();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Create the database file and configure it
  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Read and execute the schema SQL
  const schemaPath = resolve("src/server/db/schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf-8");
  db.exec(schemaSql);

  // Read and execute the seed SQL
  const seedPath = resolve("src/server/db/seed.sql");
  const seedSql = readFileSync(seedPath, "utf-8");
  db.exec(seedSql);

  return true;
}

/**
 * @description Close the database connection and reset the singleton.
 * Safe to call even if the database is not open.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * @description Get the resolved path to the database file.
 * Useful for backup/restore operations.
 * @returns {string} The absolute path to the database file
 */
export function getDatabasePath() {
  return getResolvedDbPath();
}
