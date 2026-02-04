import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DB_PATH } from "../../shared/constants.js";

/**
 * @description Resolved absolute path to the SQLite database file.
 * Uses the DB_PATH environment variable if set (e.g. for testing with
 * isolated databases), otherwise falls back to DB_PATH from constants.
 * @type {string}
 */
const resolvedDbPath = resolve(process.env.DB_PATH || DB_PATH);

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
  return existsSync(resolvedDbPath);
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

  db = new Database(resolvedDbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  return db;
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
  const dbDir = dirname(resolvedDbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Create the database file and configure it
  db = new Database(resolvedDbPath);
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
  return resolvedDbPath;
}
