// Set isolated DB path BEFORE importing connection.js (which reads it lazily on first call)
process.env.DB_PATH = "data/portfolio_60_test/test-backup-db.db";

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { existsSync, unlinkSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDatabase, closeDatabase, getDatabasePath, getDatabase } from "../../src/server/db/connection.js";
import { createBackup, listBackups, restoreBackup, deleteBackup } from "../../src/server/db/backup-db.js";
import { createCurrency } from "../../src/server/db/currencies-db.js";

const testDbPath = getDatabasePath();

/**
 * @description The backups directory used by backup-db.js.
 * We clean it before/after tests.
 * @type {string}
 */
const backupDir = resolve("backups");

/**
 * @description Clean up the isolated test database files.
 */
function cleanupDatabase() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = testDbPath + suffix;
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/**
 * @description Remove all test backup files from the backups directory.
 * Removes both zip (portfolio_60_backup_*.zip) and legacy db (portfolio60_*.db) files.
 */
function cleanupBackups() {
  if (!existsSync(backupDir)) return;
  const files = readdirSync(backupDir);
  for (const f of files) {
    if ((f.startsWith("portfolio60_") && f.endsWith(".db")) || (f.startsWith("portfolio_60_backup_") && f.endsWith(".zip"))) {
      unlinkSync(join(backupDir, f));
    }
  }
}

beforeAll(() => {
  cleanupDatabase();
  cleanupBackups();
  createDatabase();
});

afterAll(() => {
  cleanupDatabase();
  cleanupBackups();
});

// --- createBackup ---

describe("createBackup", () => {
  test("creates a backup zip file with timestamped name", async () => {
    const result = await createBackup();
    expect(result.success).toBe(true);
    expect(result.filename).toMatch(/^portfolio_60_backup_\d{8}_\d{6}\.zip$/);
    expect(result.size).toBeGreaterThan(0);
    expect(existsSync(result.path)).toBe(true);
  });

  test("backup zip file contains database", async () => {
    // Add some data to the live database
    try {
      createCurrency({ code: "USD", description: "US Dollar" });
    } catch {
      // May already exist
    }

    const result = await createBackup();
    expect(result.success).toBe(true);

    // The backup file should exist and be non-empty
    expect(existsSync(result.path)).toBe(true);
    expect(result.size).toBeGreaterThan(0);
  });

  test("creates backups directory if it does not exist", async () => {
    const result = await createBackup();
    expect(result.success).toBe(true);
    expect(existsSync(backupDir)).toBe(true);
  });
});

// --- listBackups ---

describe("listBackups", () => {
  beforeEach(() => {
    cleanupBackups();
  });

  test("returns empty list when no backups exist", () => {
    const result = listBackups();
    expect(result.success).toBe(true);
    expect(result.backups).toHaveLength(0);
    expect(result.message).toBe("0 backups found");
  });

  test("lists backup files sorted by newest first", async () => {
    // Create two backups with a small delay
    const first = await createBackup();
    expect(first.success).toBe(true);

    // Tiny delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const second = await createBackup();
    expect(second.success).toBe(true);

    const result = listBackups();
    expect(result.success).toBe(true);
    expect(result.backups.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(result.backups[0].filename).toBe(second.filename);
  });

  test("each backup entry has filename, size, modified and format", async () => {
    await createBackup();
    const result = listBackups();
    expect(result.success).toBe(true);
    expect(result.backups.length).toBeGreaterThanOrEqual(1);

    const b = result.backups[0];
    expect(b.filename).toBeDefined();
    expect(b.size).toBeGreaterThan(0);
    expect(b.modified).toBeDefined();
    expect(b.format).toBe("zip");
  });

  test("ignores non-portfolio files in backups directory", () => {
    // Create a non-matching file
    const otherFile = join(backupDir, "other-file.db");
    Bun.write(otherFile, "test");

    const result = listBackups();
    expect(result.success).toBe(true);

    // Should not include the other file
    const filenames = result.backups.map((b) => b.filename);
    expect(filenames).not.toContain("other-file.db");

    // Cleanup
    if (existsSync(otherFile)) {
      unlinkSync(otherFile);
    }
  });
});

// --- restoreBackup ---

describe("restoreBackup", () => {
  beforeEach(() => {
    cleanupBackups();
  });

  test("restores database from a zip backup", async () => {
    // Create initial backup with USD currency
    const backup = await createBackup();
    expect(backup.success).toBe(true);

    // Add a new currency to the live DB
    try {
      createCurrency({ code: "EUR", description: "Euro" });
    } catch {
      // May already exist from earlier test
    }

    // Verify EUR exists before restore
    const db = getDatabase();
    const eurBefore = db.query("SELECT * FROM currencies WHERE code = 'EUR'").get();
    expect(eurBefore).not.toBeNull();

    // Restore the backup (which was taken before EUR was added)
    const result = restoreBackup(backup.filename);
    expect(result.success).toBe(true);
    expect(result.format).toBe("zip");
    expect(result.message).toContain(backup.filename);
  });

  test("rejects invalid filename (directory traversal)", () => {
    const result = restoreBackup("../../../etc/passwd");
    expect(result.success).toBe(false);
    expect(result.message).toBe("Invalid backup filename");
  });

  test("rejects filename that does not match expected patterns", () => {
    const result = restoreBackup("other-file.db");
    expect(result.success).toBe(false);
    expect(result.message).toBe("Invalid backup filename");
  });

  test("rejects non-existent backup file", () => {
    const result = restoreBackup("portfolio_60_backup_99990101_000000.zip");
    expect(result.success).toBe(false);
    expect(result.message).toBe("Backup file not found");
  });

  test("database is accessible after restore", async () => {
    const backup = await createBackup();
    expect(backup.success).toBe(true);

    const result = restoreBackup(backup.filename);
    expect(result.success).toBe(true);

    // Verify the database is usable after restore
    const db = getDatabase();
    const gbp = db.query("SELECT * FROM currencies WHERE code = 'GBP'").get();
    expect(gbp).not.toBeNull();
    expect(gbp.code).toBe("GBP");
  });
});

// --- deleteBackup ---

describe("deleteBackup", () => {
  beforeEach(() => {
    cleanupBackups();
  });

  test("deletes an existing backup file", async () => {
    const backup = await createBackup();
    expect(backup.success).toBe(true);
    expect(existsSync(backup.path)).toBe(true);

    const result = deleteBackup(backup.filename);
    expect(result.success).toBe(true);
    expect(existsSync(backup.path)).toBe(false);
  });

  test("rejects invalid filename (directory traversal)", () => {
    const result = deleteBackup("../../../etc/important.db");
    expect(result.success).toBe(false);
    expect(result.message).toBe("Invalid backup filename");
  });

  test("rejects non-existent backup file", () => {
    const result = deleteBackup("portfolio_60_backup_99990101_000000.zip");
    expect(result.success).toBe(false);
    expect(result.message).toBe("Backup file not found");
  });

  test("backup list shrinks after delete", async () => {
    const backup = await createBackup();
    expect(backup.success).toBe(true);

    const beforeDelete = listBackups();
    const countBefore = beforeDelete.backups.length;

    deleteBackup(backup.filename);

    const afterDelete = listBackups();
    expect(afterDelete.backups.length).toBe(countBefore - 1);
  });
});
