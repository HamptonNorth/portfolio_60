import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Scale a cash amount for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} value - The decimal cash value (e.g. 1500.00)
 * @returns {number} Scaled integer value
 */
export function scaleCashAmount(value) {
  return Math.round(value * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored cash amount (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledValue - The scaled integer value from the database
 * @returns {number} The decimal cash value
 */
export function unscaleCashAmount(scaledValue) {
  return scaledValue / CURRENCY_SCALE_FACTOR;
}

/**
 * @description Create a cash transaction and atomically update the account's
 * cash balance. Deposits increase the balance; withdrawals, drawdowns and
 * adjustments with negative amounts decrease it.
 *
 * The insert and balance update are wrapped in a single database transaction
 * for atomicity — either both succeed or neither does.
 *
 * @param {Object} data - The transaction data
 * @param {number} data.account_id - FK to accounts table
 * @param {string} data.transaction_type - One of 'deposit', 'withdrawal', 'drawdown', 'adjustment'
 * @param {string} data.transaction_date - ISO-8601 date (YYYY-MM-DD)
 * @param {number} data.amount - Amount as a positive decimal (e.g. 1500.00)
 * @param {string} [data.notes] - Optional notes (max 255 chars)
 * @returns {Object} The created transaction with its new ID and unscaled amount
 */
export function createCashTransaction(data) {
  const db = getDatabase();
  const scaledAmount = scaleCashAmount(data.amount);

  // Determine the balance change direction based on transaction type
  // Deposits add to balance; withdrawals, drawdowns and adjustments subtract
  const isDeposit = data.transaction_type === "deposit";
  const balanceChange = isDeposit ? scaledAmount : -scaledAmount;

  db.exec("BEGIN");
  try {
    const result = db.run(
      `INSERT INTO cash_transactions (account_id, transaction_type, transaction_date, amount, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [data.account_id, data.transaction_type, data.transaction_date, scaledAmount, data.notes || null],
    );

    db.run(`UPDATE accounts SET cash_balance = cash_balance + ? WHERE id = ?`, [balanceChange, data.account_id]);

    db.exec("COMMIT");

    return getCashTransactionById(result.lastInsertRowid);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Get a single cash transaction by ID with unscaled amount.
 * @param {number} id - The transaction ID
 * @returns {Object|null} The transaction object, or null if not found
 */
export function getCashTransactionById(id) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, account_id, holding_movement_id, transaction_type, transaction_date, amount, notes
       FROM cash_transactions
       WHERE id = ?`,
    )
    .get(id);

  if (!row) return null;
  return unscaleTransactionRow(row);
}

/**
 * @description Get cash transactions for an account, ordered newest first.
 * @param {number} accountId - The account ID
 * @param {number} [limit=50] - Maximum number of transactions to return
 * @returns {Object[]} Array of transaction objects with unscaled amounts
 */
export function getCashTransactionsByAccountId(accountId, limit = 50) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT ct.id, ct.account_id, ct.holding_movement_id, ct.transaction_type, ct.transaction_date, ct.amount, ct.notes,
              hm.quantity AS movement_quantity, hm.movement_value AS movement_total_consideration, hm.deductible_costs AS movement_deductible_costs, hm.revised_avg_cost AS movement_revised_avg_cost
       FROM cash_transactions ct
       LEFT JOIN holding_movements hm ON ct.holding_movement_id = hm.id
       WHERE ct.account_id = ?
       ORDER BY ct.transaction_date DESC, ct.id DESC
       LIMIT ?`,
    )
    .all(accountId, limit);

  return rows.map(unscaleTransactionRow);
}

/**
 * @description Delete a cash transaction and reverse its effect on the
 * account's cash balance. Wrapped in a database transaction for atomicity.
 *
 * @param {number} id - The transaction ID to delete
 * @returns {boolean} True if the transaction was deleted, false if not found
 */
export function deleteCashTransaction(id) {
  const db = getDatabase();

  // Load the transaction first to determine the balance reversal
  const row = db.query("SELECT id, account_id, transaction_type, amount FROM cash_transactions WHERE id = ?").get(id);

  if (!row) return false;

  // Reverse the original balance change
  // Deposits and sells add to balance; withdrawals, drawdowns, adjustments and buys subtract
  const addsToBalance = row.transaction_type === "deposit" || row.transaction_type === "sell";
  const balanceReversal = addsToBalance ? -row.amount : row.amount;

  db.exec("BEGIN");
  try {
    db.run("DELETE FROM cash_transactions WHERE id = ?", [id]);
    db.run("UPDATE accounts SET cash_balance = cash_balance + ? WHERE id = ?", [balanceReversal, row.account_id]);
    db.exec("COMMIT");
    return true;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Get the total deposits for an ISA account within a date range.
 * Used to calculate ISA allowance usage for a tax year.
 * @param {number} accountId - The account ID (should be an ISA account)
 * @param {string} taxYearStart - Start date (inclusive) in YYYY-MM-DD format
 * @param {string} taxYearEnd - End date (inclusive) in YYYY-MM-DD format
 * @returns {number} Total deposit amount as unscaled decimal
 */
export function getIsaDepositsForTaxYear(accountId, taxYearStart, taxYearEnd) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM cash_transactions
       WHERE account_id = ?
         AND transaction_type = 'deposit'
         AND transaction_date >= ?
         AND transaction_date <= ?`,
    )
    .get(accountId, taxYearStart, taxYearEnd);

  return unscaleCashAmount(row.total);
}

/**
 * @description Check whether a drawdown transaction already exists for a
 * given account and date. Used by the drawdown processor for deduplication.
 * @param {number} accountId - The account ID
 * @param {string} transactionDate - The date to check (YYYY-MM-DD)
 * @returns {boolean} True if a drawdown transaction exists for that date
 */
export function drawdownExistsForDate(accountId, transactionDate) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT COUNT(*) AS cnt
       FROM cash_transactions
       WHERE account_id = ?
         AND transaction_type = 'drawdown'
         AND transaction_date = ?`,
    )
    .get(accountId, transactionDate);

  return row.cnt > 0;
}

/**
 * @description Convert a raw database row to an object with unscaled amount.
 * @param {Object} row - The raw database row
 * @returns {Object} Row with amount as a decimal
 */
function unscaleTransactionRow(row) {
  const result = {
    id: row.id,
    account_id: row.account_id,
    holding_movement_id: row.holding_movement_id || null,
    transaction_type: row.transaction_type,
    transaction_date: row.transaction_date,
    amount: unscaleCashAmount(row.amount),
    amount_scaled: row.amount,
    notes: row.notes,
  };

  // Include holding movement details when available (buy/sell transactions)
  if (row.movement_quantity !== undefined && row.movement_quantity !== null) {
    result.quantity = row.movement_quantity / CURRENCY_SCALE_FACTOR;
    result.total_consideration = row.movement_total_consideration / CURRENCY_SCALE_FACTOR;
    result.deductible_costs = row.movement_deductible_costs / CURRENCY_SCALE_FACTOR;
    result.revised_avg_cost = row.movement_revised_avg_cost / CURRENCY_SCALE_FACTOR;
  }

  return result;
}
