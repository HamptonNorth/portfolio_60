import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { resolve, join, basename } from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { BACKUP_DIR, getDocsDir } from "../../shared/constants.js";
import { getDatabasePath, closeDatabase, getDatabase } from "./connection.js";
import { getConfigFilePath } from "../config.js";

/**
 * @description Get the resolved absolute path to the backups directory.
 * Always uses the project-local BACKUP_DIR constant (backups/).
 * @returns {string} Absolute path to the backups directory
 */
function getBackupDir() {
  return resolve(BACKUP_DIR);
}

/**
 * @description Get the resolved absolute path to the test backups directory.
 * Always uses backups/test/ under the project-local BACKUP_DIR.
 * @returns {string} Absolute path to the test backups directory
 */
function getTestBackupDir() {
  return resolve(join(BACKUP_DIR, "test"));
}

/**
 * @description Ensure a directory exists, creating it (and parents) if necessary.
 * @param {string} dir - Absolute path to the directory
 */
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * @description Generate a timestamped zip backup filename.
 * Format: portfolio_60_backup_YYYYMMDD_HHMMSS.zip
 * @returns {string} The backup filename
 */
function generateZipFilename() {
  const now = new Date();
  const timestamp = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "_" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
  return "portfolio_60_backup_" + timestamp + ".zip";
}

/**
 * @description Generate a timestamped test backup zip filename.
 * Format: test_backup_YYYYMMDD_HHMMSS.zip
 * @returns {string} The test backup filename
 */
function generateTestZipFilename() {
  const now = new Date();
  const timestamp = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + "_" + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
  return "test_backup_" + timestamp + ".zip";
}

/**
 * @description Create a zip archive containing the database, config.json, and docs directory.
 * The archive is written to the specified output path.
 * @param {string} dbPath - Absolute path to the database file to include
 * @param {string} configPath - Absolute path to the config.json to include
 * @param {string} docsDir - Absolute path to the docs directory to include
 * @param {string} outputPath - Absolute path for the output zip file
 * @returns {Promise<{success: boolean, size: number, error?: string}>}
 */
function createZipArchive(dbPath, configPath, docsDir, outputPath) {
  return new Promise(function (promiseResolve, promiseReject) {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    let finalSize = 0;

    output.on("close", function () {
      finalSize = archive.pointer();
      promiseResolve({ success: true, size: finalSize });
    });

    archive.on("error", function (err) {
      promiseReject(err);
    });

    archive.pipe(output);

    // Add the database file
    if (existsSync(dbPath)) {
      archive.file(dbPath, { name: "portfolio60.db" });
    }

    // Add config.json
    if (existsSync(configPath)) {
      archive.file(configPath, { name: "config.json" });
    }

    // Add the docs directory tree
    if (existsSync(docsDir)) {
      archive.directory(docsDir, "docs");
    }

    archive.finalize();
  });
}

/**
 * @description Create a backup of the current database, config, and docs as a zip file.
 * The zip is always written to the project-local backups/ directory. If test reference
 * data exists, a separate test backup zip is also created in backups/test/.
 * @returns {Promise<{success: boolean, filename: string, path: string, size: number, message: string, testBackup?: {filename: string, path: string, size: number}, error?: string}>}
 */
export async function createBackup() {
  try {
    const backupDir = getBackupDir();
    ensureDir(backupDir);

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

    const configPath = getConfigFilePath();
    const docsDir = resolve(getDocsDir());
    const filename = generateZipFilename();
    const outputPath = join(backupDir, filename);

    const result = await createZipArchive(dbPath, configPath, docsDir, outputPath);

    const response = {
      success: true,
      filename: filename,
      path: outputPath,
      size: result.size,
      message: "Backup created: " + filename,
    };

    // Also create a test reference backup if test reference data exists
    const testRefDir = resolve("data/test_reference");
    const testRefDb = join(testRefDir, "portfolio60.db");
    if (existsSync(testRefDb)) {
      try {
        const testBackupDir = getTestBackupDir();
        ensureDir(testBackupDir);

        const testConfigPath = join(testRefDir, "config.json");
        const testDocsDir = join(testRefDir, "docs");
        const testFilename = generateTestZipFilename();
        const testOutputPath = join(testBackupDir, testFilename);

        const testResult = await createZipArchive(testRefDb, testConfigPath, testDocsDir, testOutputPath);

        response.testBackup = {
          filename: testFilename,
          path: testOutputPath,
          size: testResult.size,
        };
        response.message += " (test backup also created: " + testFilename + ")";
      } catch (testErr) {
        // Non-fatal — live backup succeeded, just note the test backup failure
        response.message += " (test backup failed: " + testErr.message + ")";
      }
    }

    return response;
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
 * modification time (newest first). Includes both .zip (new format) and .db (legacy).
 * @returns {{success: boolean, backups: Object[], message: string, error?: string}}
 *   Each backup object has: filename, size, modified (ISO-8601 string), format ("zip" or "db")
 */
export function listBackups() {
  try {
    const dir = getBackupDir();
    ensureDir(dir);
    const files = readdirSync(dir);

    const backups = files
      .filter(function (f) {
        // New zip format: portfolio_60_backup_*.zip
        // Legacy db format: portfolio60_*.db
        return (f.endsWith(".zip") && f.startsWith("portfolio_60_backup_")) || (f.endsWith(".db") && f.startsWith("portfolio60_"));
      })
      .map(function (f) {
        const filePath = join(dir, f);
        const stats = statSync(filePath);
        const format = f.endsWith(".zip") ? "zip" : "db";
        return {
          filename: f,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          format: format,
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
 * @description Validate a backup filename to prevent directory traversal.
 * Accepts both zip (portfolio_60_backup_*.zip) and legacy db (portfolio60_*.db) formats.
 * @param {string} filename - The filename to validate
 * @returns {{valid: boolean, format: string, error?: string}}
 */
function validateFilename(filename) {
  const safeFilename = basename(filename);
  if (safeFilename !== filename) {
    return { valid: false, format: "", error: "Invalid path in filename" };
  }

  if (filename.endsWith(".zip") && filename.startsWith("portfolio_60_backup_")) {
    return { valid: true, format: "zip" };
  }

  if (filename.endsWith(".db") && filename.startsWith("portfolio60_")) {
    return { valid: true, format: "db" };
  }

  return { valid: false, format: "", error: "Filename must be a portfolio_60_backup_*.zip or portfolio60_*.db file" };
}

/**
 * @description Restore from a zip backup. Extracts the database, config, and docs
 * from the zip file, replacing the live data.
 * @param {string} zipPath - Absolute path to the zip file
 * @param {string} dbPath - Absolute path to the live database
 * @param {string} configPath - Absolute path to the live config.json
 * @param {string} docsDir - Absolute path to the live docs directory
 */
function restoreFromZip(zipPath, dbPath, configPath, docsDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  for (const entry of entries) {
    const entryName = entry.entryName;

    if (entryName === "portfolio60.db") {
      // Extract database — write directly to the DB path
      writeFileSync(dbPath, entry.getData());
    } else if (entryName === "config.json") {
      // Extract config
      writeFileSync(configPath, entry.getData());
    } else if (entryName.startsWith("docs/")) {
      // Extract docs files — preserve directory structure under docsDir
      const relativePath = entryName.slice(5); // Remove "docs/" prefix
      if (relativePath === "" || entry.isDirectory) {
        // Directory entry — ensure it exists
        const dirPath = join(docsDir, relativePath);
        ensureDir(dirPath);
      } else {
        // File entry
        const filePath = join(docsDir, relativePath);
        const parentDir = resolve(join(docsDir, relativePath), "..");
        ensureDir(parentDir);
        writeFileSync(filePath, entry.getData());
      }
    }
  }
}

/**
 * @description Restore the database (and optionally config/docs) from a backup file.
 * Backups are always read from the project-local backups/ directory.
 * For zip files: restores database, config.json, and docs directory.
 * For legacy .db files: restores database only.
 * @param {string} filename - The backup filename to restore
 * @returns {{success: boolean, filename: string, format: string, message: string, error?: string}}
 */
export function restoreBackup(filename) {
  try {
    const validation = validateFilename(filename);
    if (!validation.valid) {
      return {
        success: false,
        filename: filename,
        format: "",
        message: "Invalid backup filename",
        error: validation.error,
      };
    }

    const backupPath = join(getBackupDir(), filename);
    if (!existsSync(backupPath)) {
      return {
        success: false,
        filename: filename,
        format: validation.format,
        message: "Backup file not found",
        error: "No backup file at " + backupPath,
      };
    }

    const dbPath = getDatabasePath();

    // Close the current database connection
    closeDatabase();

    // Remove WAL and SHM files if they exist
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (existsSync(walPath)) {
      unlinkSync(walPath);
    }
    if (existsSync(shmPath)) {
      unlinkSync(shmPath);
    }

    if (validation.format === "zip") {
      // Zip restore: database + config + docs
      const configPath = getConfigFilePath();
      const docsDir = resolve(getDocsDir());
      restoreFromZip(backupPath, dbPath, configPath, docsDir);
    } else {
      // Legacy .db restore: database only
      copyFileSync(backupPath, dbPath);
    }

    // Reopen the database connection
    getDatabase();

    const formatLabel = validation.format === "zip" ? "database, config and docs" : "database only";
    return {
      success: true,
      filename: filename,
      format: validation.format,
      message: "Restored from " + filename + " (" + formatLabel + ")",
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
      format: "",
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
    const validation = validateFilename(filename);
    if (!validation.valid) {
      return {
        success: false,
        filename: filename,
        message: "Invalid backup filename",
        error: validation.error,
      };
    }

    const backupPath = join(getBackupDir(), filename);
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

/**
 * @description Read a backup file from the backups directory and return its
 * contents as a Buffer for browser download.
 * @param {string} filename - The backup filename to download
 * @returns {{success: boolean, filename: string, data?: Buffer, contentType?: string, error?: string}}
 */
export function getBackupFile(filename) {
  try {
    const validation = validateFilename(filename);
    if (!validation.valid) {
      return {
        success: false,
        filename: filename,
        error: validation.error,
      };
    }

    const backupPath = join(getBackupDir(), filename);
    if (!existsSync(backupPath)) {
      return {
        success: false,
        filename: filename,
        error: "No backup file at " + backupPath,
      };
    }

    const data = readFileSync(backupPath);
    const contentType = validation.format === "zip" ? "application/zip" : "application/octet-stream";

    return {
      success: true,
      filename: filename,
      data: data,
      contentType: contentType,
    };
  } catch (err) {
    return {
      success: false,
      filename: filename,
      error: err.message,
    };
  }
}

/**
 * @description Upload a backup file into the backups directory. Validates the
 * filename matches expected patterns and that the file does not already exist.
 * @param {string} filename - The original filename of the uploaded file
 * @param {Buffer|Uint8Array} data - The file contents
 * @returns {{success: boolean, filename: string, size: number, message: string, error?: string}}
 */
export function uploadBackup(filename, data) {
  try {
    const validation = validateFilename(filename);
    if (!validation.valid) {
      return {
        success: false,
        filename: filename,
        size: 0,
        message: "Invalid backup filename",
        error: validation.error,
      };
    }

    const backupDir = getBackupDir();
    ensureDir(backupDir);

    const backupPath = join(backupDir, filename);
    if (existsSync(backupPath)) {
      return {
        success: false,
        filename: filename,
        size: 0,
        message: "Backup already exists",
        error: "A backup with this filename already exists. Delete it first or rename the file.",
      };
    }

    writeFileSync(backupPath, data);
    const stats = statSync(backupPath);

    return {
      success: true,
      filename: filename,
      size: stats.size,
      message: "Backup uploaded: " + filename,
    };
  } catch (err) {
    return {
      success: false,
      filename: filename,
      size: 0,
      message: "Upload failed",
      error: err.message,
    };
  }
}
