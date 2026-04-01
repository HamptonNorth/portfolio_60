import { getDatabase } from "./connection.js";

/**
 * @description Record a fetch attempt in the history table.
 * @param {Object} params - The fetch history parameters
 * @param {string} params.fetchType - 'currency', 'investment', or 'benchmark'
 * @param {number} params.referenceId - FK to the relevant table (currencies, investments, or benchmarks)
 * @param {number} [params.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [params.attemptNumber=1] - The attempt at which the outcome was determined
 * @param {number} [params.maxAttempts=1] - Total attempts available for this fetch run
 * @param {boolean} params.success - Whether the fetch succeeded
 * @param {string|null} [params.errorCode=null] - HTTP status or error type
 * @param {string|null} [params.errorMessage=null] - Human-readable error description
 * @returns {number} The ID of the inserted record
 */
export function recordFetchAttempt(params) {
  const db = getDatabase();
  const now = new Date().toISOString().replace("Z", "").split(".")[0]; // YYYY-MM-DDTHH:MM:SS

  const result = db.run(
    `INSERT INTO fetch_history
     (fetch_type, reference_id, fetch_datetime, started_by, attempt_number, max_attempts, success, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.fetchType, params.referenceId, now, params.startedBy || 0, params.attemptNumber || 1, params.maxAttempts || 1, params.success ? 1 : 0, params.errorCode || null, params.errorMessage || null],
  );

  return result.lastInsertRowid;
}

/**
 * @description Get the most recent successful fetch datetime.
 * @returns {string|null} ISO-8601 datetime string or null if no successful fetches
 */
export function getLastSuccessfulFetch() {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT fetch_datetime
       FROM fetch_history
       WHERE success = 1
       ORDER BY fetch_datetime DESC, id DESC
       LIMIT 1`,
    )
    .get();

  return row ? row.fetch_datetime : null;
}

/**
 * @description Get the most recent successful fetch datetime for a specific type.
 * @param {string} fetchType - 'currency', 'investment', or 'benchmark'
 * @returns {string|null} ISO-8601 datetime string or null if no successful fetches
 */
export function getLastSuccessfulFetchByType(fetchType) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT fetch_datetime
       FROM fetch_history
       WHERE success = 1 AND fetch_type = ?
       ORDER BY fetch_datetime DESC, id DESC
       LIMIT 1`,
    )
    .get(fetchType);

  return row ? row.fetch_datetime : null;
}

/**
 * @description Get fetch history with optional filters.
 * @param {Object} [filters={}] - Filter options
 * @param {string} [filters.fetchType] - Filter by type ('currency', 'investment', 'benchmark')
 * @param {boolean} [filters.success] - Filter by success status
 * @param {string} [filters.startDate] - Filter by start date (inclusive, YYYY-MM-DD)
 * @param {string} [filters.endDate] - Filter by end date (inclusive, YYYY-MM-DD)
 * @param {number} [filters.limit=100] - Maximum records to return
 * @param {number} [filters.offset=0] - Number of records to skip
 * @returns {Object[]} Array of fetch history records
 */
export function getFetchHistory(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (filters.fetchType) {
    conditions.push("fetch_type = ?");
    params.push(filters.fetchType);
  }

  if (filters.success !== undefined) {
    conditions.push("success = ?");
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    conditions.push("fetch_datetime >= ?");
    params.push(filters.startDate + "T00:00:00");
  }

  if (filters.endDate) {
    conditions.push("fetch_datetime <= ?");
    params.push(filters.endDate + "T23:59:59");
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  params.push(limit, offset);

  const rows = db
    .query(
      `SELECT id, fetch_type, reference_id, fetch_datetime, started_by, attempt_number, max_attempts, success, error_code, error_message
       FROM fetch_history
       ${whereClause}
       ORDER BY fetch_datetime DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params);

  return rows.map(function (row) {
    return {
      id: row.id,
      fetch_type: row.fetch_type,
      reference_id: row.reference_id,
      fetch_datetime: row.fetch_datetime,
      started_by: row.started_by,
      attempt_number: row.attempt_number,
      max_attempts: row.max_attempts,
      success: row.success === 1,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  });
}

/**
 * @description Get the total count of fetch history records matching filters.
 * Used for pagination.
 * @param {Object} [filters={}] - Filter options (same as getFetchHistory, excluding limit/offset)
 * @returns {number} Total count of matching records
 */
export function getFetchHistoryCount(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];
  let joinClause = "";

  if (filters.fetchType) {
    conditions.push("h.fetch_type = ?");
    params.push(filters.fetchType);
  }

  if (filters.success !== undefined) {
    conditions.push("h.success = ?");
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    conditions.push("h.fetch_datetime >= ?");
    params.push(filters.startDate + "T00:00:00");
  }

  if (filters.endDate) {
    conditions.push("h.fetch_datetime <= ?");
    params.push(filters.endDate + "T23:59:59");
  }

  // Filter by auto_fetch status on investments. Requires a JOIN to investments.
  if (filters.autoFetchOnly !== undefined) {
    joinClause = " JOIN investments i ON h.fetch_type = 'investment' AND h.reference_id = i.id";
    conditions.push("h.fetch_type = 'investment'");
    conditions.push("i.auto_fetch = ?");
    params.push(filters.autoFetchOnly ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const row = db.query(`SELECT COUNT(*) as count FROM fetch_history h${joinClause} ${whereClause}`).get(...params);

  return row ? row.count : 0;
}

/**
 * @description Get fetch history with joined reference descriptions.
 * This is more useful for display as it includes the actual item names.
 * @param {Object} [filters={}] - Filter options (same as getFetchHistory)
 * @returns {Object[]} Array of fetch history records with reference_description
 */
export function getFetchHistoryWithDescriptions(filters = {}) {
  const db = getDatabase();
  const conditions = [];
  const params = [];

  if (filters.fetchType) {
    conditions.push("h.fetch_type = ?");
    params.push(filters.fetchType);
  }

  if (filters.success !== undefined) {
    conditions.push("h.success = ?");
    params.push(filters.success ? 1 : 0);
  }

  if (filters.startDate) {
    conditions.push("h.fetch_datetime >= ?");
    params.push(filters.startDate + "T00:00:00");
  }

  if (filters.endDate) {
    conditions.push("h.fetch_datetime <= ?");
    params.push(filters.endDate + "T23:59:59");
  }

  // Filter by auto_fetch status on investments. When set, this implicitly
  // restricts results to investment-type history entries only.
  if (filters.autoFetchOnly !== undefined) {
    conditions.push("h.fetch_type = 'investment'");
    conditions.push("i.auto_fetch = ?");
    params.push(filters.autoFetchOnly ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  params.push(limit, offset);

  // Use CASE to join to the appropriate table based on fetch_type
  const rows = db
    .query(
      `SELECT
         h.id,
         h.fetch_type,
         h.reference_id,
         h.fetch_datetime,
         h.started_by,
         h.attempt_number,
         h.max_attempts,
         h.success,
         h.error_code,
         h.error_message,
         CASE h.fetch_type
           WHEN 'currency' THEN c.code || ' - ' || c.description
           WHEN 'investment' THEN i.description
           WHEN 'benchmark' THEN b.description
           ELSE 'Unknown'
         END as reference_description
       FROM fetch_history h
       LEFT JOIN currencies c ON h.fetch_type = 'currency' AND h.reference_id = c.id
       LEFT JOIN investments i ON h.fetch_type = 'investment' AND h.reference_id = i.id
       LEFT JOIN benchmarks b ON h.fetch_type = 'benchmark' AND h.reference_id = b.id
       ${whereClause}
       ORDER BY h.fetch_datetime DESC, h.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params);

  return rows.map(function (row) {
    return {
      id: row.id,
      fetch_type: row.fetch_type,
      reference_id: row.reference_id,
      reference_description: row.reference_description || "Unknown",
      fetch_datetime: row.fetch_datetime,
      started_by: row.started_by,
      attempt_number: row.attempt_number,
      max_attempts: row.max_attempts,
      success: row.success === 1,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  });
}

/**
 * @description Get items whose most recent fetch history record is a failure.
 * Only returns investment and benchmark failures (currencies have no retry mechanism).
 * Joins to investments/benchmarks tables for human-readable descriptions.
 * @returns {Object[]} Array of objects with fetch_type, reference_id, description,
 *   fetch_datetime, error_code, and error_message
 */
export function getLatestFailures() {
  const db = getDatabase();

  const rows = db
    .query(
      `SELECT h.fetch_type, h.reference_id, h.fetch_datetime, h.error_code, h.error_message,
              CASE h.fetch_type
                WHEN 'investment' THEN i.description
                WHEN 'benchmark' THEN b.description
              END as description
       FROM fetch_history h
       LEFT JOIN investments i ON h.fetch_type = 'investment' AND h.reference_id = i.id
       LEFT JOIN benchmarks b ON h.fetch_type = 'benchmark' AND h.reference_id = b.id
       WHERE h.success = 0
         AND h.fetch_type IN ('investment', 'benchmark')
         AND h.id = (
           SELECT h2.id FROM fetch_history h2
           WHERE h2.fetch_type = h.fetch_type AND h2.reference_id = h.reference_id
           ORDER BY h2.fetch_datetime DESC, h2.id DESC LIMIT 1
         )
         AND CASE h.fetch_type
               WHEN 'investment' THEN i.id IS NOT NULL
               WHEN 'benchmark' THEN b.id IS NOT NULL
             END
       ORDER BY h.fetch_type, h.reference_id`,
    )
    .all();

  return rows;
}
