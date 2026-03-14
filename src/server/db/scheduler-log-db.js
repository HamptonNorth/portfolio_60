import { getDatabase } from "./connection.js";

/**
 * @description Insert a log entry into the scheduler_log table.
 * Also writes the message to the console for immediate visibility.
 * @param {string} message - The log message
 * @param {string} [level="info"] - Log level: "info", "warn", or "error"
 */
export function writeSchedulerLog(message, level = "info") {
  const now = new Date().toISOString().replace("Z", "").split(".")[0];

  // Always echo to console so terminal output is unchanged
  const prefix = "[Scheduler]";
  if (level === "error") {
    console.error(prefix + " " + message);
  } else if (level === "warn") {
    console.warn(prefix + " " + message);
  } else {
    console.log(prefix + " " + message);
  }

  try {
    const db = getDatabase();
    db.run(
      "INSERT INTO scheduler_log (log_datetime, level, message) VALUES (?, ?, ?)",
      [now, level, message],
    );
  } catch (err) {
    // If the database is not available (e.g. not yet created), just
    // rely on the console output above. Do not throw.
    console.warn("[Scheduler] Could not write to scheduler_log: " + err.message);
  }
}

/**
 * @description Delete scheduler_log entries older than the specified number of days.
 * @param {number} [days=30] - Delete entries older than this many days
 * @returns {number} The number of rows deleted
 */
export function pruneSchedulerLog(days = 30) {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().replace("Z", "").split(".")[0];

  const result = db.run(
    "DELETE FROM scheduler_log WHERE log_datetime < ?",
    [cutoffStr],
  );

  return result.changes;
}

/**
 * @description Get recent scheduler log entries, newest first.
 * @param {number} [limit=100] - Maximum number of entries to return
 * @returns {Array<{id: number, log_datetime: string, level: string, message: string}>}
 */
export function getSchedulerLog(limit = 100) {
  const db = getDatabase();
  return db.query(
    "SELECT id, log_datetime, level, message FROM scheduler_log ORDER BY log_datetime DESC LIMIT ?",
  ).all(limit);
}
