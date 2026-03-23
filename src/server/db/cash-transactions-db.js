import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/server-constants.js";

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
  // Exception: adjustment with direction='credit' adds to balance (rare provider refunds)
  const addsToBalance = data.transaction_type === "deposit" || (data.transaction_type === "adjustment" && data.direction === "credit");
  const balanceChange = addsToBalance ? scaledAmount : -scaledAmount;

  // For credit adjustments, prefix notes with [Credit] so that running-balance
  // calculations and display logic can detect the direction without a schema change
  let storedNotes = data.notes || null;
  if (data.transaction_type === "adjustment" && data.direction === "credit") {
    storedNotes = storedNotes ? "[Credit] " + storedNotes : "[Credit]";
  }

  db.exec("BEGIN");
  try {
    const result = db.run(
      `INSERT INTO cash_transactions (account_id, transaction_type, transaction_date, amount, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [data.account_id, data.transaction_type, data.transaction_date, scaledAmount, storedNotes],
    );

    db.run(`UPDATE accounts SET cash_balance = cash_balance + ? WHERE id = ?`, [balanceChange, data.account_id]);

    recalculateBalanceAfter(data.account_id);

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
      `SELECT id, account_id, holding_movement_id, transaction_type, transaction_date, amount, notes, balance_after
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
      `SELECT ct.id, ct.account_id, ct.holding_movement_id, ct.transaction_type, ct.transaction_date, ct.amount, ct.notes, ct.balance_after,
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
  const row = db.query("SELECT id, account_id, transaction_type, amount, notes FROM cash_transactions WHERE id = ?").get(id);

  if (!row) return false;

  // Reverse the original balance change
  // Deposits, sells, and credit adjustments add to balance; everything else subtracts
  const isCreditAdjustment = row.transaction_type === "adjustment" && row.notes && row.notes.startsWith("[Credit]");
  const addsToBalance = row.transaction_type === "deposit" || row.transaction_type === "sell" || isCreditAdjustment;
  const balanceReversal = addsToBalance ? -row.amount : row.amount;

  db.exec("BEGIN");
  try {
    db.run("DELETE FROM cash_transactions WHERE id = ?", [id]);
    db.run("UPDATE accounts SET cash_balance = cash_balance + ? WHERE id = ?", [balanceReversal, row.account_id]);
    recalculateBalanceAfter(row.account_id);
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
 * @description Recalculate the balance_after column for all cash transactions
 * in a given account. Walks backwards from the current account balance,
 * setting each transaction's balance_after to the running total.
 *
 * Must be called inside an existing database transaction (no own BEGIN/COMMIT).
 *
 * @param {number} accountId - The account ID to recalculate
 */
function recalculateBalanceAfter(accountId) {
  const db = getDatabase();

  // Get the current account balance
  const account = db.query("SELECT cash_balance FROM accounts WHERE id = ?").get(accountId);
  if (!account) return;

  // Get all transactions ordered newest-first
  const txns = db.query(
    "SELECT id, transaction_type, amount, notes FROM cash_transactions WHERE account_id = ? ORDER BY transaction_date DESC, id DESC"
  ).all(accountId);

  if (txns.length === 0) return;

  // Walk backwards from the known current balance
  let runningBalance = account.cash_balance;
  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i];
    db.run("UPDATE cash_transactions SET balance_after = ? WHERE id = ?", [runningBalance, txn.id]);

    // Subtract this transaction's effect to get the balance before it
    const isCreditAdj = txn.transaction_type === "adjustment" && txn.notes && txn.notes.startsWith("[Credit]");
    const addsToBalance = txn.transaction_type === "deposit" || txn.transaction_type === "sell" || isCreditAdj;
    if (addsToBalance) {
      runningBalance -= txn.amount;
    } else {
      runningBalance += txn.amount;
    }
  }
}

/**
 * @description Get the cash balance for an account at a specific historic date.
 * Looks up the most recent balance_after value on or before the given date.
 *
 * @param {number} accountId - The account ID
 * @param {string} date - ISO-8601 date (YYYY-MM-DD)
 * @returns {number|null} The unscaled cash balance, or null if no transactions exist on or before that date
 */
export function getCashBalanceAtDate(accountId, date) {
  const db = getDatabase();
  const row = db.query(
    `SELECT balance_after FROM cash_transactions
     WHERE account_id = ? AND transaction_date <= ?
     ORDER BY transaction_date DESC, id DESC
     LIMIT 1`
  ).get(accountId, date);

  if (!row) return null;
  return unscaleCashAmount(row.balance_after);
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
    balance_after: row.balance_after != null ? unscaleCashAmount(row.balance_after) : null,
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
