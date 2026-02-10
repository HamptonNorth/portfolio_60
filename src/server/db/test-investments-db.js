import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDatabase } from "./connection.js";

/**
 * @description Get all test investments with their currency and investment type details,
 * ordered by description.
 * @returns {Object[]} Array of test investment objects with joined currency/type fields
 */
export function getAllTestInvestments() {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        ti.id,
        ti.currencies_id,
        ti.investment_type_id,
        ti.description,
        ti.public_id,
        ti.investment_url,
        ti.selector,
        ti.source_site,
        ti.notes,
        ti.last_test_date,
        ti.last_test_success,
        ti.last_test_price,
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description
      FROM test_investments ti
      JOIN currencies c ON ti.currencies_id = c.id
      JOIN investment_types it ON ti.investment_type_id = it.id
      ORDER BY ti.description`,
    )
    .all();
}

/**
 * @description Get a single test investment by ID with joined currency and type details.
 * @param {number} id - The test investment ID
 * @returns {Object|null} The test investment object with joined fields, or null if not found
 */
export function getTestInvestmentById(id) {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        ti.id,
        ti.currencies_id,
        ti.investment_type_id,
        ti.description,
        ti.public_id,
        ti.investment_url,
        ti.selector,
        ti.source_site,
        ti.notes,
        ti.last_test_date,
        ti.last_test_success,
        ti.last_test_price,
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description
      FROM test_investments ti
      JOIN currencies c ON ti.currencies_id = c.id
      JOIN investment_types it ON ti.investment_type_id = it.id
      WHERE ti.id = ?`,
    )
    .get(id);
}

/**
 * @description Create a new test investment.
 * @param {Object} data - The test investment data
 * @param {number} data.currencies_id - FK to currencies table
 * @param {number} data.investment_type_id - FK to investment_types table
 * @param {string} data.description - Description (max 60 chars)
 * @param {string|null} [data.public_id] - ISIN or exchange:ticker (max 20 chars)
 * @param {string|null} [data.investment_url] - URL for price scraping (max 255 chars)
 * @param {string|null} [data.selector] - CSS selector (max 255 chars)
 * @param {string|null} [data.source_site] - Which pricing source this tests (max 60 chars)
 * @param {string|null} [data.notes] - Free text notes (max 255 chars)
 * @returns {Object} The created test investment with its new ID and joined fields
 */
export function createTestInvestment(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, investment_url, selector, source_site, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.currencies_id, data.investment_type_id, data.description, data.public_id || null, data.investment_url || null, data.selector || null, data.source_site || null, data.notes || null],
  );

  return getTestInvestmentById(result.lastInsertRowid);
}

/**
 * @description Update an existing test investment.
 * @param {number} id - The test investment ID to update
 * @param {Object} data - The updated test investment data (same fields as createTestInvestment)
 * @returns {Object|null} The updated test investment with joined fields, or null if not found
 */
export function updateTestInvestment(id, data) {
  const db = getDatabase();
  const result = db.run(
    `UPDATE test_investments SET
       currencies_id = ?, investment_type_id = ?, description = ?,
       public_id = ?, investment_url = ?, selector = ?,
       source_site = ?, notes = ?
     WHERE id = ?`,
    [data.currencies_id, data.investment_type_id, data.description, data.public_id || null, data.investment_url || null, data.selector || null, data.source_site || null, data.notes || null, id],
  );

  if (result.changes === 0) {
    return null;
  }

  return getTestInvestmentById(id);
}

/**
 * @description Delete a test investment by ID. Cascade-deletes associated test_prices rows.
 * @param {number} id - The test investment ID to delete
 * @returns {boolean} True if the test investment was deleted, false if not found
 */
export function deleteTestInvestment(id) {
  const db = getDatabase();
  const result = db.run("DELETE FROM test_investments WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Update only the scraping source fields (investment_url and selector)
 * on a test investment. Used by the Fidelity fallback to write back the discovered
 * factsheet URL without requiring a full record update.
 * @param {number} id - The test investment ID to update
 * @param {string|null} url - The new investment_url value
 * @param {string|null} selector - The new selector value (null if config provides it)
 * @returns {boolean} True if the test investment was updated, false if not found
 */
export function updateTestInvestmentScrapingSource(id, url, selector) {
  const db = getDatabase();
  const result = db.run("UPDATE test_investments SET investment_url = ?, selector = ? WHERE id = ?", [url || null, selector || null, id]);
  return result.changes > 0;
}

/**
 * @description Update the last test result fields on a test investment.
 * Called after scraping to record the outcome.
 * @param {number} id - The test investment ID
 * @param {string} date - ISO-8601 date of the test (YYYY-MM-DD)
 * @param {boolean} success - Whether the test scrape succeeded
 * @param {string|null} price - The formatted price string (for display), or null on failure
 */
export function updateTestResult(id, date, success, price) {
  const db = getDatabase();
  db.run(
    `UPDATE test_investments SET
       last_test_date = ?, last_test_success = ?, last_test_price = ?
     WHERE id = ?`,
    [date, success ? 1 : 0, price, id],
  );
}

/**
 * @description Get the N test investments with the oldest last_test_date,
 * prioritising those that have never been tested (NULL last_test_date).
 * Only returns investments that have a URL or public_id configured.
 * @param {number} [limit=20] - Maximum number of investments to return
 * @returns {Object[]} Array of test investment objects with joined currency/type fields
 */
export function getStalestTestInvestments(limit = 20) {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        ti.id,
        ti.currencies_id,
        ti.investment_type_id,
        ti.description,
        ti.public_id,
        ti.investment_url,
        ti.selector,
        ti.source_site,
        ti.notes,
        ti.last_test_date,
        ti.last_test_success,
        ti.last_test_price,
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description
      FROM test_investments ti
      JOIN currencies c ON ti.currencies_id = c.id
      JOIN investment_types it ON ti.investment_type_id = it.id
      WHERE ti.investment_url IS NOT NULL OR ti.public_id IS NOT NULL
      ORDER BY ti.last_test_date ASC NULLS FIRST, ti.id ASC
      LIMIT ?`,
    )
    .all(limit);
}

/**
 * @description Reset all test data by executing the seed SQL script.
 * Clears scraping_history (started_by=3), test_prices, and test_investments,
 * then re-inserts the standard test data set plus a copy of live investments.
 * @returns {{ totalCount: number, hardCodedCount: number, liveCopiedCount: number }}
 */
export function resetTestInvestments() {
  const db = getDatabase();
  const seedPath = resolve("src/server/db/seed-test-investments.sql");
  const seedSql = readFileSync(seedPath, "utf-8");

  db.exec(seedSql);

  const totalCount = db.query("SELECT COUNT(*) as count FROM test_investments").get().count;
  const liveCopiedCount = db.query("SELECT COUNT(*) as count FROM test_investments WHERE source_site = 'Live Portfolio'").get().count;
  const hardCodedCount = totalCount - liveCopiedCount;

  return { totalCount, hardCodedCount, liveCopiedCount };
}
