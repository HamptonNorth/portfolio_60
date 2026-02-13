import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Get all holdings for an account, joined with investment details.
 * @param {number} accountId - The account ID
 * @returns {Object[]} Array of holding objects with unscaled values and investment details
 */
export function getHoldingsByAccountId(accountId) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT
        h.id,
        h.account_id,
        h.investment_id,
        h.quantity,
        h.average_cost,
        i.description AS investment_description,
        i.public_id AS investment_public_id,
        c.code AS currency_code,
        c.description AS currency_description
      FROM holdings h
      JOIN investments i ON h.investment_id = i.id
      JOIN currencies c ON i.currencies_id = c.id
      WHERE h.account_id = ?
      ORDER BY i.description`,
    )
    .all(accountId);

  return rows.map(unscaleHoldingRow);
}

/**
 * @description Get a single holding by ID with investment details.
 * @param {number} id - The holding ID
 * @returns {Object|null} The holding object, or null if not found
 */
export function getHoldingById(id) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT
        h.id,
        h.account_id,
        h.investment_id,
        h.quantity,
        h.average_cost,
        i.description AS investment_description,
        i.public_id AS investment_public_id,
        c.code AS currency_code,
        c.description AS currency_description
      FROM holdings h
      JOIN investments i ON h.investment_id = i.id
      JOIN currencies c ON i.currencies_id = c.id
      WHERE h.id = ?`,
    )
    .get(id);

  if (!row) return null;
  return unscaleHoldingRow(row);
}

/**
 * @description Create a new holding.
 * @param {Object} data - The holding data
 * @param {number} data.account_id - FK to accounts table
 * @param {number} data.investment_id - FK to investments table
 * @param {number} data.quantity - Quantity as a decimal (e.g. 661.152)
 * @param {number} data.average_cost - Average cost as a decimal (e.g. 130.40)
 * @returns {Object} The created holding with its new ID and investment details
 */
export function createHolding(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO holdings (account_id, investment_id, quantity, average_cost)
     VALUES (?, ?, ?, ?)`,
    [data.account_id, data.investment_id, scaleQuantity(data.quantity || 0), scaleQuantity(data.average_cost || 0)],
  );

  return getHoldingById(result.lastInsertRowid);
}

/**
 * @description Update an existing holding.
 * @param {number} id - The holding ID to update
 * @param {Object} data - The updated holding data
 * @param {number} data.quantity - Quantity as a decimal
 * @param {number} data.average_cost - Average cost as a decimal
 * @returns {Object|null} The updated holding, or null if not found
 */
export function updateHolding(id, data) {
  const db = getDatabase();
  const result = db.run(
    `UPDATE holdings SET quantity = ?, average_cost = ?
     WHERE id = ?`,
    [scaleQuantity(data.quantity || 0), scaleQuantity(data.average_cost || 0), id],
  );

  if (result.changes === 0) {
    return null;
  }

  return getHoldingById(id);
}

/**
 * @description Delete a holding by ID.
 * @param {number} id - The holding ID to delete
 * @returns {boolean} True if the holding was deleted, false if not found
 */
export function deleteHolding(id) {
  const db = getDatabase();
  // Delete in dependency order (no ON DELETE CASCADE in schema)
  // cash_transactions references holding_movements via holding_movement_id FK, so must go first
  db.run("DELETE FROM cash_transactions WHERE holding_movement_id IN (SELECT id FROM holding_movements WHERE holding_id = ?)", [id]);
  db.run("DELETE FROM holding_movements WHERE holding_id = ?", [id]);
  const result = db.run("DELETE FROM holdings WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Scale a quantity or average cost value for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} value - The decimal value (e.g. 661.152)
 * @returns {number} Scaled integer value
 */
export function scaleQuantity(value) {
  return Math.round(value * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored quantity or average cost value (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledValue - The scaled integer value from the database
 * @returns {number} The decimal value
 */
export function unscaleQuantity(scaledValue) {
  return scaledValue / CURRENCY_SCALE_FACTOR;
}

/**
 * @description Convert a raw database row to an object with unscaled values
 * and investment details.
 * @param {Object} row - The raw database row from the joined query
 * @returns {Object} Row with quantity and average_cost as decimals
 */
function unscaleHoldingRow(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    investment_id: row.investment_id,
    quantity: unscaleQuantity(row.quantity),
    average_cost: unscaleQuantity(row.average_cost),
    quantity_scaled: row.quantity,
    average_cost_scaled: row.average_cost,
    investment_description: row.investment_description,
    investment_public_id: row.investment_public_id,
    currency_code: row.currency_code,
    currency_description: row.currency_description,
  };
}
