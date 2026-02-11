import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Get all accounts for a user, ordered by account type.
 * @param {number} userId - The user ID
 * @returns {Object[]} Array of account objects with unscaled cash values
 */
export function getAccountsByUserId(userId) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT a.id, a.user_id, a.account_type, a.account_ref, a.cash_balance, a.warn_cash,
              (SELECT COUNT(*) FROM holdings h WHERE h.account_id = a.id) AS holdings_count
       FROM accounts a
       WHERE a.user_id = ?
       ORDER BY a.account_type`,
    )
    .all(userId);

  return rows.map(unscaleAccountRow);
}

/**
 * @description Get a single account by ID with unscaled cash values.
 * @param {number} id - The account ID
 * @returns {Object|null} The account object, or null if not found
 */
export function getAccountById(id) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, user_id, account_type, account_ref, cash_balance, warn_cash
       FROM accounts
       WHERE id = ?`,
    )
    .get(id);

  if (!row) return null;
  return unscaleAccountRow(row);
}

/**
 * @description Create a new account.
 * @param {Object} data - The account data
 * @param {number} data.user_id - FK to users table
 * @param {string} data.account_type - One of 'trading', 'isa', 'sipp'
 * @param {string} data.account_ref - Account reference (max 15 chars)
 * @param {number} data.cash_balance - Cash balance as a decimal (e.g. 23765.50)
 * @param {number} data.warn_cash - Warning threshold as a decimal (e.g. 25000.00)
 * @returns {Object} The created account with its new ID
 */
export function createAccount(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO accounts (user_id, account_type, account_ref, cash_balance, warn_cash)
     VALUES (?, ?, ?, ?, ?)`,
    [data.user_id, data.account_type, data.account_ref, scaleCash(data.cash_balance || 0), scaleCash(data.warn_cash || 0)],
  );

  return getAccountById(result.lastInsertRowid);
}

/**
 * @description Update an existing account.
 * @param {number} id - The account ID to update
 * @param {Object} data - The updated account data
 * @param {string} data.account_ref - Account reference (max 15 chars)
 * @param {number} data.cash_balance - Cash balance as a decimal
 * @param {number} data.warn_cash - Warning threshold as a decimal
 * @returns {Object|null} The updated account, or null if not found
 */
export function updateAccount(id, data) {
  const db = getDatabase();
  const result = db.run(
    `UPDATE accounts SET account_ref = ?, cash_balance = ?, warn_cash = ?
     WHERE id = ?`,
    [data.account_ref, scaleCash(data.cash_balance || 0), scaleCash(data.warn_cash || 0), id],
  );

  if (result.changes === 0) {
    return null;
  }

  return getAccountById(id);
}

/**
 * @description Delete an account by ID. Also deletes associated holdings.
 * @param {number} id - The account ID to delete
 * @returns {boolean} True if the account was deleted, false if not found
 */
export function deleteAccount(id) {
  const db = getDatabase();
  // Delete child holdings first (no ON DELETE CASCADE in schema)
  db.run("DELETE FROM holdings WHERE account_id = ?", [id]);
  const result = db.run("DELETE FROM accounts WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Scale a cash value for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} value - The decimal cash value (e.g. 23765.50)
 * @returns {number} Scaled integer value
 */
export function scaleCash(value) {
  return Math.round(value * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored cash value (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledValue - The scaled integer value from the database
 * @returns {number} The decimal cash value
 */
export function unscaleCash(scaledValue) {
  return scaledValue / CURRENCY_SCALE_FACTOR;
}

/**
 * @description Convert a raw database row to an object with unscaled cash values.
 * @param {Object} row - The raw database row
 * @returns {Object} Row with cash_balance and warn_cash as decimals
 */
function unscaleAccountRow(row) {
  const result = {
    id: row.id,
    user_id: row.user_id,
    account_type: row.account_type,
    account_ref: row.account_ref,
    cash_balance: unscaleCash(row.cash_balance),
    warn_cash: unscaleCash(row.warn_cash),
    cash_balance_scaled: row.cash_balance,
    warn_cash_scaled: row.warn_cash,
  };
  if (row.holdings_count !== undefined) {
    result.holdings_count = row.holdings_count;
  }
  return result;
}
