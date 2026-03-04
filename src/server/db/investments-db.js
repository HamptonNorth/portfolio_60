import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/server-constants.js";

/**
 * @description Get all investments with their currency and investment type details,
 * ordered by description.
 * @returns {Object[]} Array of investment objects with joined currency/type fields
 */
export function getAllInvestments() {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        i.id,
        i.currencies_id,
        i.investment_type_id,
        i.description,
        i.public_id,
        i.investment_url,
        i.selector,
        i.auto_scrape,
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description,
        (SELECT MIN(p.price_date) FROM prices p WHERE p.investment_id = i.id) AS oldest_price_date
      FROM investments i
      JOIN currencies c ON i.currencies_id = c.id
      JOIN investment_types it ON i.investment_type_id = it.id
      ORDER BY i.description`,
    )
    .all();
}

/**
 * @description Get a single investment by ID with joined currency and type details.
 * @param {number} id - The investment ID
 * @returns {Object|null} The investment object with joined fields, or null if not found
 */
export function getInvestmentById(id) {
  const db = getDatabase();
  return db
    .query(
      `SELECT
        i.id,
        i.currencies_id,
        i.investment_type_id,
        i.description,
        i.public_id,
        i.investment_url,
        i.selector,
        i.auto_scrape,
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description
      FROM investments i
      JOIN currencies c ON i.currencies_id = c.id
      JOIN investment_types it ON i.investment_type_id = it.id
      WHERE i.id = ?`,
    )
    .get(id);
}

/**
 * @description Create a new investment.
 * @param {Object} data - The investment data
 * @param {number} data.currencies_id - FK to currencies table
 * @param {number} data.investment_type_id - FK to investment_types table
 * @param {string} data.description - Investment description (max 60 chars)
 * @param {string|null} data.investment_url - URL for price scraping (max 255 chars)
 * @param {string|null} data.selector - CSS selector for price element (max 255 chars)
 * @returns {Object} The created investment with its new ID and joined fields
 */
export function createInvestment(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO investments (currencies_id, investment_type_id, description, public_id, investment_url, selector)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.currencies_id, data.investment_type_id, data.description, data.public_id || null, data.investment_url || null, data.selector || null],
  );

  return getInvestmentById(result.lastInsertRowid);
}

/**
 * @description Update an existing investment.
 * @param {number} id - The investment ID to update
 * @param {Object} data - The updated investment data (same fields as createInvestment)
 * @returns {Object|null} The updated investment with joined fields, or null if not found
 */
export function updateInvestment(id, data) {
  const db = getDatabase();
  const result = db.run(
    `UPDATE investments SET
       currencies_id = ?, investment_type_id = ?, description = ?,
       public_id = ?, investment_url = ?, selector = ?
     WHERE id = ?`,
    [data.currencies_id, data.investment_type_id, data.description, data.public_id || null, data.investment_url || null, data.selector || null, id],
  );

  if (result.changes === 0) {
    return null;
  }

  return getInvestmentById(id);
}

/**
 * @description Update only the scraping source fields (investment_url and selector)
 * on an investment. Used by the Fidelity fallback to write back the discovered
 * factsheet URL without requiring a full record update.
 * @param {number} id - The investment ID to update
 * @param {string|null} url - The new investment_url value
 * @param {string|null} selector - The new selector value (null if config provides it)
 * @returns {boolean} True if the investment was updated, false if not found
 */
export function updateInvestmentScrapingSource(id, url, selector) {
  const db = getDatabase();
  const result = db.run("UPDATE investments SET investment_url = ?, selector = ? WHERE id = ?", [url || null, selector || null, id]);
  return result.changes > 0;
}

/**
 * @description Check if an investment is held in any account.
 * @param {number} id - The investment ID to check
 * @returns {Object|null} Null if not held, or an object with holding count if in use
 */
export function getInvestmentUsage(id) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT COUNT(*) AS holding_count
     FROM holdings
     WHERE investment_id = ?`,
    )
    .get(id);

  if (row.holding_count === 0) return null;
  return { holdingCount: row.holding_count };
}

/**
 * @description Delete an investment by ID. Also deletes associated price history.
 * Throws an error if the investment is currently held in any account.
 * @param {number} id - The investment ID to delete
 * @returns {boolean} True if the investment was deleted, false if not found
 * @throws {Error} If the investment is referenced by holdings
 */
export function deleteInvestment(id) {
  const db = getDatabase();

  const usage = getInvestmentUsage(id);
  if (usage) {
    const s = usage.holdingCount === 1 ? "" : "s";
    throw new Error("Cannot delete: this investment is held in " + usage.holdingCount + " account" + s);
  }

  db.run("DELETE FROM prices WHERE investment_id = ?", [id]);
  const result = db.run("DELETE FROM investments WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Update the auto_scrape flag on an investment.
 * When set to 0, the investment is excluded from automatic price fetching.
 * @param {number} id - The investment ID
 * @param {boolean} autoScrape - True to enable auto-scrape, false to disable
 * @returns {Object|null} The updated investment, or null if not found
 */
export function updateAutoScrape(id, autoScrape) {
  const db = getDatabase();
  const value = autoScrape ? 1 : 0;
  const result = db.run("UPDATE investments SET auto_scrape = ? WHERE id = ?", [value, id]);

  if (result.changes === 0) {
    return null;
  }

  return getInvestmentById(id);
}

/**
 * @description Get all manually-priced investments (auto_scrape = 0) with their
 * latest price date and how the last price was obtained.
 * Used by the home page alert table to show investments that need manual price updates.
 * @returns {Object[]} Array of investment objects with price and history details
 */
export function getManuallyPricedInvestments() {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT
        i.id,
        i.description,
        it.description AS type_description,
        c.code AS currency_code,
        i.public_id,
        p.price_date AS last_price_date,
        p.price AS last_price,
        sh.started_by AS how_priced
      FROM investments i
      JOIN investment_types it ON i.investment_type_id = it.id
      JOIN currencies c ON i.currencies_id = c.id
      LEFT JOIN prices p ON p.investment_id = i.id
        AND p.price_date = (
          SELECT MAX(p2.price_date) FROM prices p2 WHERE p2.investment_id = i.id
        )
      LEFT JOIN scraping_history sh ON sh.reference_id = i.id
        AND sh.scrape_type = 'investment'
        AND sh.success = 1
        AND sh.id = (
          SELECT MAX(sh2.id) FROM scraping_history sh2
          WHERE sh2.reference_id = i.id
          AND sh2.scrape_type = 'investment'
          AND sh2.success = 1
        )
      WHERE i.auto_scrape = 0
      ORDER BY i.description`,
    )
    .all();

  return rows.map(function (row) {
    return {
      id: row.id,
      description: row.description,
      type_description: row.type_description,
      currency_code: row.currency_code,
      public_id: row.public_id,
      last_price_date: row.last_price_date || null,
      last_price: row.last_price !== null ? row.last_price / CURRENCY_SCALE_FACTOR : null,
      how_priced: row.how_priced !== null ? row.how_priced : null,
    };
  });
}
