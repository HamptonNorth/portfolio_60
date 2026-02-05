import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Insert or replace a currency rate for a given currency and date.
 * Uses INSERT OR REPLACE to overwrite any existing rate for the same currency+date pair.
 * The rate is stored as an integer scaled by CURRENCY_SCALE_FACTOR (10000).
 * @param {number} currenciesId - The currency ID (FK to currencies)
 * @param {string} rateDate - ISO-8601 date string (YYYY-MM-DD)
 * @param {number} scaledRate - The exchange rate already scaled by CURRENCY_SCALE_FACTOR
 */
export function upsertRate(currenciesId, rateDate, scaledRate) {
  const db = getDatabase();
  db.run(
    "INSERT OR REPLACE INTO currency_rates (currencies_id, rate_date, rate) VALUES (?, ?, ?)",
    [currenciesId, rateDate, scaledRate]
  );
}

/**
 * @description Get the latest exchange rate for each non-GBP currency.
 * Returns the most recent rate per currency, with the currency code and description.
 * The rate is returned as the raw integer (scaled by CURRENCY_SCALE_FACTOR).
 * @returns {Object[]} Array of objects with currency details and latest rate
 */
export function getLatestRates() {
  const db = getDatabase();

  // For each non-GBP currency, get the most recent rate by date
  const rows = db.query(`
    SELECT
      cr.id,
      cr.currencies_id,
      c.code AS currency_code,
      c.description AS currency_description,
      cr.rate_date,
      cr.rate
    FROM currency_rates cr
    JOIN currencies c ON c.id = cr.currencies_id
    WHERE c.code != 'GBP'
      AND cr.rate_date = (
        SELECT MAX(cr2.rate_date)
        FROM currency_rates cr2
        WHERE cr2.currencies_id = cr.currencies_id
      )
    ORDER BY c.code
  `).all();

  return rows;
}

/**
 * @description Get all exchange rates for a specific date.
 * Returns rates with currency details for the given date.
 * @param {string} rateDate - ISO-8601 date string (YYYY-MM-DD)
 * @returns {Object[]} Array of rate objects for that date
 */
export function getRatesForDate(rateDate) {
  const db = getDatabase();

  const rows = db.query(`
    SELECT
      cr.id,
      cr.currencies_id,
      c.code AS currency_code,
      c.description AS currency_description,
      cr.rate_date,
      cr.rate
    FROM currency_rates cr
    JOIN currencies c ON c.id = cr.currencies_id
    WHERE cr.rate_date = ?
    ORDER BY c.code
  `).all(rateDate);

  return rows;
}

/**
 * @description Get the rate history for a specific currency, newest first.
 * @param {number} currenciesId - The currency ID
 * @param {number} [limit=30] - Maximum number of records to return
 * @returns {Object[]} Array of rate objects ordered by date descending
 */
export function getRateHistory(currenciesId, limit = 30) {
  const db = getDatabase();

  const rows = db.query(`
    SELECT
      cr.id,
      cr.currencies_id,
      c.code AS currency_code,
      cr.rate_date,
      cr.rate
    FROM currency_rates cr
    JOIN currencies c ON c.id = cr.currencies_id
    WHERE cr.currencies_id = ?
    ORDER BY cr.rate_date DESC
    LIMIT ?
  `).all(currenciesId, limit);

  return rows;
}

/**
 * @description Convert a raw decimal rate to the integer-scaled value for storage.
 * Multiplies by CURRENCY_SCALE_FACTOR (10000) and rounds to the nearest integer.
 * @param {number} decimalRate - The decimal exchange rate (e.g. 1.2543)
 * @returns {number} The integer-scaled rate (e.g. 12543)
 */
export function scaleRate(decimalRate) {
  return Math.round(decimalRate * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Convert an integer-scaled rate back to a decimal value for display.
 * Divides by CURRENCY_SCALE_FACTOR (10000).
 * @param {number} scaledRate - The integer-scaled rate (e.g. 12543)
 * @returns {number} The decimal exchange rate (e.g. 1.2543)
 */
export function unscaleRate(scaledRate) {
  return scaledRate / CURRENCY_SCALE_FACTOR;
}
