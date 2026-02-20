#!/usr/bin/env bun
/**
 * @description One-off developer script to create the test reference data.
 * Copies the live database, config, and docs directory into
 * data/test_reference/ for use as the "gold master" test data set.
 *
 * After running, the developer should prune and anonymise the copied
 * database manually (see PLAN_v0.12.0.md for SQL steps).
 *
 * Usage:
 *   bun scripts/create-test-reference.js
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const LIVE_DB = "data/portfolio60.db";
const LIVE_CONFIG = "src/shared/config.json";
const LIVE_DOCS = "docs";
const TEST_REF_DIR = "data/test_reference";

/**
 * @description Recursively copy a directory tree from src to dest.
 * Creates destination directories as needed.
 * @param {string} src - Source directory path
 * @param {string} dest - Destination directory path
 * @returns {number} Count of files copied
 */
function copyDirRecursive(src, dest) {
  let count = 0;

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      count++;
    }
  }

  return count;
}

// --- Main ---

console.log("Creating test reference data...");
console.log("");

// Check live data exists
if (!existsSync(LIVE_DB)) {
  console.error("Error: Live database not found at " + resolve(LIVE_DB));
  console.error("Start the application and set up some data first.");
  process.exit(1);
}

if (!existsSync(LIVE_CONFIG)) {
  console.error("Error: Config file not found at " + resolve(LIVE_CONFIG));
  process.exit(1);
}

// Warn if test reference already exists
if (existsSync(TEST_REF_DIR)) {
  console.log("Warning: " + TEST_REF_DIR + "/ already exists — files will be overwritten.");
  console.log("");
}

// Create test reference directory
mkdirSync(TEST_REF_DIR, { recursive: true });

// 1. Copy database
const destDb = join(TEST_REF_DIR, "portfolio60.db");
copyFileSync(resolve(LIVE_DB), destDb);
console.log("  Database:  " + LIVE_DB + " -> " + destDb);

// Remove WAL/SHM files from the copy (not needed for the reference)
const walPath = destDb + "-wal";
const shmPath = destDb + "-shm";
// Don't copy WAL/SHM — the reference DB should be a clean standalone file

// 2. Copy config
const destConfig = join(TEST_REF_DIR, "config.json");
copyFileSync(resolve(LIVE_CONFIG), destConfig);
console.log("  Config:    " + LIVE_CONFIG + " -> " + destConfig);

// 3. Copy docs directory
const destDocs = join(TEST_REF_DIR, "docs");
let docsCount = 0;

if (existsSync(LIVE_DOCS)) {
  docsCount = copyDirRecursive(resolve(LIVE_DOCS), destDocs);
  console.log("  Docs:      " + LIVE_DOCS + "/ -> " + destDocs + "/ (" + docsCount + " files)");
} else {
  mkdirSync(destDocs, { recursive: true });
  console.log("  Docs:      (no docs/ directory found — created empty)");
}

console.log("");
console.log("Test reference data created in " + TEST_REF_DIR + "/");
console.log("");
console.log("Next steps:");
console.log("  1. Anonymise users and accounts in the test database");
console.log("  2. Reduce investments to a representative subset");
console.log("  3. Set up example portfolio holdings");
console.log("  4. Clear sensitive notes and surplus history");
console.log("  5. Prune test docs and config");
console.log("  6. Run a price fetch against the test database");
console.log("  7. Commit: git add data/test_reference/ && git commit");
console.log("");
console.log("See PLAN_v0.12.0.md Phase 2, Step 2.1 for detailed SQL.");
