import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/server-constants.js";

/**
 * @description Store or update a price for an investment on a given date.
 * Uses INSERT OR REPLACE to overwrite any existing price for the same
 * investment and date combination.
 * @param {number} investmentId - FK to investments table
 * @param {string} priceDate - ISO-8601 date (YYYY-MM-DD)
 * @param {string} priceTime - Time string (HH:MM:SS)
 * @param {number} priceMinorUnit - Price in minor units (pence/cents), will be scaled by 10000
 */
export function upsertPrice(investmentId, priceDate, priceTime, priceMinorUnit) {
  const db = getDatabase();
  // Price is stored as integer × 10000 for precision
  // priceMinorUnit is in pence (e.g., 12345.6789 pence)
  // We want to store this scaled by 10000: 12345.6789 × 10000 = 123456789
  const scaledPrice = Math.round(priceMinorUnit * CURRENCY_SCALE_FACTOR);

  db.run(
    `INSERT OR REPLACE INTO prices (investment_id, price_date, price_time, price)
     VALUES (?, ?, ?, ?)`,
    [investmentId, priceDate, priceTime, scaledPrice],
  );
}

/**
 * @description Get the latest price for an investment.
 * @param {number} investmentId - The investment ID
 * @returns {Object|null} Price record with unscaled price, or null if no prices exist
 */
export function getLatestPrice(investmentId) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, investment_id, price_date, price_time, price
       FROM prices
       WHERE investment_id = ?
       ORDER BY price_date DESC
       LIMIT 1`,
    )
    .get(investmentId);

  if (!row) return null;

  return {
    id: row.id,
    investment_id: row.investment_id,
    price_date: row.price_date,
    price_time: row.price_time,
    price: row.price / CURRENCY_SCALE_FACTOR, // Unscale for display
    price_scaled: row.price, // Raw scaled value
  };
}

/**
 * @description Get all prices for an investment, ordered by date descending.
 * @param {number} investmentId - The investment ID
 * @param {number} [limit=100] - Maximum number of records to return
 * @returns {Object[]} Array of price records with unscaled prices
 */
export function getPriceHistory(investmentId, limit = 100, offset = 0) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, investment_id, price_date, price_time, price
       FROM prices
       WHERE investment_id = ?
       ORDER BY price_date DESC
       LIMIT ? OFFSET ?`,
    )
    .all(investmentId, limit, offset);

  return rows.map(function (row) {
    return {
      id: row.id,
      investment_id: row.investment_id,
      price_date: row.price_date,
      price_time: row.price_time,
      price: row.price / CURRENCY_SCALE_FACTOR,
      price_scaled: row.price,
    };
  });
}

/**
 * @description Get total number of price records for an investment.
 * @param {number} investmentId - The investment ID
 * @returns {number} Total count of price records
 */
export function getPriceCount(investmentId) {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) AS count FROM prices WHERE investment_id = ?").get(investmentId);
  return row.count;
}

/**
 * @description Get total number of price records across all investments.
 * Used for auto-backfill detection (empty table = first run).
 * @returns {number} Total count of all price records
 */
export function getTotalPriceCount() {
  const db = getDatabase();
  return db.query("SELECT COUNT(*) AS count FROM prices").get().count;
}

/**
 * @description Get price for an investment on a specific date.
 * @param {number} investmentId - The investment ID
 * @param {string} priceDate - ISO-8601 date (YYYY-MM-DD)
 * @returns {Object|null} Price record or null if not found
 */
export function getPriceByDate(investmentId, priceDate) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, investment_id, price_date, price_time, price
       FROM prices
       WHERE investment_id = ? AND price_date = ?`,
    )
    .get(investmentId, priceDate);

  if (!row) return null;

  return {
    id: row.id,
    investment_id: row.investment_id,
    price_date: row.price_date,
    price_time: row.price_time,
    price: row.price / CURRENCY_SCALE_FACTOR,
    price_scaled: row.price,
  };
}

/**
 * @description Get the nearest price for an investment on or before a given date.
 * Useful for historic lookups where the exact date may not have a price
 * (weekends, bank holidays, etc.).
 * @param {number} investmentId - The investment ID
 * @param {string} priceDate - ISO-8601 date (YYYY-MM-DD) upper bound
 * @returns {Object|null} Price record with unscaled price, or null if none found
 */
export function getPriceOnOrBefore(investmentId, priceDate) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, investment_id, price_date, price_time, price
       FROM prices
       WHERE investment_id = ? AND price_date <= ?
       ORDER BY price_date DESC
       LIMIT 1`,
    )
    .get(investmentId, priceDate);

  if (!row) return null;

  return {
    id: row.id,
    investment_id: row.investment_id,
    price_date: row.price_date,
    price_time: row.price_time,
    price: row.price / CURRENCY_SCALE_FACTOR,
    price_scaled: row.price,
  };
}

/**
 * @description Get all prices for an investment within a date range, ordered
 * by date ascending. Used for chart data where we need chronological values.
 * @param {number} investmentId - The investment ID
 * @param {string} fromDate - ISO-8601 start date (inclusive)
 * @param {string} toDate - ISO-8601 end date (inclusive)
 * @returns {Object[]} Array of price records with unscaled prices, date ascending
 */
export function getPricesInRange(investmentId, fromDate, toDate) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, investment_id, price_date, price_time, price
       FROM prices
       WHERE investment_id = ? AND price_date >= ? AND price_date <= ?
       ORDER BY price_date ASC`,
    )
    .all(investmentId, fromDate, toDate);

  return rows.map(function (row) {
    return {
      id: row.id,
      investment_id: row.investment_id,
      price_date: row.price_date,
      price_time: row.price_time,
      price: row.price / CURRENCY_SCALE_FACTOR,
      price_scaled: row.price,
    };
  });
}

/**
 * @description Get all prices for all investments within a date range in one query.
 * Returns a Map keyed by investment_id, each value an array of price records
 * sorted by date ascending. Used by the analysis service to avoid N+1 queries.
 * @param {string} fromDate - ISO-8601 start date (inclusive)
 * @param {string} toDate - ISO-8601 end date (inclusive)
 * @returns {Map<number, Array<Object>>} Map of investmentId → price records
 */
export function getAllInvestmentPricesInRange(fromDate, toDate) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT investment_id, price_date, price
       FROM prices
       WHERE price_date >= ? AND price_date <= ?
       ORDER BY investment_id, price_date ASC`,
    )
    .all(fromDate, toDate);

  var result = new Map();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var invId = row.investment_id;
    if (!result.has(invId)) {
      result.set(invId, []);
    }
    result.get(invId).push({
      price_date: row.price_date,
      price: row.price / CURRENCY_SCALE_FACTOR,
    });
  }
  return result;
}

/**
 * @description Create prorated historical prices for a replacement investment based on
 * the old investment's price history. For each old price, the new price is calculated as:
 * newPrice = oldPrice × (oldQuantity / newQuantity), preserving total value continuity.
 * Skips if the new investment already has prices before the execution date (multi-account safety).
 * @param {number} oldInvestmentId - The investment being replaced
 * @param {number} newInvestmentId - The replacement investment
 * @param {number} oldQuantity - Quantity held of the old investment (unscaled)
 * @param {number} newQuantity - Quantity of the replacement investment (unscaled)
 * @param {string} executionDate - ISO-8601 date of the replacement (exclusive upper bound for old prices)
 * @param {number} newPrice - Price of the replacement investment at execution date (in minor units, e.g. pence)
 * @returns {number} Number of prorated prices inserted (0 if skipped)
 */
export function prorateHistoricalPrices(oldInvestmentId, newInvestmentId, oldQuantity, newQuantity, executionDate, newPrice) {
  const db = getDatabase();

  // Get all old investment prices before the execution date
  // Uses INSERT OR REPLACE so this is safe to call multiple times (multi-account case)
  // — prorated prices simply overwrite any existing prices for the same dates
  const oldPrices = db
    .query(
      `SELECT price_date, price_time, price
       FROM prices
       WHERE investment_id = ? AND price_date < ?
       ORDER BY price_date ASC`,
    )
    .all(oldInvestmentId, executionDate);

  // Calculate the ratio for prorating: oldQuantity / newQuantity
  const ratio = oldQuantity / newQuantity;

  // Insert prorated prices for the new investment
  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO prices (investment_id, price_date, price_time, price) VALUES (?, ?, ?, ?)",
  );

  for (const oldPrice of oldPrices) {
    // oldPrice.price is already scaled; multiply by ratio and round
    const proratedScaledPrice = Math.round(oldPrice.price * ratio);
    insertStmt.run(newInvestmentId, oldPrice.price_date, oldPrice.price_time, proratedScaledPrice);
  }

  // Insert the user-supplied execution date price for the new investment
  const scaledNewPrice = Math.round(newPrice * CURRENCY_SCALE_FACTOR);
  insertStmt.run(newInvestmentId, executionDate, "00:00:00", scaledNewPrice);

  return oldPrices.length + 1;
}

/**
 * @description Scale a price value for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} price - The price in minor units
 * @returns {number} Scaled integer value
 */
export function scalePrice(price) {
  return Math.round(price * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored price value (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledPrice - The scaled integer value from the database
 * @returns {number} The original price in minor units
 */
export function unscalePrice(scaledPrice) {
  return scaledPrice / CURRENCY_SCALE_FACTOR;
}
