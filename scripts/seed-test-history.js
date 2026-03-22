#!/usr/bin/env bun
/**
 * @description Populate historic holding changes in the test database.
 * Adds SCD2 history rows to simulate portfolio changes over the past
 * 36 months (buys, sells, new holdings).
 *
 * Run AFTER the test database has been created and seeded, and AFTER
 * a Fetch All has populated prices and rates.
 *
 * Usage:
 *   bun scripts/seed-test-history.js
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Database } from "bun:sqlite";
import { DATA_DIR } from "../src/shared/server-constants.js";

const TEST_REF_DIR = join(DATA_DIR, "data", "test_reference");
const TEST_DB_PATH = resolve(TEST_REF_DIR, "portfolio60.db");
const SQL_PATH = resolve("src/server/db/seed-test-history.sql");

// Check test database exists
if (!existsSync(TEST_DB_PATH)) {
  console.error("Error: Test database not found at " + TEST_DB_PATH);
  console.error("Create the test database first (enter test mode in the app).");
  process.exit(1);
}

// Check SQL file exists
if (!existsSync(SQL_PATH)) {
  console.error("Error: History seed SQL not found at " + SQL_PATH);
  process.exit(1);
}

// Open database and apply history
const db = new Database(TEST_DB_PATH);
db.exec("PRAGMA foreign_keys = ON");

const sql = readFileSync(SQL_PATH, "utf-8");

// Count holdings before
const before = db.query("SELECT COUNT(*) AS cnt FROM holdings").get();

db.exec(sql);

// Count holdings after
const after = db.query("SELECT COUNT(*) AS cnt FROM holdings").get();

// Show what was created
const historicRows = db.query(
  "SELECT h.account_id, h.investment_id, i.description, h.quantity / 10000.0 AS qty, h.average_cost / 10000.0 AS avg_cost, h.effective_from, h.effective_to FROM holdings h JOIN investments i ON h.investment_id = i.id ORDER BY h.effective_from, h.account_id, h.investment_id"
).all();

console.log("Test history seeded successfully.");
console.log("  Holdings before: " + before.cnt);
console.log("  Holdings after:  " + after.cnt);
console.log("  New rows added:  " + (after.cnt - before.cnt));
console.log("");
console.log("All holding rows:");
for (const row of historicRows) {
  const status = row.effective_to ? "closed " + row.effective_to : "active";
  console.log(
    "  acct=" + row.account_id +
    "  inv=" + row.investment_id +
    "  qty=" + row.qty.toFixed(2) +
    "  avg=" + row.avg_cost.toFixed(2) +
    "  from=" + row.effective_from +
    "  [" + status + "]" +
    "  " + row.description
  );
}

db.close();
