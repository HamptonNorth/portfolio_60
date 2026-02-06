import { getDatabase } from "./connection.js";

/**
 * @description Record a scraping attempt in the history table.
 * @param {Object} params - The scraping history parameters
 * @param {string} params.scrapeType - 'currency', 'investment', or 'benchmark'
 * @param {number} params.referenceId - FK to the relevant table (currencies, investments, or benchmarks)
 * @param {number} [params.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [params.attemptNumber=1] - Retry attempt counter (1-5)
 * @param {boolean} params.success - Whether the scrape succeeded
 * @param {string|null} [params.errorCode=null] - HTTP status or error type
 * @param {string|null} [params.errorMessage=null] - Human-readable error description
 * @returns {number} The ID of the inserted record
 */
export function recordScrapingAttempt(params) {
  const db = getDatabase();
  const now = new Date().toISOString().replace("Z", "").split(".")[0]; // YYYY-MM-DDTHH:MM:SS

  const result = db.run(
    `INSERT INTO scraping_history
     (scrape_type, reference_id, scrape_datetime, started_by, attempt_number, success, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.scrapeType,
      params.referenceId,
      now,
      params.startedBy || 0,
      params.attemptNumber || 1,
      params.success ? 1 : 0,
      params.errorCode || null,
      params.errorMessage || null,
    ],
  );

  return result.lastInsertRowid;
}

/**
 * @description Get the most recent successful scrape datetime.
 * @returns {string|null} ISO-8601 datetime string or null if no successful scrapes
 */
export function getLastSuccessfulScrape() {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT scrape_datetime
       FROM scraping_history
       WHERE success = 1
       ORDER BY scrape_datetime DESC
       LIMIT 1`,
    )
    .get();

  return row ? row.scrape_datetime : null;
}

/**
 * @description Get the most recent successful scrape datetime for a specific type.
 * @param {string} scrapeType - 'currency', 'investment', or 'benchmark'
 * @returns {string|null} ISO-8601 datetime string or null if no successful scrapes
 */
export function getLastSuccessfulScrapeByType(scrapeType) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT scrape_datetime
       FROM scraping_history
       WHERE success = 1 AND scrape_type = ?
       ORDER BY scrape_datetime DESC
       LIMIT 1`,
    )
    .get(scrapeType);

  return row ? row.scrape_datetime : null;
}

/**
 * @description Get scraping history with optional filters.
 * @param {Object} [filters={}] - Filter options
 * @param {string} [filters.scrapeType] - Filter by type ('currency', 'investment', 'benchmark')
 * @param {boolean} [filters.success] - Filter by success status
 * @param {string} [filters.startDate] - Filter by start date (inclusive, YYYY-MM-DD)
 * @param {string} [filters.endDate] - Filter by end date (inclusive, YYYY-MM-DD)
 * @param {number} [filters.limit=100] - Maximum records to return
 * @param {number} [filters.offset=0] - Number of records to skip
 * @returns {Object[]} Array of scraping history records
 */
export function getScrapingHistory(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (filters.scrapeType) {
    conditions.push("scrape_type = ?");
    params.push(filters.scrapeType);
  }

  if (filters.success !== undefined) {
    conditions.push("success = ?");
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    conditions.push("scrape_datetime >= ?");
    params.push(filters.startDate + "T00:00:00");
  }

  if (filters.endDate) {
    conditions.push("scrape_datetime <= ?");
    params.push(filters.endDate + "T23:59:59");
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  params.push(limit, offset);

  const rows = db
    .query(
      `SELECT id, scrape_type, reference_id, scrape_datetime, started_by, attempt_number, success, error_code, error_message
       FROM scraping_history
       ${whereClause}
       ORDER BY scrape_datetime DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params);

  return rows.map(function (row) {
    return {
      id: row.id,
      scrape_type: row.scrape_type,
      reference_id: row.reference_id,
      scrape_datetime: row.scrape_datetime,
      started_by: row.started_by,
      attempt_number: row.attempt_number,
      success: row.success === 1,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  });
}

/**
 * @description Get the total count of scraping history records matching filters.
 * Used for pagination.
 * @param {Object} [filters={}] - Filter options (same as getScrapingHistory, excluding limit/offset)
 * @returns {number} Total count of matching records
 */
export function getScrapingHistoryCount(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (filters.scrapeType) {
    conditions.push("scrape_type = ?");
    params.push(filters.scrapeType);
  }

  if (filters.success !== undefined) {
    conditions.push("success = ?");
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    conditions.push("scrape_datetime >= ?");
    params.push(filters.startDate + "T00:00:00");
  }

  if (filters.endDate) {
    conditions.push("scrape_datetime <= ?");
    params.push(filters.endDate + "T23:59:59");
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const row = db.query(`SELECT COUNT(*) as count FROM scraping_history ${whereClause}`).get(...params);

  return row ? row.count : 0;
}

/**
 * @description Get scraping history with joined reference descriptions.
 * This is more useful for display as it includes the actual item names.
 * @param {Object} [filters={}] - Filter options (same as getScrapingHistory)
 * @returns {Object[]} Array of scraping history records with reference_description
 */
export function getScrapingHistoryWithDescriptions(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (filters.scrapeType) {
    conditions.push("h.scrape_type = ?");
    params.push(filters.scrapeType);
  }

  if (filters.success !== undefined) {
    conditions.push("h.success = ?");
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    conditions.push("h.scrape_datetime >= ?");
    params.push(filters.startDate + "T00:00:00");
  }

  if (filters.endDate) {
    conditions.push("h.scrape_datetime <= ?");
    params.push(filters.endDate + "T23:59:59");
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  params.push(limit, offset);

  // Use CASE to join to the appropriate table based on scrape_type
  const rows = db
    .query(
      `SELECT
         h.id,
         h.scrape_type,
         h.reference_id,
         h.scrape_datetime,
         h.started_by,
         h.attempt_number,
         h.success,
         h.error_code,
         h.error_message,
         CASE h.scrape_type
           WHEN 'currency' THEN c.code || ' - ' || c.description
           WHEN 'investment' THEN i.description
           WHEN 'benchmark' THEN b.description
           ELSE 'Unknown'
         END as reference_description
       FROM scraping_history h
       LEFT JOIN currencies c ON h.scrape_type = 'currency' AND h.reference_id = c.id
       LEFT JOIN investments i ON h.scrape_type = 'investment' AND h.reference_id = i.id
       LEFT JOIN benchmarks b ON h.scrape_type = 'benchmark' AND h.reference_id = b.id
       ${whereClause}
       ORDER BY h.scrape_datetime DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params);

  return rows.map(function (row) {
    return {
      id: row.id,
      scrape_type: row.scrape_type,
      reference_id: row.reference_id,
      reference_description: row.reference_description || "Unknown",
      scrape_datetime: row.scrape_datetime,
      started_by: row.started_by,
      attempt_number: row.attempt_number,
      success: row.success === 1,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  });
}
