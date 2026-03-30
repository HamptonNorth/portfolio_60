import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/server-constants.js";
import { prorateHistoricalPrices } from "./prices-db.js";
import { updateInvestmentNotes, markInvestmentReplaced, updateAutoFetch } from "./investments-db.js";

/**
 * @description Get the current date as ISO-8601 string (YYYY-MM-DD).
 * @returns {string} Today's date
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

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
 * @description Close the current active holding row and create a new one with
 * updated values. If the holding was created today (same effective_from),
 * updates in place instead (daily granularity — no intra-day SCD2 rows).
 * Must be called within an existing transaction.
 * @param {Database} db - The database connection
 * @param {Object} holding - The current holding row (raw/scaled from DB)
 * @param {number} newScaledQuantity - New quantity (scaled)
 * @param {number} newScaledAvgCost - New average cost (scaled)
 * @param {string} dateToday - Today's date (YYYY-MM-DD)
 * @returns {number} The holding row's ID (new row if closed/reopened, same row if updated in place)
 */
function closeAndReopenHolding(db, holding, newScaledQuantity, newScaledAvgCost, dateToday) {
  // Check the current row's effective_from
  const currentRow = db.query("SELECT effective_from FROM holdings WHERE id = ?").get(holding.id);

  if (currentRow && currentRow.effective_from === dateToday) {
    // Same day — update in place (daily granularity, no intra-day SCD2 rows)
    db.run(
      "UPDATE holdings SET quantity = ?, average_cost = ? WHERE id = ?",
      [newScaledQuantity, newScaledAvgCost, holding.id],
    );
    return holding.id;
  }

  // Different day — close current row and create new one
  db.run("UPDATE holdings SET effective_to = ? WHERE id = ?", [dateToday, holding.id]);

  const result = db.run(
    `INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
     VALUES (?, ?, ?, ?, ?)`,
    [holding.account_id, holding.investment_id, newScaledQuantity, newScaledAvgCost, dateToday],
  );

  return Number(result.lastInsertRowid);
}

/**
 * @description Create a buy movement and atomically update the holding and account.
 *
 * SCD2: The current holding row is closed and a new row is created with the
 * updated quantity and average cost. The movement references the old (closed) row.
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
    const holding = db.query("SELECT id, account_id, investment_id, quantity, average_cost FROM holdings WHERE id = ? AND effective_to IS NULL").get(data.holding_id);

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

    // Insert the movement record (references the old/closing holding row)
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes)
       VALUES (?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
      [data.holding_id, data.movement_date, scaledQuantity, scaledConsideration, scaledBookCost, scaledDeductible, scaledNewAvgCost, data.notes || null],
    );

    // SCD2: close current holding row and create new one
    const dateToday = today();
    closeAndReopenHolding(db, holding, scaledNewQuantity, scaledNewAvgCost, dateToday);

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
 * SCD2: The current holding row is closed and a new row is created with the
 * reduced quantity (unless it's a full sale, in which case no new row is created).
 * The movement references the old (closed) row.
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
    const holding = db.query("SELECT id, account_id, investment_id, quantity, average_cost FROM holdings WHERE id = ? AND effective_to IS NULL").get(data.holding_id);

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

    // Insert the movement record (references the old/closing holding row)
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, notes)
       VALUES (?, 'sell', ?, ?, ?, ?, ?, ?)`,
      [data.holding_id, data.movement_date, scaledQuantity, scaledConsideration, scaledBookCost, scaledDeductible, data.notes || null],
    );

    // SCD2: update the holding
    const dateToday = today();
    const currentRow = db.query("SELECT effective_from FROM holdings WHERE id = ?").get(holding.id);

    if (currentRow && currentRow.effective_from === dateToday) {
      // Same day — update in place
      if (newScaledQuantity > 0) {
        db.run("UPDATE holdings SET quantity = ? WHERE id = ?", [newScaledQuantity, holding.id]);
      } else {
        // Full sale on same day — close the row
        db.run("UPDATE holdings SET quantity = 0, effective_to = ? WHERE id = ?", [dateToday, holding.id]);
      }
    } else {
      // Different day — close current row
      db.run("UPDATE holdings SET effective_to = ? WHERE id = ?", [dateToday, holding.id]);

      // Only create new row if there's remaining quantity (not a full sale)
      if (newScaledQuantity > 0) {
        db.run(
          `INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
           VALUES (?, ?, ?, ?, ?)`,
          [holding.account_id, holding.investment_id, newScaledQuantity, holding.average_cost, dateToday],
        );
      }
    }

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
 * SCD2: The current holding row is closed and a new row is created with the
 * new quantity and recalculated average cost (preserving book cost).
 * The movement references the old (closed) row.
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
    const holding = db.query("SELECT id, account_id, investment_id, quantity, average_cost FROM holdings WHERE id = ? AND effective_to IS NULL").get(data.holding_id);

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

    // Insert the adjustment movement record (references the old/closing holding row)
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes)
       VALUES (?, 'adjustment', ?, ?, 0, ?, 0, ?, ?)`,
      [data.holding_id, data.movement_date, scaledNewQuantity, scaledBookCost, scaledNewAvgCost, data.notes || null],
    );

    // SCD2: close current holding row and create new one
    const dateToday = today();
    closeAndReopenHolding(db, holding, scaledNewQuantity, scaledNewAvgCost, dateToday);

    db.exec("COMMIT");

    return getMovementById(result.lastInsertRowid);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @description Create a replacement movement for a corporate action where one investment
 * replaces another (e.g. fund restructure, manager acquisition).
 *
 * This atomically:
 * 1. Closes the original holding via SCD2 (effective_to = execution date)
 * 2. Creates a new holding for the replacement investment
 * 3. Prorates historical prices from the old investment to the new one
 * 4. Writes notes to both investments (if provided)
 * 5. Marks the old investment as replaced and disables auto-fetch
 *
 * Book cost is preserved across the replacement. No cash changes hands.
 *
 * @param {Object} data - The replacement movement data
 * @param {number} data.holding_id - FK to the original holding being replaced
 * @param {string} data.movement_date - Execution date (ISO-8601 YYYY-MM-DD)
 * @param {number} data.new_investment_id - FK to the replacement investment
 * @param {number} data.new_quantity - Quantity of the replacement investment (decimal, unscaled)
 * @param {number} data.new_price - Price of the replacement at execution date (decimal, in major units e.g. pounds)
 * @param {string} [data.notes] - Optional notes (max 255 chars)
 * @returns {Object} Object with { movement, oldHolding, newHolding }
 * @throws {Error} If holding not found, new investment not found, or same investment
 */
export function createReplacementMovement(data) {
  const db = getDatabase();

  if (!data.new_quantity || data.new_quantity <= 0) {
    throw new Error("New quantity must be greater than zero");
  }

  if (!data.new_price || data.new_price <= 0) {
    throw new Error("New price must be greater than zero");
  }

  if (!data.new_investment_id) {
    throw new Error("Replacement investment is required");
  }

  db.exec("BEGIN");
  try {
    // Read the current holding (scaled values direct from DB)
    const holding = db
      .query("SELECT id, account_id, investment_id, quantity, average_cost FROM holdings WHERE id = ? AND effective_to IS NULL")
      .get(data.holding_id);

    if (!holding) {
      throw new Error("Holding not found");
    }

    if (holding.investment_id === data.new_investment_id) {
      throw new Error("Replacement investment must be different from the current investment");
    }

    // Verify the new investment exists
    const newInvestment = db
      .query("SELECT id FROM investments WHERE id = ?")
      .get(data.new_investment_id);

    if (!newInvestment) {
      throw new Error("Replacement investment not found");
    }

    // Work in unscaled decimals to avoid overflow
    const oldQuantity = unscaleValue(holding.quantity);
    const oldAvgCost = unscaleValue(holding.average_cost);
    const bookCost = oldQuantity * oldAvgCost;

    // New average cost preserves book cost
    const newAvgCost = bookCost / data.new_quantity;

    const scaledNewQuantity = scaleValue(data.new_quantity);
    const scaledNewAvgCost = scaleValue(newAvgCost);
    const scaledBookCost = scaleValue(bookCost);

    // Insert the replacement movement record (references the old/closing holding row)
    const result = db.run(
      `INSERT INTO holding_movements (holding_id, movement_type, movement_date, quantity, movement_value, book_cost, deductible_costs, revised_avg_cost, notes)
       VALUES (?, 'replacement', ?, ?, 0, ?, 0, ?, ?)`,
      [data.holding_id, data.movement_date, scaledNewQuantity, scaledBookCost, scaledNewAvgCost, data.notes || null],
    );

    // Close the original holding at the execution date
    db.run("UPDATE holdings SET effective_to = ? WHERE id = ?", [data.movement_date, holding.id]);

    // Create the new holding for the replacement investment
    const newHoldingResult = db.run(
      `INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
       VALUES (?, ?, ?, ?, ?)`,
      [holding.account_id, data.new_investment_id, scaledNewQuantity, scaledNewAvgCost, data.movement_date],
    );

    db.exec("COMMIT");

    // Post-transaction operations (not rolled back if they fail, but these are
    // supplementary — the core holding swap is already committed)

    // Prorate historical prices from old to new investment
    // newPrice is in major units (e.g. £5.00), convert to minor units (pence) for storage
    const newPriceMinorUnit = data.new_price * 100;
    prorateHistoricalPrices(
      holding.investment_id,
      data.new_investment_id,
      oldQuantity,
      data.new_quantity,
      data.movement_date,
      newPriceMinorUnit,
    );

    // Write notes to both investments
    if (data.notes) {
      updateInvestmentNotes(holding.investment_id, data.notes);
      updateInvestmentNotes(data.new_investment_id, data.notes);
    }

    // Disable auto-fetch and mark the old investment as replaced
    updateAutoFetch(holding.investment_id, false);
    markInvestmentReplaced(holding.investment_id);

    // Build return objects
    const movement = getMovementById(result.lastInsertRowid);

    const oldHolding = db
      .query("SELECT id, account_id, investment_id, quantity, average_cost, effective_from, effective_to FROM holdings WHERE id = ?")
      .get(holding.id);

    const newHoldingId = Number(newHoldingResult.lastInsertRowid);
    const newHolding = db
      .query("SELECT id, account_id, investment_id, quantity, average_cost, effective_from, effective_to FROM holdings WHERE id = ?")
      .get(newHoldingId);

    return {
      movement: movement,
      oldHolding: oldHolding ? {
        id: oldHolding.id,
        account_id: oldHolding.account_id,
        investment_id: oldHolding.investment_id,
        quantity: unscaleValue(oldHolding.quantity),
        average_cost: unscaleValue(oldHolding.average_cost),
        effective_from: oldHolding.effective_from,
        effective_to: oldHolding.effective_to,
      } : null,
      newHolding: newHolding ? {
        id: newHolding.id,
        account_id: newHolding.account_id,
        investment_id: newHolding.investment_id,
        quantity: unscaleValue(newHolding.quantity),
        average_cost: unscaleValue(newHolding.average_cost),
        effective_from: newHolding.effective_from,
        effective_to: newHolding.effective_to,
      } : null,
    };
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
 * SCD2-aware: finds all holding rows for the same account+investment pair
 * and returns movements across all of them, so the full history is visible
 * regardless of which SCD2 row ID is passed.
 * @param {number} holdingId - The holding ID (any row in the SCD2 chain)
 * @param {number} [limit=50] - Maximum number of movements to return
 * @returns {Object[]} Array of movement objects with unscaled values
 */
export function getMovementsByHoldingId(holdingId, limit = 50) {
  const db = getDatabase();

  // Find the account_id and investment_id for this holding
  const holding = db.query(
    "SELECT account_id, investment_id FROM holdings WHERE id = ?"
  ).get(holdingId);

  if (!holding) {
    return [];
  }

  // Get movements across all SCD2 rows for this account+investment pair
  const rows = db
    .query(
      `SELECT hm.id, hm.holding_id, hm.movement_type, hm.movement_date, hm.quantity,
              hm.movement_value, hm.book_cost, hm.deductible_costs, hm.revised_avg_cost, hm.notes
       FROM holding_movements hm
       JOIN holdings h ON hm.holding_id = h.id
       WHERE h.account_id = ? AND h.investment_id = ?
       ORDER BY hm.movement_date DESC, hm.id DESC
       LIMIT ?`,
    )
    .all(holding.account_id, holding.investment_id, limit);

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
