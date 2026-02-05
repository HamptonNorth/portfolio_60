import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { BACKUP_DIR } from "../../shared/constants.js";
import { getDatabasePath, closeDatabase, getDatabase } from "./connection.js";

/**
 * @description Get the resolved absolute path to the backups directory.
 * @returns {string} Absolute path to the backups directory
 */
function getBackupDir() {
  return resolve(BACKUP_DIR);
}

/**
 * @description Ensure the backups directory exists, creating it if necessary.
 */
function ensureBackupDir() {
  const dir = getBackupDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * @description Generate a timestamped backup filename.
 * Format: portfolio60_YYYYMMDD_HHMMSS.db
 * @returns {string} The backup filename
 */
function generateBackupFilename() {
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  return "portfolio60_" + timestamp + ".db";
}

/**
 * @description Create a backup of the current database by copying the SQLite file
 * to the backups directory with a timestamped filename. Uses SQLite's backup
 * method via a WAL checkpoint to ensure the backup is consistent.
 * @returns {{success: boolean, filename: string, path: string, size: number, message: string, error?: string}}
 */
export function createBackup() {
  try {
    ensureBackupDir();

    const dbPath = getDatabasePath();
    if (!existsSync(dbPath)) {
      return {
        success: false,
        filename: "",
        path: "",
        size: 0,
        message: "Database file not found",
        error: "No database file at " + dbPath,
      };
    }

    // Force a WAL checkpoint to ensure all data is written to the main DB file
    const db = getDatabase();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

    const filename = generateBackupFilename();
    const backupPath = join(getBackupDir(), filename);

    copyFileSync(dbPath, backupPath);

    const stats = statSync(backupPath);

    return {
      success: true,
      filename: filename,
      path: backupPath,
      size: stats.size,
      message: "Backup created: " + filename,
    };
  } catch (err) {
    return {
      success: false,
      filename: "",
      path: "",
      size: 0,
      message: "Backup failed",
      error: err.message,
    };
  }
}

/**
 * @description List all backup files in the backups directory, sorted by
 * modification time (newest first).
 * @returns {{success: boolean, backups: Object[], message: string, error?: string}}
 *   Each backup object has: filename, size, modified (ISO-8601 string)
 */
export function listBackups() {
  try {
    ensureBackupDir();
    const dir = getBackupDir();
    const files = readdirSync(dir);

    const backups = files
      .filter(function (f) {
        return f.endsWith(".db") && f.startsWith("portfolio60_");
      })
      .map(function (f) {
        const filePath = join(dir, f);
        const stats = statSync(filePath);
        return {
          filename: f,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      })
      .sort(function (a, b) {
        // Newest first
        return b.modified.localeCompare(a.modified);
      });

    return {
      success: true,
      backups: backups,
      message: backups.length + " backup" + (backups.length === 1 ? "" : "s") + " found",
    };
  } catch (err) {
    return {
      success: false,
      backups: [],
      message: "Failed to list backups",
      error: err.message,
    };
  }
}

/**
 * @description Restore the database from a backup file. Closes the current
 * database connection, copies the backup file over the live database,
 * then reopens the connection. The WAL and SHM files are removed before
 * the copy to ensure a clean restore.
 * @param {string} filename - The backup filename to restore (e.g. "portfolio60_20260205_143200.db")
 * @returns {{success: boolean, filename: string, message: string, error?: string}}
 */
export function restoreBackup(filename) {
  try {
    // Validate the filename to prevent directory traversal
    const safeFilename = basename(filename);
    if (safeFilename !== filename || !filename.endsWith(".db") || !filename.startsWith("portfolio60_")) {
      return {
        success: false,
        filename: filename,
        message: "Invalid backup filename",
        error: "Filename must be a portfolio60_*.db file",
      };
    }

    const backupPath = join(getBackupDir(), safeFilename);
    if (!existsSync(backupPath)) {
      return {
        success: false,
        filename: filename,
        message: "Backup file not found",
        error: "No backup file at " + backupPath,
      };
    }

    const dbPath = getDatabasePath();

    // Close the current database connection
    closeDatabase();

    // Remove WAL and SHM files if they exist (stale journal files would
    // cause SQLite to replay them on next open, corrupting the restore)
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (existsSync(walPath)) {
      unlinkSync(walPath);
    }
    if (existsSync(shmPath)) {
      unlinkSync(shmPath);
    }

    // Copy the backup over the live database
    copyFileSync(backupPath, dbPath);

    // Reopen the database connection (getDatabase() will create a new one)
    getDatabase();

    return {
      success: true,
      filename: filename,
      message: "Database restored from " + filename,
    };
  } catch (err) {
    // Try to reopen the database even if restore failed
    try {
      getDatabase();
    } catch {
      // Ignore — the database may be in a bad state
    }

    return {
      success: false,
      filename: filename,
      message: "Restore failed",
      error: err.message,
    };
  }
}

/**
 * @description Delete a backup file from the backups directory.
 * @param {string} filename - The backup filename to delete
 * @returns {{success: boolean, filename: string, message: string, error?: string}}
 */
export function deleteBackup(filename) {
  try {
    // Validate the filename to prevent directory traversal
    const safeFilename = basename(filename);
    if (safeFilename !== filename || !filename.endsWith(".db") || !filename.startsWith("portfolio60_")) {
      return {
        success: false,
        filename: filename,
        message: "Invalid backup filename",
        error: "Filename must be a portfolio60_*.db file",
      };
    }

    const backupPath = join(getBackupDir(), safeFilename);
    if (!existsSync(backupPath)) {
      return {
        success: false,
        filename: filename,
        message: "Backup file not found",
        error: "No backup file at " + backupPath,
      };
    }

    unlinkSync(backupPath);

    return {
      success: true,
      filename: filename,
      message: "Backup deleted: " + filename,
    };
  } catch (err) {
    return {
      success: false,
      filename: filename,
      message: "Delete failed",
      error: err.message,
    };
  }
}
