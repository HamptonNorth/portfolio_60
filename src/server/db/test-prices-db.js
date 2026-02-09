import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Store or update a price for a test investment on a given date.
 * Uses INSERT OR REPLACE to overwrite any existing price for the same
 * test investment and date combination.
 * @param {number} testInvestmentId - FK to test_investments table
 * @param {string} priceDate - ISO-8601 date (YYYY-MM-DD)
 * @param {string} priceTime - Time string (HH:MM:SS)
 * @param {number} priceMinorUnit - Price in minor units (pence/cents), will be scaled by 10000
 */
export function upsertTestPrice(testInvestmentId, priceDate, priceTime, priceMinorUnit) {
  const db = getDatabase();
  const scaledPrice = Math.round(priceMinorUnit * CURRENCY_SCALE_FACTOR);

  db.run(
    `INSERT OR REPLACE INTO test_prices (test_investment_id, price_date, price_time, price)
     VALUES (?, ?, ?, ?)`,
    [testInvestmentId, priceDate, priceTime, scaledPrice],
  );
}

/**
 * @description Get price history for a test investment, ordered by date descending.
 * @param {number} testInvestmentId - The test investment ID
 * @param {number} [limit=20] - Maximum number of records to return
 * @returns {Object[]} Array of price records with unscaled prices
 */
export function getTestPriceHistory(testInvestmentId, limit = 20) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, test_investment_id, price_date, price_time, price
       FROM test_prices
       WHERE test_investment_id = ?
       ORDER BY price_date DESC
       LIMIT ?`,
    )
    .all(testInvestmentId, limit);

  return rows.map(function (row) {
    return {
      id: row.id,
      test_investment_id: row.test_investment_id,
      price_date: row.price_date,
      price_time: row.price_time,
      price: row.price / CURRENCY_SCALE_FACTOR,
      price_scaled: row.price,
    };
  });
}

/**
 * @description Get the latest price for a test investment.
 * @param {number} testInvestmentId - The test investment ID
 * @returns {Object|null} Price record with unscaled price, or null if no prices exist
 */
export function getLatestTestPrice(testInvestmentId) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, test_investment_id, price_date, price_time, price
       FROM test_prices
       WHERE test_investment_id = ?
       ORDER BY price_date DESC
       LIMIT 1`,
    )
    .get(testInvestmentId);

  if (!row) return null;

  return {
    id: row.id,
    test_investment_id: row.test_investment_id,
    price_date: row.price_date,
    price_time: row.price_time,
    price: row.price / CURRENCY_SCALE_FACTOR,
    price_scaled: row.price,
  };
}
