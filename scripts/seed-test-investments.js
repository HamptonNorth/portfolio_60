#!/usr/bin/env bun
/**
 * @description Load test investment seed data into the database.
 * Performs a clean reset each time: clears scraping history (started_by=3),
 * test_prices, and test_investments, then re-inserts the standard test data
 * set plus a copy of all current live investments.
 *
 * Safe to run repeatedly — always produces a consistent, clean state.
 *
 * Usage:
 *   bun scripts/seed-test-investments.js
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDatabase } from "../src/server/db/connection.js";

const db = getDatabase();

// Show current state before cleanup
const existingTests = db.query("SELECT COUNT(*) as count FROM test_investments").get();
const existingHistory = db.query("SELECT COUNT(*) as count FROM scraping_history WHERE started_by = 3").get();
const existingPrices = db.query("SELECT COUNT(*) as count FROM test_prices").get();
const existingLive = db.query("SELECT COUNT(*) as count FROM investments").get();

console.log("Current state:");
console.log("  test_investments:        " + existingTests.count + " rows");
console.log("  test_prices:             " + existingPrices.count + " rows");
console.log("  scraping_history (test):  " + existingHistory.count + " rows");
console.log("  live investments:        " + existingLive.count + " rows (will be copied)");
console.log("");

// Read and execute the seed SQL (includes cleanup + re-insert + live copy)
const seedPath = resolve("src/server/db/seed-test-investments.sql");
const seedSql = readFileSync(seedPath, "utf-8");

try {
  db.exec(seedSql);

  const afterTests = db.query("SELECT COUNT(*) as count FROM test_investments").get();
  const afterLiveCopies = db.query("SELECT COUNT(*) as count FROM test_investments WHERE source_site = 'Live Portfolio'").get();
  const hardCoded = afterTests.count - afterLiveCopies.count;

  console.log("Seed complete:");
  console.log("  " + hardCoded + " hard-coded test investments");
  console.log("  " + afterLiveCopies.count + " copied from live investments");
  console.log("  " + afterTests.count + " total test investments");
} catch (err) {
  console.error("Failed to seed test investments:", err.message);
  process.exit(1);
}
