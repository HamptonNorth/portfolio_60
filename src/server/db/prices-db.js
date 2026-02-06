import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

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
export function getPriceHistory(investmentId, limit = 100) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, investment_id, price_date, price_time, price
       FROM prices
       WHERE investment_id = ?
       ORDER BY price_date DESC
       LIMIT ?`,
    )
    .all(investmentId, limit);

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
