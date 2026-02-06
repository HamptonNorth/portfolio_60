import { getDatabase } from "./connection.js";

/**
 * @description Get all benchmarks with their currency details, ordered by description.
 * @returns {Object[]} Array of benchmark objects with joined currency fields
 */
export function getAllBenchmarks() {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        b.id,
        b.currencies_id,
        b.benchmark_type,
        b.description,
        b.benchmark_url,
        b.selector,
        c.code AS currency_code,
        c.description AS currency_description
      FROM benchmarks b
      JOIN currencies c ON b.currencies_id = c.id
      ORDER BY b.description`,
    )
    .all();
}

/**
 * @description Get a single benchmark by ID with joined currency details.
 * @param {number} id - The benchmark ID
 * @returns {Object|null} The benchmark object with joined fields, or null if not found
 */
export function getBenchmarkById(id) {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        b.id,
        b.currencies_id,
        b.benchmark_type,
        b.description,
        b.benchmark_url,
        b.selector,
        c.code AS currency_code,
        c.description AS currency_description
      FROM benchmarks b
      JOIN currencies c ON b.currencies_id = c.id
      WHERE b.id = ?`,
    )
    .get(id);
}

/**
 * @description Create a new benchmark.
 * @param {Object} data - The benchmark data
 * @param {number} data.currencies_id - FK to currencies table
 * @param {string} data.benchmark_type - Either 'index' or 'price'
 * @param {string} data.description - Benchmark description (max 60 chars)
 * @param {string|null} data.benchmark_url - URL for value scraping (max 255 chars)
 * @param {string|null} data.selector - CSS selector for value element (max 255 chars)
 * @returns {Object} The created benchmark with its new ID and joined fields
 */
export function createBenchmark(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO benchmarks (currencies_id, benchmark_type, description, benchmark_url, selector)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.currencies_id,
      data.benchmark_type,
      data.description,
      data.benchmark_url || null,
      data.selector || null,
    ],
  );

  return getBenchmarkById(result.lastInsertRowid);
}

/**
 * @description Update an existing benchmark.
 * @param {number} id - The benchmark ID to update
 * @param {Object} data - The updated benchmark data (same fields as createBenchmark)
 * @returns {Object|null} The updated benchmark with joined fields, or null if not found
 */
export function updateBenchmark(id, data) {
  const db = getDatabase();
  const result = db.run(
    `UPDATE benchmarks SET
       currencies_id = ?, benchmark_type = ?, description = ?,
       benchmark_url = ?, selector = ?
     WHERE id = ?`,
    [
      data.currencies_id,
      data.benchmark_type,
      data.description,
      data.benchmark_url || null,
      data.selector || null,
      id,
    ],
  );

  if (result.changes === 0) {
    return null;
  }

  return getBenchmarkById(id);
}

/**
 * @description Delete a benchmark by ID.
 * @param {number} id - The benchmark ID to delete
 * @returns {{deleted: boolean, reason?: string}} Result object indicating success or failure reason
 */
export function deleteBenchmark(id) {
  const db = getDatabase();

  // Check if benchmark exists first
  const benchmark = db.query("SELECT id FROM benchmarks WHERE id = ?").get(id);
  if (!benchmark) {
    return { deleted: false, reason: "Benchmark not found" };
  }

  // Future-proofing: check for usage in benchmark_data table when it exists
  // For now, no referential integrity checks needed

  const result = db.run("DELETE FROM benchmarks WHERE id = ?", [id]);
  return { deleted: result.changes > 0 };
}

/**
 * @description Get the GBP currency ID for index benchmark validation.
 * @returns {number|null} The GBP currency ID, or null if GBP doesn't exist
 */
export function getGbpCurrencyId() {
  const db = getDatabase();
  const gbp = db.query("SELECT id FROM currencies WHERE code = 'GBP'").get();
  return gbp ? gbp.id : null;
}
