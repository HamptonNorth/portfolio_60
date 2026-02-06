import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Store or update a value for a benchmark on a given date.
 * Uses INSERT OR REPLACE to overwrite any existing value for the same
 * benchmark and date combination.
 * @param {number} benchmarkId - FK to benchmarks table
 * @param {string} benchmarkDate - ISO-8601 date (YYYY-MM-DD)
 * @param {string} benchmarkTime - Time string (HH:MM:SS)
 * @param {number} value - Benchmark value (index points or price), will be scaled by 10000
 */
export function upsertBenchmarkData(benchmarkId, benchmarkDate, benchmarkTime, value) {
  const db = getDatabase();
  // Value is stored as integer × 10000 for precision
  const scaledValue = Math.round(value * CURRENCY_SCALE_FACTOR);

  db.run(
    `INSERT OR REPLACE INTO benchmark_data (benchmark_id, benchmark_date, benchmark_time, value)
     VALUES (?, ?, ?, ?)`,
    [benchmarkId, benchmarkDate, benchmarkTime, scaledValue],
  );
}

/**
 * @description Get the latest value for a benchmark.
 * @param {number} benchmarkId - The benchmark ID
 * @returns {Object|null} Benchmark data record with unscaled value, or null if no data exists
 */
export function getLatestBenchmarkData(benchmarkId) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, benchmark_id, benchmark_date, benchmark_time, value
       FROM benchmark_data
       WHERE benchmark_id = ?
       ORDER BY benchmark_date DESC
       LIMIT 1`,
    )
    .get(benchmarkId);

  if (!row) return null;

  return {
    id: row.id,
    benchmark_id: row.benchmark_id,
    benchmark_date: row.benchmark_date,
    benchmark_time: row.benchmark_time,
    value: row.value / CURRENCY_SCALE_FACTOR, // Unscale for display
    value_scaled: row.value, // Raw scaled value
  };
}

/**
 * @description Get all values for a benchmark, ordered by date descending.
 * @param {number} benchmarkId - The benchmark ID
 * @param {number} [limit=100] - Maximum number of records to return
 * @returns {Object[]} Array of benchmark data records with unscaled values
 */
export function getBenchmarkDataHistory(benchmarkId, limit = 100) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, benchmark_id, benchmark_date, benchmark_time, value
       FROM benchmark_data
       WHERE benchmark_id = ?
       ORDER BY benchmark_date DESC
       LIMIT ?`,
    )
    .all(benchmarkId, limit);

  return rows.map(function (row) {
    return {
      id: row.id,
      benchmark_id: row.benchmark_id,
      benchmark_date: row.benchmark_date,
      benchmark_time: row.benchmark_time,
      value: row.value / CURRENCY_SCALE_FACTOR,
      value_scaled: row.value,
    };
  });
}

/**
 * @description Get benchmark value on a specific date.
 * @param {number} benchmarkId - The benchmark ID
 * @param {string} benchmarkDate - ISO-8601 date (YYYY-MM-DD)
 * @returns {Object|null} Benchmark data record or null if not found
 */
export function getBenchmarkDataByDate(benchmarkId, benchmarkDate) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, benchmark_id, benchmark_date, benchmark_time, value
       FROM benchmark_data
       WHERE benchmark_id = ? AND benchmark_date = ?`,
    )
    .get(benchmarkId, benchmarkDate);

  if (!row) return null;

  return {
    id: row.id,
    benchmark_id: row.benchmark_id,
    benchmark_date: row.benchmark_date,
    benchmark_time: row.benchmark_time,
    value: row.value / CURRENCY_SCALE_FACTOR,
    value_scaled: row.value,
  };
}

/**
 * @description Scale a benchmark value for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} value - The benchmark value
 * @returns {number} Scaled integer value
 */
export function scaleBenchmarkValue(value) {
  return Math.round(value * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored benchmark value (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledValue - The scaled integer value from the database
 * @returns {number} The original benchmark value
 */
export function unscaleBenchmarkValue(scaledValue) {
  return scaledValue / CURRENCY_SCALE_FACTOR;
}
