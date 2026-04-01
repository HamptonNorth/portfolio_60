import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/server-constants.js";

/**
 * @description Get the current date as ISO-8601 string (YYYY-MM-DD).
 * @returns {string} Today's date
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @description Get all active holdings for an account, joined with investment details.
 * Only returns current (non-closed) holdings where effective_to IS NULL.
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
        h.effective_from,
        h.effective_to,
        i.description AS investment_description,
        i.public_id AS investment_public_id,
        i.morningstar_id AS investment_morningstar_id,
        c.code AS currency_code,
        c.description AS currency_description
      FROM holdings h
      JOIN investments i ON h.investment_id = i.id
      JOIN currencies c ON i.currencies_id = c.id
      WHERE h.account_id = ? AND h.effective_to IS NULL
      ORDER BY i.description`,
    )
    .all(accountId);

  return rows.map(unscaleHoldingRow);
}

/**
 * @description Get holdings for an account that were active on a specific date.
 * Uses inclusive-exclusive date range semantics:
 * effective_from <= date AND (effective_to IS NULL OR effective_to > date)
 * @param {number} accountId - The account ID
 * @param {string} date - ISO-8601 date (YYYY-MM-DD)
 * @returns {Object[]} Array of holding objects active on that date
 */
export function getHoldingsAtDate(accountId, date) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT
        h.id,
        h.account_id,
        h.investment_id,
        h.quantity,
        h.average_cost,
        h.effective_from,
        h.effective_to,
        i.description AS investment_description,
        i.public_id AS investment_public_id,
        i.morningstar_id AS investment_morningstar_id,
        c.code AS currency_code,
        c.description AS currency_description
      FROM holdings h
      JOIN investments i ON h.investment_id = i.id
      JOIN currencies c ON i.currencies_id = c.id
      WHERE h.account_id = ?
        AND h.effective_from <= ?
        AND (h.effective_to IS NULL OR h.effective_to > ?)
      ORDER BY i.description`,
    )
    .all(accountId, date, date);

  return rows.map(unscaleHoldingRow);
}

/**
 * @description Get a single holding by ID with investment details.
 * Returns both active and historical (closed) holdings.
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
        h.effective_from,
        h.effective_to,
        i.description AS investment_description,
        i.public_id AS investment_public_id,
        i.morningstar_id AS investment_morningstar_id,
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
 * @description Get the active (non-closed) holding for an account and investment.
 * Returns null if no active holding exists.
 * @param {number} accountId - The account ID
 * @param {number} investmentId - The investment ID
 * @returns {Object|null} The active holding row (raw/scaled), or null
 */
export function getActiveHoldingRaw(accountId, investmentId) {
  const db = getDatabase();
  return db
    .query(
      `SELECT id, account_id, investment_id, quantity, average_cost, effective_from, effective_to
       FROM holdings
       WHERE account_id = ? AND investment_id = ? AND effective_to IS NULL`,
    )
    .get(accountId, investmentId);
}

/**
 * @description Create a new holding with effective_from set to today.
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
    `INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
     VALUES (?, ?, ?, ?, ?)`,
    [data.account_id, data.investment_id, scaleQuantity(data.quantity || 0), scaleQuantity(data.average_cost || 0), today()],
  );

  return getHoldingById(result.lastInsertRowid);
}

/**
 * @description Update a holding using SCD2: close the current row and create
 * a new row with the updated values and effective_from = today.
 * @param {number} id - The holding ID to update
 * @param {Object} data - The updated holding data
 * @param {number} data.quantity - Quantity as a decimal
 * @param {number} data.average_cost - Average cost as a decimal
 * @returns {Object|null} The new holding row, or null if not found
 */
export function updateHolding(id, data) {
  const db = getDatabase();

  const existing = db.query(
    "SELECT id, account_id, investment_id, effective_from, effective_to FROM holdings WHERE id = ?"
  ).get(id);

  if (!existing) {
    return null;
  }

  const dateToday = today();

  if (existing.effective_from === dateToday) {
    // Same day — update in place (daily granularity, no intra-day SCD2 rows)
    db.run(
      "UPDATE holdings SET quantity = ?, average_cost = ? WHERE id = ?",
      [scaleQuantity(data.quantity || 0), scaleQuantity(data.average_cost || 0), id],
    );
    return getHoldingById(id);
  }

  db.exec("BEGIN");
  try {
    // Close the current row
    db.run("UPDATE holdings SET effective_to = ? WHERE id = ?", [dateToday, id]);

    // Create new row with updated values
    const result = db.run(
      `INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
       VALUES (?, ?, ?, ?, ?)`,
      [existing.account_id, existing.investment_id, scaleQuantity(data.quantity || 0), scaleQuantity(data.average_cost || 0), dateToday],
    );

    db.exec("COMMIT");
    return getHoldingById(result.lastInsertRowid);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Soft-delete a holding by setting effective_to to today.
 * Preserves the historical record. Does not delete movements or cash transactions.
 * @param {number} id - The holding ID to close
 * @returns {boolean} True if the holding was closed, false if not found
 */
export function deleteHolding(id) {
  const db = getDatabase();
  const existing = db.query(
    "SELECT id, effective_to FROM holdings WHERE id = ?"
  ).get(id);

  if (!existing) {
    return false;
  }

  // Already closed — treat as not found for deletion purposes
  if (existing.effective_to !== null) {
    return false;
  }

  db.run("UPDATE holdings SET effective_to = ? WHERE id = ?", [today(), id]);
  return true;
}

/**
 * @description Hard-delete a holding and its associated movements and cash transactions.
 * Used for account deletion cascade, not for normal holding removal.
 * @param {number} id - The holding ID to permanently delete
 * @returns {boolean} True if deleted
 */
export function hardDeleteHolding(id) {
  const db = getDatabase();
  db.run("DELETE FROM cash_transactions WHERE holding_movement_id IN (SELECT id FROM holding_movements WHERE holding_id = ?)", [id]);
  db.run("DELETE FROM holding_movements WHERE holding_id = ?", [id]);
  const result = db.run("DELETE FROM holdings WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Get distinct investment IDs from current holdings (effective_to IS NULL)
 * for the given user IDs. Used by the analysis filters to show only investments
 * currently held by selected users.
 * @param {Array<number>} userIds - Array of user IDs to filter by
 * @returns {Array<number>} Array of distinct investment IDs
 */
export function getCurrentHoldingInvestmentIds(userIds, accountTypes) {
  if (!userIds || userIds.length === 0) return [];

  const db = getDatabase();
  const userPlaceholders = userIds.map(() => "?").join(", ");
  var sql = `SELECT DISTINCT h.investment_id
       FROM holdings h
       JOIN accounts a ON h.account_id = a.id
       WHERE h.effective_to IS NULL
         AND a.user_id IN (${userPlaceholders})`;
  var params = [...userIds];

  if (accountTypes && accountTypes.length > 0) {
    var typePlaceholders = accountTypes.map(() => "?").join(", ");
    sql += ` AND a.account_type IN (${typePlaceholders})`;
    params.push(...accountTypes);
  }

  const rows = db.query(sql).all(...params);

  return rows.map(function (row) { return row.investment_id; });
}

/**
 * @description Get distinct investment IDs that were historically held but are
 * NOT currently held by the given users. An investment is "historic" if it
 * appears in any holdings row for these users but has no current
 * (effective_to IS NULL) row for any of those users.
 * @param {Array<number>} userIds - Array of user IDs to filter by
 * @returns {Array<number>} Array of distinct investment IDs
 */
export function getHistoricHoldingInvestmentIds(userIds, accountTypes) {
  if (!userIds || userIds.length === 0) return [];

  const db = getDatabase();
  const userPlaceholders = userIds.map(() => "?").join(", ");
  var typeClause = "";
  var typeParams = [];
  if (accountTypes && accountTypes.length > 0) {
    var typePlaceholders = accountTypes.map(() => "?").join(", ");
    typeClause = ` AND a.account_type IN (${typePlaceholders})`;
    typeParams = [...accountTypes];
  }

  var sql = `SELECT DISTINCT h.investment_id
       FROM holdings h
       JOIN accounts a ON h.account_id = a.id
       WHERE a.user_id IN (${userPlaceholders})${typeClause}
         AND h.investment_id NOT IN (
           SELECT DISTINCT h2.investment_id
           FROM holdings h2
           JOIN accounts a2 ON h2.account_id = a2.id
           WHERE h2.effective_to IS NULL
             AND a2.user_id IN (${userPlaceholders})${typeClause}
         )`;

  const rows = db.query(sql).all(...userIds, ...typeParams, ...userIds, ...typeParams);

  return rows.map(function (row) { return row.investment_id; });
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
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    investment_description: row.investment_description,
    investment_public_id: row.investment_public_id,
    investment_morningstar_id: row.investment_morningstar_id || null,
    currency_code: row.currency_code,
    currency_description: row.currency_description,
  };
}
