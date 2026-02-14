import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Scale a decimal value for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} value - The decimal value (e.g. 150.25)
 * @returns {number} Scaled integer value
 */
export function scaleValue(value) {
  return Math.round(value * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored integer value (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledValue - The scaled integer value from the database
 * @returns {number} The decimal value
 */
export function unscaleValue(scaledValue) {
  return scaledValue / CURRENCY_SCALE_FACTOR;
}

/**
 * @description Create a buy movement and atomically update the holding and account.
 *
 * The full Total Consideration is deducted from the account cash balance.
 * The holding quantity is increased by the buy quantity.
 * The average cost is recalculated as:
 *   (Old Book Cost + Total Consideration - Deductible Costs) / New Quantity
 *
 * All changes are wrapped in a single database transaction for atomicity.
 *
 * @param {Object} data - The buy movement data
 * @param {number} data.holding_id - FK to holdings table
 * @param {string} data.movement_date - ISO-8601 date (YYYY-MM-DD)
 * @param {number} data.quantity - Quantity being purchased (decimal, unscaled)
 * @param {number} data.total_consideration - Total cost in GBP (decimal, unscaled)
 * @param {number} [data.deductible_costs=0] - Deductible costs in GBP (decimal, unscaled)
 * @param {string} [data.notes] - Optional notes (max 255 chars)
 * @returns {Object} The created movement record with unscaled values
 * @throws {Error} If holding not found, or insufficient cash balance
 */
export function createBuyMovement(data) {
  const db = getDatabase();

  const deductibleCosts = data.deductible_costs || 0;
  const scaledQuantity = scaleValue(data.quantity);
  const scaledConsideration = scaleValue(data.total_consideration);
  const scaledDeductible = scaleValue(deductibleCosts);

  db.exec("BEGIN");
  try {
    // Read the current holding (scaled values direct from DB)
    const holding = db.query("SELECT id, account_id, quantity, average_cost FROM holdings WHERE id = ?").get(data.holding_id);

    if (!holding) {
      throw new Error("Holding not found");
    }

    // Read the current account cash balance
    const account = db.query("SELECT id, cash_balance FROM accounts WHERE id = ?").get(holding.account_id);

    if (!account) {
      throw new Error("Account not found");
    }

    if (account.cash_balance < scaledConsideration) {
      throw new Error("Insufficient cash balance");
    }

    // Calculate new average cost using unscaled decimals to avoid overflow
    const oldQuantity = unscaleValue(holding.quantity);
    const oldAvgCost = unscaleValue(holding.average_cost);
    const oldBookCost = oldQuantity * oldAvgCost;
    const addedBookCost = data.total_consideration - deductibleCosts;
    const newQuantity = oldQuantity + data.quantity;

    // Guard against divide-by-zero (shouldn't happen on a buy, but be safe)
    const newAvgCost = newQuantity > 0 ? (oldBookCost + addedBookCost) / newQuantity : 0;

    const scaledNewQuantity = scaleValue(newQuantity);
    const scaledNewAvgCost = scaleValue(newAvgCost);
    const scaledBookCost = scaleValue(addedBookCost);

    // Insert the movement record
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes)
       VALUES (?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
      [data.holding_id, data.movement_date, scaledQuantity, scaledConsideration, scaledBookCost, scaledDeductible, scaledNewAvgCost, data.notes || null],
    );

    // Update the holding quantity and average cost
    db.run("UPDATE holdings SET quantity = ?, average_cost = ? WHERE id = ?", [scaledNewQuantity, scaledNewAvgCost, data.holding_id]);

    // Deduct total consideration from account cash balance
    db.run("UPDATE accounts SET cash_balance = cash_balance - ? WHERE id = ?", [scaledConsideration, holding.account_id]);

    // Create matching cash_transaction for audit trail (balance already adjusted above)
    const movementId = result.lastInsertRowid;
    const investmentRow = db.query("SELECT i.description FROM holdings h JOIN investments i ON h.investment_id = i.id WHERE h.id = ?").get(data.holding_id);
    const investmentName = investmentRow ? investmentRow.description : "Unknown";
    const cashNotes = "Buy: " + investmentName + (data.notes ? " — " + data.notes : "");

    db.run(
      `INSERT INTO cash_transactions (account_id, holding_movement_id, transaction_type, transaction_date, amount, notes)
       VALUES (?, ?, 'buy', ?, ?, ?)`,
      [holding.account_id, movementId, data.movement_date, scaledConsideration, cashNotes],
    );

    db.exec("COMMIT");

    return getMovementById(movementId);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Create a sell movement and atomically update the holding and account.
 *
 * The Total Consideration is added to the account cash balance.
 * The holding quantity is reduced by the sell quantity.
 * The average cost is NOT changed on a sell.
 * The book_cost recorded is Sell Quantity x Average Cost (cost basis being disposed of).
 *
 * All changes are wrapped in a single database transaction for atomicity.
 *
 * @param {Object} data - The sell movement data
 * @param {number} data.holding_id - FK to holdings table
 * @param {string} data.movement_date - ISO-8601 date (YYYY-MM-DD)
 * @param {number} data.quantity - Quantity being sold (decimal, unscaled)
 * @param {number} data.total_consideration - Sale proceeds in GBP (decimal, unscaled)
 * @param {number} [data.deductible_costs=0] - Deductible costs in GBP (decimal, unscaled)
 * @param {string} [data.notes] - Optional notes (max 255 chars)
 * @returns {Object} The created movement record with unscaled values
 * @throws {Error} If holding not found, or insufficient holding quantity
 */
export function createSellMovement(data) {
  const db = getDatabase();

  const deductibleCosts = data.deductible_costs || 0;
  const scaledQuantity = scaleValue(data.quantity);
  const scaledConsideration = scaleValue(data.total_consideration);
  const scaledDeductible = scaleValue(deductibleCosts);

  db.exec("BEGIN");
  try {
    // Read the current holding (scaled values direct from DB)
    const holding = db.query("SELECT id, account_id, quantity, average_cost FROM holdings WHERE id = ?").get(data.holding_id);

    if (!holding) {
      throw new Error("Holding not found");
    }

    if (holding.quantity < scaledQuantity) {
      throw new Error("Insufficient holding quantity");
    }

    // Book cost = sell quantity x average cost (unscaled to avoid overflow)
    const sellQuantity = data.quantity;
    const avgCost = unscaleValue(holding.average_cost);
    const bookCost = sellQuantity * avgCost;
    const scaledBookCost = scaleValue(bookCost);

    // New quantity after sell
    const newScaledQuantity = holding.quantity - scaledQuantity;

    // Insert the movement record
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, notes)
       VALUES (?, 'sell', ?, ?, ?, ?, ?, ?)`,
      [data.holding_id, data.movement_date, scaledQuantity, scaledConsideration, scaledBookCost, scaledDeductible, data.notes || null],
    );

    // Reduce the holding quantity (average_cost unchanged on sell)
    db.run("UPDATE holdings SET quantity = ? WHERE id = ?", [newScaledQuantity, data.holding_id]);

    // Add net proceeds (total consideration minus deductible costs) to account cash balance
    const scaledNetProceeds = scaledConsideration - scaledDeductible;
    db.run("UPDATE accounts SET cash_balance = cash_balance + ? WHERE id = ?", [scaledNetProceeds, holding.account_id]);

    // Create matching cash_transaction for audit trail (balance already adjusted above)
    const movementId = result.lastInsertRowid;
    const investmentRow = db.query("SELECT i.description FROM holdings h JOIN investments i ON h.investment_id = i.id WHERE h.id = ?").get(data.holding_id);
    const investmentName = investmentRow ? investmentRow.description : "Unknown";
    const cashNotes = "Sell: " + investmentName + (data.notes ? " — " + data.notes : "");

    db.run(
      `INSERT INTO cash_transactions (account_id, holding_movement_id, transaction_type, transaction_date, amount, notes)
       VALUES (?, ?, 'sell', ?, ?, ?)`,
      [holding.account_id, movementId, data.movement_date, scaledNetProceeds, cashNotes],
    );

    db.exec("COMMIT");

    return getMovementById(movementId);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Create a stock split adjustment and atomically update the holding.
 *
 * A stock split changes the quantity and average cost of a holding such that
 * the total book cost remains constant. For example, a 1:100 forward split
 * multiplies quantity by 100 and divides avg cost by 100. Reverse splits
 * (consolidations) are also supported.
 *
 * No cash is involved — the account cash balance is not changed.
 *
 * @param {Object} data - The split movement data
 * @param {number} data.holding_id - FK to holdings table
 * @param {string} data.movement_date - ISO-8601 date (YYYY-MM-DD)
 * @param {number} data.new_quantity - New quantity after split (decimal, unscaled)
 * @param {string} [data.notes] - Optional notes (max 255 chars), e.g. "Stock split 1:100"
 * @returns {Object} The created movement record with unscaled values
 * @throws {Error} If holding not found, new_quantity is invalid, or unchanged
 */
export function createSplitMovement(data) {
  const db = getDatabase();

  if (!data.new_quantity || data.new_quantity <= 0) {
    throw new Error("New quantity must be greater than zero");
  }

  db.exec("BEGIN");
  try {
    // Read the current holding (scaled values direct from DB)
    const holding = db.query("SELECT id, account_id, quantity, average_cost FROM holdings WHERE id = ?").get(data.holding_id);

    if (!holding) {
      throw new Error("Holding not found");
    }

    // Work in unscaled decimals to avoid overflow
    const oldQuantity = unscaleValue(holding.quantity);
    const oldAvgCost = unscaleValue(holding.average_cost);
    const bookCost = oldQuantity * oldAvgCost;

    if (data.new_quantity === oldQuantity) {
      throw new Error("New quantity is the same as the current quantity");
    }

    // New average cost is the inverse: preserve book cost
    const newAvgCost = bookCost / data.new_quantity;

    const scaledNewQuantity = scaleValue(data.new_quantity);
    const scaledNewAvgCost = scaleValue(newAvgCost);
    const scaledBookCost = scaleValue(bookCost);

    // Insert the adjustment movement record
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes)
       VALUES (?, 'adjustment', ?, ?, 0, ?, 0, ?, ?)`,
      [data.holding_id, data.movement_date, scaledNewQuantity, scaledBookCost, scaledNewAvgCost, data.notes || null],
    );

    // Update the holding quantity and average cost
    db.run("UPDATE holdings SET quantity = ?, average_cost = ? WHERE id = ?", [scaledNewQuantity, scaledNewAvgCost, data.holding_id]);

    db.exec("COMMIT");

    return getMovementById(result.lastInsertRowid);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Get a single holding movement by ID with unscaled values.
 * @param {number} id - The movement ID
 * @returns {Object|null} The movement object, or null if not found
 */
export function getMovementById(id) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes
       FROM holding_movements
       WHERE id = ?`,
    )
    .get(id);

  if (!row) return null;
  return unscaleMovementRow(row);
}

/**
 * @description Get holding movements for a holding, ordered newest first.
 * @param {number} holdingId - The holding ID
 * @param {number} [limit=50] - Maximum number of movements to return
 * @returns {Object[]} Array of movement objects with unscaled values
 */
export function getMovementsByHoldingId(holdingId, limit = 50) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes
       FROM holding_movements
       WHERE holding_id = ?
       ORDER BY movement_date DESC, id DESC
       LIMIT ?`,
    )
    .all(holdingId, limit);

  return rows.map(unscaleMovementRow);
}

/**
 * @description Convert a raw database row to an object with unscaled values.
 * @param {Object} row - The raw database row
 * @returns {Object} Row with quantity, movement_value, book_cost, deductible_costs as decimals
 */
function unscaleMovementRow(row) {
  return {
    id: row.id,
    holding_id: row.holding_id,
    movement_type: row.movement_type,
    movement_date: row.movement_date,
    quantity: unscaleValue(row.quantity),
    movement_value: unscaleValue(row.movement_value),
    book_cost: unscaleValue(row.book_cost),
    deductible_costs: unscaleValue(row.deductible_costs),
    revised_avg_cost: unscaleValue(row.revised_avg_cost),
    quantity_scaled: row.quantity,
    movement_value_scaled: row.movement_value,
    book_cost_scaled: row.book_cost,
    deductible_costs_scaled: row.deductible_costs,
    revised_avg_cost_scaled: row.revised_avg_cost,
    notes: row.notes,
  };
}
