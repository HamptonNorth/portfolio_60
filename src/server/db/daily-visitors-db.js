import { getDatabase } from "./connection.js";

/**
 * @description Upsert a daily visitor count row. Uses MAX to preserve the
 * higher count if the server restarts mid-day (in-memory Sets are lost on
 * restart, so the earlier flush will have the more complete tally).
 * @param {string} date - ISO-8601 date string (YYYY-MM-DD)
 * @param {number} enGbCount - Number of unique en-GB visitors
 * @param {number} otherCount - Number of unique non-en-GB visitors
 */
export function upsertDailyVisitors(date, enGbCount, otherCount) {
  try {
    const db = getDatabase();
    db.run(
      `INSERT INTO daily_visitors (visit_date, en_gb_count, other_count)
       VALUES (?, ?, ?)
       ON CONFLICT(visit_date) DO UPDATE SET
         en_gb_count = MAX(en_gb_count, excluded.en_gb_count),
         other_count = MAX(other_count, excluded.other_count)`,
      [date, enGbCount, otherCount],
    );
  } catch (err) {
    // Database may not exist yet (fresh install). Do not throw.
    console.warn("[Visitors] Could not write daily visitors: " + err.message);
  }
}

/**
 * @description Get recent daily visitor counts, newest first.
 * @param {number} [limit=90] - Maximum number of days to return
 * @returns {Array<{id: number, visit_date: string, en_gb_count: number, other_count: number}>}
 */
export function getDailyVisitors(limit = 90) {
  const db = getDatabase();
  return db.query(
    "SELECT id, visit_date, en_gb_count, other_count FROM daily_visitors ORDER BY visit_date DESC LIMIT ?",
  ).all(limit);
}

/**
 * @description Delete daily visitor entries older than the specified number of days.
 * @param {number} [days=365] - Delete entries older than this many days
 * @returns {number} The number of rows deleted
 */
export function pruneDailyVisitors(days = 365) {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const result = db.run(
    "DELETE FROM daily_visitors WHERE visit_date < ?",
    [cutoffStr],
  );

  return result.changes;
}
