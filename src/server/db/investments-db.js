import { getDatabase } from "./connection.js";

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
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description
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
 * @description Delete an investment by ID.
 * @param {number} id - The investment ID to delete
 * @returns {boolean} True if the investment was deleted, false if not found
 */
export function deleteInvestment(id) {
  const db = getDatabase();
  db.run("DELETE FROM prices WHERE investment_id = ?", [id]);
  const result = db.run("DELETE FROM investments WHERE id = ?", [id]);
  return result.changes > 0;
}
